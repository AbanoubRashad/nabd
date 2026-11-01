/**
 * Runs the alert rules (the pure state machine in @nabd/shared) against live data and carries out what it
 * decides: alerts opened and resolved, timeline events, notifications. It runs inside ingest on every
 * accepted reading, plus a 30-second clock for silence (offline), mute expiry and escalation.
 *
 * Work is serialised through one queue so two readings can never race on the same rule state, and
 * notifications are sent in the background: a slow provider never holds up ingest.
 */
import {
  INITIAL_RULE_STATE,
  METRICS,
  evaluate,
  isMetricKey,
  type RuleEffect,
  type RuleInput,
  type RuleState,
} from '@nabd/shared';
import { sendWithRetry, type AlertMessage, type Providers } from '@nabd/notify';
import type { Contact, EngineDevice, EngineRule, RulesStore } from './types.js';

interface Slot {
  state: RuleState;
  alertId: string | null;
  dirty: boolean;
}

type Log = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

export class RulesEngine {
  private rules: EngineRule[] = [];
  private devices = new Map<string, EngineDevice>();
  private readonly slots = new Map<string, Slot>();
  /** Latest value per device and metric, for message details such as "Door: closed". */
  private readonly latest = new Map<string, Map<string, number>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sending = new Set<Promise<unknown>>();

  constructor(
    private readonly store: RulesStore,
    private readonly providers: Providers,
    private readonly log: Log,
    /** The wall clock for the replay check. The demo's back-fill runs the engine on simulated time. */
    private readonly now: () => number = Date.now,
  ) {}

  private key(ruleId: number, deviceId: string) {
    return `${ruleId}:${deviceId}`;
  }

  /** Loads rules, devices and persisted state. Call at start-up and whenever rules change. */
  async load(): Promise<void> {
    const [rules, devices, states] = await Promise.all([
      this.store.loadRules(),
      this.store.loadDevices(),
      this.store.loadStates(),
    ]);
    this.rules = rules.filter((r) => r.enabled);
    const previous = this.devices;
    this.devices = new Map(
      devices.map((d) => [d.id, { ...d, lastSeenAt: previous.get(d.id)?.lastSeenAt ?? d.lastSeenAt }]),
    );
    for (const s of states) {
      const k = this.key(s.ruleId, s.deviceId);
      if (!this.slots.has(k)) this.slots.set(k, { state: s.state, alertId: s.alertId, dirty: false });
    }
  }

  private appliesTo(rule: EngineRule, device: EngineDevice): boolean {
    if (rule.deviceId) return rule.deviceId === device.id;
    if (rule.siteSlug) return rule.siteSlug === device.siteSlug;
    return true;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch((err: unknown) => this.log.error({ err }, 'rules engine step failed'));
    return next;
  }

  /** Called for every accepted telemetry message. Replays from a device's buffer are skipped (older than 60 s). */
  onReading(deviceId: string, at: Date, metrics: Record<string, number | null | undefined>): Promise<void> {
    return this.enqueue(async () => {
      const device = this.devices.get(deviceId);
      if (!device) return;
      const t = at.getTime();
      device.lastSeenAt = Math.max(device.lastSeenAt ?? 0, t);
      const latest = this.latest.get(deviceId) ?? new Map<string, number>();
      for (const [m, v] of Object.entries(metrics)) if (typeof v === 'number') latest.set(m, v);
      this.latest.set(deviceId, latest);
      if (this.now() - t > 60_000) return;

      for (const rule of this.rules) {
        if (!this.appliesTo(rule, device)) continue;
        if (rule.operator === 'offline') {
          await this.step(rule, device, { kind: 'reading', at: t, value: 0 });
          continue;
        }
        const value = rule.metric ? metrics[rule.metric] : undefined;
        if (typeof value === 'number') await this.step(rule, device, { kind: 'reading', at: t, value });
      }
    });
  }

  /** Any message (status included) proves a device is alive. */
  onSeen(deviceId: string, at: Date): void {
    const device = this.devices.get(deviceId);
    if (device) device.lastSeenAt = Math.max(device.lastSeenAt ?? 0, at.getTime());
  }

  /** The 30-second clock: silence, mute expiry, escalation; also flushes changed peaks to the database. */
  tick(now = new Date()): Promise<void> {
    return this.enqueue(async () => {
      for (const rule of this.rules) {
        for (const device of this.devices.values()) {
          if (!this.appliesTo(rule, device)) continue;
          if (rule.operator !== 'offline' && !this.slots.has(this.key(rule.id, device.id))) continue;
          await this.step(rule, device, { kind: 'tick', at: now.getTime(), lastSeenAt: device.lastSeenAt });
        }
      }
      for (const [k, slot] of this.slots) {
        if (!slot.dirty) continue;
        const [ruleId, deviceId] = k.split(':') as [string, string];
        await this.store.saveState({
          ruleId: Number(ruleId),
          deviceId,
          state: slot.state,
          alertId: slot.alertId,
        });
        const status = slot.state.status;
        if (slot.alertId && (status === 'firing' || status === 'acknowledged' || status === 'muted')) {
          await this.store.updateAlert(slot.alertId, { state: status, peak: slot.state.peak });
        }
        slot.dirty = false;
      }
    });
  }

  /** Acknowledge or mute, from the dashboard or a WhatsApp reply (via the API's NOTIFY). */
  onAction(alertId: string, action: 'ack' | 'mute', by: string, at = new Date()): Promise<void> {
    return this.enqueue(async () => {
      const target = await this.store.alertTarget(alertId);
      if (!target) return;
      const rule = this.rules.find((r) => r.id === target.ruleId);
      const device = this.devices.get(target.deviceId);
      if (!rule || !device) return;
      const input: RuleInput =
        action === 'ack'
          ? { kind: 'ack', at: at.getTime(), by }
          : { kind: 'mute', at: at.getTime(), forSeconds: 3600 };
      await this.step(rule, device, input);
    });
  }

  private async step(rule: EngineRule, device: EngineDevice, input: RuleInput): Promise<void> {
    const k = this.key(rule.id, device.id);
    const slot = this.slots.get(k) ?? { state: INITIAL_RULE_STATE, alertId: null, dirty: false };
    const { state, effects } = evaluate({ ...rule, timezone: device.timezone }, slot.state, input);
    const statusChanged = state.status !== slot.state.status;
    const peakChanged = state.peak !== slot.state.peak;
    slot.state = state;
    this.slots.set(k, slot);

    for (const effect of effects) await this.apply(rule, device, slot, effect);

    // Status changes are written at once (they must survive a restart); peaks are batched by the clock.
    if (statusChanged || effects.length > 0) {
      await this.store.saveState({
        ruleId: rule.id,
        deviceId: device.id,
        state: slot.state,
        alertId: slot.alertId,
      });
      if (
        slot.alertId &&
        statusChanged &&
        (state.status === 'firing' || state.status === 'acknowledged' || state.status === 'muted')
      ) {
        await this.store.updateAlert(slot.alertId, { state: state.status, peak: state.peak });
      }
      slot.dirty = false;
    } else if (peakChanged) {
      slot.dirty = true;
    }
  }

  private async apply(rule: EngineRule, device: EngineDevice, slot: Slot, e: RuleEffect): Promise<void> {
    const at = new Date(e.at);
    switch (e.type) {
      case 'pending':
        return;
      case 'open': {
        slot.alertId = await this.store.openAlert(rule.id, device.id, at, e.value);
        await this.store.addEvent(slot.alertId, at, 'opened', {
          value: e.value,
          crossedAt: slot.state.since ? new Date(slot.state.since).toISOString() : null,
        });
        await this.store.announce(this.change(rule, device, slot, 'firing', at));
        this.log.info({ rule: rule.name, device: device.id, value: e.value }, 'alert opened');
        return;
      }
      case 'notify': {
        // A "resolved" notification follows the resolve effect, which has already cleared slot.alertId.
        const alertId =
          slot.alertId ??
          (e.reason === 'resolved' ? this.lastResolved.get(this.key(rule.id, device.id)) : undefined);
        if (!alertId) return;
        await this.store.addEvent(alertId, at, e.reason === 'escalation' ? 'escalated' : 'notified', {
          reason: e.reason,
          channels: rule.channels,
        });
        this.notify(rule, device, alertId, e.reason, e.value);
        return;
      }
      case 'suppressed':
        if (slot.alertId)
          await this.store.addEvent(slot.alertId, at, 'suppressed', { reason: e.reason, why: e.why });
        return;
      case 'acknowledge':
        if (!slot.alertId) return;
        await this.store.updateAlert(slot.alertId, {
          state: 'acknowledged',
          acknowledgedAt: at,
          acknowledgedBy: e.by,
        });
        await this.store.addEvent(slot.alertId, at, 'acknowledged', { by: e.by });
        await this.store.announce(this.change(rule, device, slot, 'acknowledged', at));
        return;
      case 'mute':
        if (!slot.alertId) return;
        await this.store.updateAlert(slot.alertId, { state: 'muted' });
        await this.store.addEvent(slot.alertId, at, 'muted', { until: new Date(e.until).toISOString() });
        await this.store.announce(this.change(rule, device, slot, 'muted', at));
        return;
      case 'resolve': {
        const alertId = slot.alertId;
        if (!alertId) return;
        await this.store.updateAlert(alertId, { state: 'resolved', resolvedAt: at, peak: e.peak });
        await this.store.addEvent(alertId, at, 'resolved', { peak: e.peak });
        await this.store.announce({ ...this.change(rule, device, slot, 'resolved', at), peakValue: e.peak });
        slot.alertId = null;
        // The resolved notification is sent by a following 'notify' effect, which needs the id.
        this.lastResolved.set(this.key(rule.id, device.id), alertId);
        this.log.info({ rule: rule.name, device: device.id }, 'alert resolved');
        return;
      }
    }
  }

  private readonly lastResolved = new Map<string, string>();

  private change(
    rule: EngineRule,
    device: EngineDevice,
    slot: Slot,
    state: 'firing' | 'acknowledged' | 'muted' | 'resolved',
    at: Date,
  ) {
    return {
      alertId: slot.alertId ?? '',
      ruleId: rule.id,
      deviceId: device.id,
      state,
      severity: rule.severity,
      peakValue: slot.state.peak,
      at: at.toISOString(),
    };
  }

  private format(metric: string | null, value: number | null): string {
    if (value === null || !metric || !isMetricKey(metric)) return 'no data';
    const def = METRICS[metric];
    return `${value.toFixed(def.precision)}${def.unit ? ` ${def.unit}` : ''}`;
  }

  /** Builds the message text in the contact's language. */
  message(
    rule: EngineRule,
    device: EngineDevice,
    reason: AlertMessage['reason'],
    value: number | null,
    locale: 'en' | 'ar',
  ): AlertMessage {
    const ar = locale === 'ar';
    const place = (ar ? device.placeAr : device.placeEn).split(/[،,]/)[0]?.trim() ?? '';
    const subject = `${ar ? device.nameAr : device.nameEn}${ar ? '، ' : ', '}${place}`;
    const minutes = Math.round(rule.forSeconds / 60);
    const threshold = this.format(rule.metric, rule.threshold);
    let detail: string;
    if (rule.operator === 'offline') {
      detail =
        reason === 'resolved'
          ? ar
            ? 'عاد الجهاز للإرسال.'
            : 'It is reporting again.'
          : ar
            ? `لا رسائل منذ ${minutes} دقائق.`
            : `No message for ${minutes} minutes.`;
    } else if (reason === 'resolved') {
      const clear = this.format(rule.metric, rule.clearThreshold ?? rule.threshold);
      detail = ar
        ? `عادت القراءة إلى ما دون ${clear}.`
        : `Back ${rule.operator === 'lt' ? 'above' : 'below'} ${clear}.`;
    } else {
      const dir = rule.operator === 'lt' ? (ar ? 'أقل من' : 'below') : ar ? 'أعلى من' : 'above';
      detail = ar
        ? `القراءة ${dir} ${threshold} منذ ${minutes} دقائق.`
        : `It has been ${dir} ${threshold} for ${minutes} minutes.`;
    }
    const door = this.latest.get(device.id)?.get('door');
    if (door !== undefined && reason !== 'resolved')
      detail += ar ? (door ? ' الباب: مفتوح.' : ' الباب: مغلق.') : door ? ' Door: open.' : ' Door: closed.';
    return {
      severity: rule.severity,
      reason,
      subject,
      value: rule.operator === 'offline' ? (ar ? 'لا بيانات' : 'no data') : this.format(rule.metric, value),
      detail,
      locale,
      alertId: null,
    };
  }

  /** Sends in the background; every attempt is logged in `notifications`. */
  private notify(
    rule: EngineRule,
    device: EngineDevice,
    id: string,
    reason: 'opened' | 'escalation' | 'resolved',
    value: number | null,
  ) {
    const job = (async () => {
      const contacts: Contact[] = await this.store.contactsFor(rule.id);
      for (const contact of contacts) {
        for (const channel of rule.channels) {
          const provider = this.providers[channel];
          // The console provider (dev, demo) stands in for any address; a real provider needs one.
          const address = channel === 'whatsapp' ? contact.whatsappE164 : contact.email;
          const recipient = provider.channel === 'console' ? (address ?? contact.name) : address;
          if (!recipient) continue;
          const message = { ...this.message(rule, device, reason, value, contact.locale), alertId: id };
          await sendWithRetry(provider, recipient, message, {
            onAttempt: (a) =>
              this.store.logNotification({
                alertId: id,
                channel: provider.channel,
                recipient,
                status: a.ok ? 'sent' : 'failed',
                attempt: a.attempt,
                providerMessageId: a.providerMessageId,
                error: a.error,
              }),
          });
        }
      }
    })().catch((err: unknown) => this.log.error({ err, alertId: id }, 'notification failed'));
    this.sending.add(job);
    void job.finally(() => this.sending.delete(job));
  }

  /** Waits for queued rule work and in-flight notifications (shutdown, tests). */
  async idle(): Promise<void> {
    await this.queue;
    await Promise.all([...this.sending]);
  }
}
