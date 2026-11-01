/**
 * Everything the demo keeps, in memory: the API's `Store` and the rules engine's `RulesStore` in one object,
 * with the same answers as `PgStore` and `PgRulesStore` give from TimescaleDB. It holds one hour of raw
 * readings (for charts and WebSocket back-fill) and 24 hours of one-minute roll-ups (min/max/sum/count, like
 * `readings_1m`); hour and day series are built from those. A restart starts over, which is fine for a demo:
 * the back-fill (backfill.ts) rebuilds the last day on boot.
 */
import {
  SEED_CONTACT,
  SEED_DEVICES,
  SEED_RULES,
  SEED_SITES,
  type AlertDto,
  type CommandDto,
  type DeviceDto,
  type FirmwareDto,
  type FleetEventDto,
  type HistoryDto,
  type RuleBody,
  type RuleDto,
  type RuleState,
  type SeriesDto,
  type SeriesSource,
  type SiteDto,
} from '@nabd/shared';
import type { CommandPatch, NewCommand, Store, StoredMessage, UserRecord } from '@nabd/api/store';
import type {
  AlertChange,
  Contact,
  EngineDevice,
  EngineRule,
  NotificationRow,
  RulesStore,
  StoredRuleState,
} from '@nabd/ingest/rules/types';
import type { Routed } from '@nabd/ingest/route';

export type StatusUpdate = Extract<Routed, { kind: 'status' }>['update'];

export const RAW_KEEP_MS = 60 * 60_000;
export const MINUTES_KEEP_MS = 25 * 60 * 60_000;
const MAX_POINTS = 2000;
const MAX_ALERTS = 500;
const MAX_COMMANDS = 500;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SEVERITY_RANK = { warning: 1, critical: 2 } as const;
const RANKED = ['ok', 'warning', 'critical'] as const;

interface Bucket {
  sum: number;
  count: number;
  min: number;
  max: number;
}

interface DeviceState {
  online: boolean;
  fw: string | null;
  rssi: number | null;
  uptimeS: number | null;
  bootReason: string | null;
  lastSeenAt: number | null;
  latest: Map<string, { value: number; ts: number }>;
}

interface AlertRecord {
  id: string;
  ruleId: number;
  deviceId: string;
  state: AlertDto['state'];
  openedAt: number;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  resolvedAt: number | null;
  peakValue: number | null;
  events: { at: number; kind: string; detail: Record<string, unknown> }[];
}

type StoredRule = Omit<RuleDto, 'state'>;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** Midnight in Cairo, as epoch ms. Cairo's offset is read from Intl, so daylight saving is handled. */
export function cairoMidnight(now: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnight = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now % 1000);
  return now - sinceMidnight;
}

export class DemoStore implements Store, RulesStore {
  private readonly devices = new Map<string, DeviceState>();
  /** Raw telemetry messages per device, oldest first. */
  private readonly raw = new Map<string, StoredMessage[]>();
  /** One-minute roll-ups per `device|metric`, keyed by bucket start (ms), oldest first. */
  private readonly minutes = new Map<string, Map<number, Bucket>>();
  private rules: StoredRule[];
  private nextRuleId: number;
  private readonly alerts = new Map<string, AlertRecord>();
  private nextAlertId = 1;
  private readonly ruleStates = new Map<string, StoredRuleState>();
  private readonly commands = new Map<string, CommandDto>();
  private readonly notifications: (NotificationRow & { at: number })[] = [];
  private readonly refresh = new Map<string, { userId: number; used: boolean; expiresAt: number }>();

  /** Set by main.ts: pushes alert changes to dashboards (the PgRulesStore does this with NOTIFY). */
  onAnnounce: (change: AlertChange) => void = () => {};
  /** Set by main.ts: hands acknowledge and mute to the rules engine (NOTIFY in the full stack). */
  onAlertAction: (alertId: string, action: 'ack' | 'mute', by: string) => void = () => {};

  constructor(
    /** The real board, if one reports to this demo. Every other device is labelled simulated. */
    private readonly realDevice: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    for (const d of SEED_DEVICES) {
      this.devices.set(d.id, {
        online: false,
        fw: d.fw,
        rssi: null,
        uptimeS: null,
        bootReason: null,
        lastSeenAt: null,
        latest: new Map(),
      });
      this.raw.set(d.id, []);
    }
    this.rules = SEED_RULES.map((r, i) => ({
      id: i + 1,
      name: r.name,
      deviceId: r.deviceId,
      siteSlug: r.siteSlug,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      thresholdHigh: r.thresholdHigh,
      forSeconds: r.forSeconds,
      clearThreshold: r.clearThreshold,
      cooldownSeconds: r.cooldownSeconds,
      severity: r.severity,
      quietHours: r.quietHours,
      channels: [...r.channels],
      escalateAfterSeconds: r.escalateAfterSeconds,
      enabled: true,
    }));
    this.nextRuleId = this.rules.length + 1;
  }

  // ---- Writes from the demo's ingest path ----

  /** Stores one telemetry message: raw (last hour), one-minute roll-ups and the latest value per metric. */
  addMessage(deviceId: string, seq: number, ts: Date, m: Record<string, number | null | undefined>): void {
    const at = ts.getTime();
    const values: Record<string, number> = {};
    for (const [metric, value] of Object.entries(m)) {
      if (value === null || value === undefined) continue;
      values[metric] = value;
    }
    const device = this.devices.get(deviceId);
    if (!device) return;

    const now = this.now();
    const rawCutoff = now - RAW_KEEP_MS;
    // Most of the back-fill is older than the raw window: those messages only feed the roll-ups.
    if (at >= rawCutoff) {
      const list = this.raw.get(deviceId)!;
      list.push({ deviceId, seq, ts: ts.toISOString(), m: values });
      while (list.length && Date.parse(list[0]!.ts) < rawCutoff) list.shift();
    }

    const bucketAt = at - (at % MINUTE);
    const minuteCutoff = now - MINUTES_KEEP_MS;
    for (const [metric, value] of Object.entries(values)) {
      const key = `${deviceId}|${metric}`;
      let series = this.minutes.get(key);
      if (!series) this.minutes.set(key, (series = new Map()));
      const b = series.get(bucketAt);
      if (b) {
        b.sum += value;
        b.count += 1;
        b.min = Math.min(b.min, value);
        b.max = Math.max(b.max, value);
      } else {
        series.set(bucketAt, { sum: value, count: 1, min: value, max: value });
        for (const start of series.keys()) {
          if (start >= minuteCutoff) break;
          series.delete(start);
        }
      }
      const prev = device.latest.get(metric);
      if (!prev || prev.ts <= at) device.latest.set(metric, { value, ts: at });
    }
    device.lastSeenAt = Math.max(device.lastSeenAt ?? 0, at);
  }

  updateStatus(u: StatusUpdate): void {
    const d = this.devices.get(u.deviceId);
    if (!d) return;
    d.online = u.online;
    if (u.fw !== undefined) d.fw = u.fw ?? d.fw;
    if (u.rssi !== undefined) d.rssi = u.rssi ?? null;
    if (u.uptimeS !== undefined) d.uptimeS = u.uptimeS ?? null;
    if (u.bootReason !== undefined) d.bootReason = u.bootReason ?? null;
    if (u.online) d.lastSeenAt = Math.max(d.lastSeenAt ?? 0, u.at.getTime());
  }

  // ---- Store (API) ----

  private worstOpen(deviceIds: readonly string[]): 0 | 1 | 2 {
    let worst: 0 | 1 | 2 = 0;
    for (const a of this.alerts.values()) {
      if (a.state === 'resolved' || !deviceIds.includes(a.deviceId)) continue;
      const rule = this.rules.find((r) => r.id === a.ruleId);
      if (rule) worst = Math.max(worst, SEVERITY_RANK[rule.severity]) as 0 | 1 | 2;
    }
    return worst;
  }

  async listSites(): Promise<SiteDto[]> {
    return SEED_SITES.map((s) => {
      const deviceIds = SEED_DEVICES.filter((d) => d.siteSlug === s.slug).map((d) => d.id);
      return {
        slug: s.slug,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        placeEn: s.placeEn,
        placeAr: s.placeAr,
        kind: s.kind,
        timezone: s.timezone,
        lat: s.lat,
        lng: s.lng,
        image: s.image,
        status: RANKED[this.worstOpen(deviceIds)],
        deviceIds,
      };
    });
  }

  async listDevices(): Promise<DeviceDto[]> {
    const hourAgo = this.now() - HOUR;
    return SEED_DEVICES.map((d) => {
      const s = this.devices.get(d.id)!;
      const latest: DeviceDto['latest'] = {};
      for (const [metric, l] of s.latest) {
        if (l.ts > hourAgo) latest[metric] = { value: l.value, ts: new Date(l.ts).toISOString() };
      }
      const worst = this.worstOpen([d.id]);
      return {
        id: d.id,
        siteSlug: d.siteSlug,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        kind: d.profile,
        isSimulated: d.id !== this.realDevice,
        fwVersion: s.fw,
        online: s.online,
        rssi: s.rssi,
        uptimeS: s.uptimeS,
        bootReason: s.bootReason,
        lastSeenAt: iso(s.lastSeenAt),
        latest,
        status: !s.online ? 'offline' : worst === 2 ? 'critical' : worst === 1 ? 'warning' : 'ok',
      };
    });
  }

  async getDevice(id: string) {
    return (await this.listDevices()).find((d) => d.id === id) ?? null;
  }

  async series(
    deviceId: string,
    metric: string,
    from: Date,
    to: Date,
    source: SeriesSource,
  ): Promise<SeriesDto> {
    const lo = from.getTime();
    const hi = to.getTime();
    let points: SeriesDto['points'] = [];
    if (source === 'raw') {
      for (const msg of this.raw.get(deviceId) ?? []) {
        const t = Date.parse(msg.ts);
        const v = msg.m[metric as keyof typeof msg.m];
        if (t < lo || t >= hi || v === null || v === undefined) continue;
        points.push({ t: msg.ts, avg: v, min: v, max: v });
      }
    } else {
      const width = source === '1m' ? MINUTE : source === '1h' ? HOUR : DAY;
      const rolled = new Map<number, Bucket>();
      for (const [start, b] of this.minutes.get(`${deviceId}|${metric}`) ?? []) {
        const at = start - (start % width);
        if (at < lo || at >= hi) continue;
        const r = rolled.get(at);
        if (r) {
          r.sum += b.sum;
          r.count += b.count;
          r.min = Math.min(r.min, b.min);
          r.max = Math.max(r.max, b.max);
        } else rolled.set(at, { ...b });
      }
      points = [...rolled].map(([at, b]) => ({
        t: new Date(at).toISOString(),
        avg: b.sum / b.count,
        min: b.min,
        max: b.max,
      }));
    }
    return {
      deviceId,
      metric,
      source,
      from: from.toISOString(),
      to: to.toISOString(),
      points: points.slice(0, MAX_POINTS),
    };
  }

  async readingsToday(): Promise<number> {
    const midnight = cairoMidnight(this.now());
    let n = 0;
    for (const series of this.minutes.values()) {
      for (const [start, b] of series) if (start >= midnight) n += b.count;
    }
    return n;
  }

  async recentMinutes(deviceId: string, metric: string): Promise<number[]> {
    const since = this.now() - 30 * MINUTE;
    return [...(this.minutes.get(`${deviceId}|${metric}`) ?? [])]
      .filter(([start]) => start >= since)
      .map(([, b]) => b.sum / b.count);
  }

  async realDeviceStats() {
    // The case-study figures cover 30 days of the real board; the demo never holds that much.
    return null;
  }

  async siteHistory(): Promise<HistoryDto[]> {
    const now = this.now();
    const thisHour = now - (now % HOUR);
    return SEED_SITES.map((s) => {
      const ids: string[] = SEED_DEVICES.filter((d) => d.siteSlug === s.slug).map((d) => d.id);
      const hours: HistoryDto['hours'] = [];
      for (let i = 23; i >= 0; i--) {
        const h = thisHour - i * HOUR;
        let worst = 0;
        for (const a of this.alerts.values()) {
          if (!ids.includes(a.deviceId) || a.openedAt >= h + HOUR || (a.resolvedAt ?? now) < h) continue;
          const rule = this.rules.find((r) => r.id === a.ruleId);
          if (rule) worst = Math.max(worst, SEVERITY_RANK[rule.severity]);
        }
        hours.push(RANKED[worst]!);
      }
      return {
        slug: s.slug,
        hours,
        uptimePct: Math.round((hours.filter((h) => h !== 'critical').length / hours.length) * 1000) / 10,
      };
    });
  }

  async recentEvents(limit: number): Promise<FleetEventDto[]> {
    const events: (FleetEventDto & { ms: number })[] = [];
    for (const a of this.alerts.values()) {
      const rule = this.rules.find((r) => r.id === a.ruleId);
      for (const e of a.events) {
        if (!['opened', 'resolved', 'acknowledged', 'escalated'].includes(e.kind)) continue;
        events.push({
          ms: e.at,
          at: iso(e.at)!,
          kind: 'alert',
          severity: rule?.severity ?? 'warning',
          title: rule?.name ?? `Rule ${a.ruleId}`,
          detail: e.kind,
          deviceId: a.deviceId,
        });
      }
    }
    for (const c of this.commands.values()) {
      const at = c.doneAt ?? c.createdAt;
      events.push({
        ms: Date.parse(at),
        at,
        kind: 'command',
        severity: 'info',
        title: `${c.op} ${JSON.stringify(c.args)}`,
        detail: c.state,
        deviceId: c.deviceId,
      });
    }
    return events
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit)
      .map(({ ms: _ms, ...e }) => e);
  }

  async messagesSince(deviceId: string, afterSeq: number, since: Date, limit: number) {
    const from = since.getTime();
    return (this.raw.get(deviceId) ?? [])
      .filter((m) => m.seq > afterSeq && Date.parse(m.ts) >= from)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
  }

  async createCommand(c: NewCommand): Promise<CommandDto> {
    const dto: CommandDto = {
      id: c.id,
      deviceId: c.deviceId,
      op: c.op,
      args: c.args,
      state: 'pending',
      requestedBy: c.requestedBy,
      createdAt: new Date(this.now()).toISOString(),
      sentAt: null,
      deliveredAt: null,
      doneAt: null,
      expiresAt: c.expiresAt.toISOString(),
      error: null,
      result: null,
    };
    this.commands.set(c.id, dto);
    if (this.commands.size > MAX_COMMANDS) this.commands.delete(this.commands.keys().next().value!);
    return dto;
  }

  async updateCommand(id: string, p: CommandPatch) {
    const c = this.commands.get(id);
    if (!c) return null;
    const next: CommandDto = {
      ...c,
      state: p.state,
      sentAt: p.sentAt?.toISOString() ?? c.sentAt,
      deliveredAt: p.deliveredAt?.toISOString() ?? c.deliveredAt,
      doneAt: p.doneAt?.toISOString() ?? c.doneAt,
      error: p.error !== undefined ? p.error : c.error,
      result: p.result ?? c.result,
    };
    this.commands.set(id, next);
    return next;
  }

  async getCommand(id: string) {
    return this.commands.get(id) ?? null;
  }

  async openCommands() {
    return [...this.commands.values()].filter((c) => ['pending', 'sent', 'delivered'].includes(c.state));
  }

  private toRuleDto(r: StoredRule): RuleDto {
    const firing = [...this.alerts.values()].some((a) => a.ruleId === r.id && a.state !== 'resolved');
    return { ...r, state: firing ? 'firing' : 'ok' };
  }

  async listRules() {
    return this.rules.map((r) => this.toRuleDto(r));
  }

  async getRule(id: number) {
    const r = this.rules.find((x) => x.id === id);
    return r ? this.toRuleDto(r) : null;
  }

  async createRule(rule: RuleBody) {
    const stored: StoredRule = { ...rule, id: this.nextRuleId++ };
    this.rules.push(stored);
    return this.toRuleDto(stored);
  }

  async updateRule(id: number, rule: RuleBody) {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.rules[i] = { ...rule, id };
    return this.toRuleDto(this.rules[i]!);
  }

  async deleteRule(id: number) {
    const rule = this.rules.find((r) => r.id === id);
    if (!rule) return false;
    // Alerts keep their history: a rule with alerts is disabled instead of deleted, as in PgStore.
    if ([...this.alerts.values()].some((a) => a.ruleId === id)) rule.enabled = false;
    else this.rules = this.rules.filter((r) => r.id !== id);
    return true;
  }

  async minuteSeries(deviceId: string, metric: string, from: Date, to: Date, pick: 'min' | 'max' | 'avg') {
    const lo = from.getTime();
    const hi = to.getTime();
    return [...(this.minutes.get(`${deviceId}|${metric}`) ?? [])]
      .filter(([start]) => start >= lo && start < hi)
      .map(([at, b]) => ({ at, value: pick === 'avg' ? b.sum / b.count : b[pick] }));
  }

  async ruleDevices(rule: Pick<RuleDto, 'deviceId' | 'siteSlug'>) {
    if (rule.deviceId) return [rule.deviceId];
    return SEED_DEVICES.filter((d) => !rule.siteSlug || d.siteSlug === rule.siteSlug).map((d) => d.id);
  }

  private toAlertDto(a: AlertRecord, withEvents = false): AlertDto {
    const rule = this.rules.find((r) => r.id === a.ruleId);
    return {
      id: a.id,
      ruleId: a.ruleId,
      ruleName: rule?.name ?? `Rule ${a.ruleId}`,
      deviceId: a.deviceId,
      siteSlug: SEED_DEVICES.find((d) => d.id === a.deviceId)?.siteSlug ?? '',
      severity: rule?.severity ?? 'warning',
      state: a.state,
      openedAt: iso(a.openedAt)!,
      acknowledgedAt: iso(a.acknowledgedAt),
      acknowledgedBy: a.acknowledgedBy,
      resolvedAt: iso(a.resolvedAt),
      peakValue: a.peakValue,
      ...(withEvents
        ? {
            events: [...a.events]
              .sort((x, y) => x.at - y.at)
              .map((e) => ({ at: iso(e.at)!, kind: e.kind, detail: e.detail })),
          }
        : {}),
    };
  }

  async listAlerts(opts: { open?: boolean; limit: number }) {
    return [...this.alerts.values()]
      .filter((a) => !opts.open || a.state !== 'resolved')
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, opts.limit)
      .map((a) => this.toAlertDto(a));
  }

  async getAlert(id: string) {
    const a = this.alerts.get(id);
    return a ? this.toAlertDto(a, true) : null;
  }

  async alertForRecipient(recipient: string) {
    for (let i = this.notifications.length - 1; i >= 0; i--) {
      const n = this.notifications[i]!;
      if (n.recipient !== recipient || n.channel !== 'whatsapp') continue;
      if (this.alerts.get(n.alertId)?.state !== 'resolved') return n.alertId;
    }
    return null;
  }

  async requestAlertAction(alertId: string, action: 'ack' | 'mute', by: string) {
    this.onAlertAction(alertId, action, by);
  }

  async listFirmware(): Promise<FirmwareDto[]> {
    // Signed releases come from the real signing key, which never leaves the owner's machine.
    return [];
  }

  async getFirmware() {
    return null;
  }

  async recordRollout() {}

  async findUserByEmail(): Promise<UserRecord | null> {
    // The demo has no accounts: visitors are anonymous and limited to the simulated devices.
    return null;
  }

  async getUser(): Promise<UserRecord | null> {
    return null;
  }

  async saveRefreshToken(hash: string, userId: number, expiresAt: Date) {
    this.refresh.set(hash, { userId, used: false, expiresAt: expiresAt.getTime() });
  }

  async consumeRefreshToken(hash: string) {
    const t = this.refresh.get(hash);
    if (!t || t.used || t.expiresAt <= this.now()) return null;
    t.used = true;
    return t.userId;
  }

  async revokeRefreshToken(hash: string) {
    const t = this.refresh.get(hash);
    if (t) t.used = true;
  }

  // ---- RulesStore (rules engine) ----

  async loadRules(): Promise<EngineRule[]> {
    return this.rules.map((r) => ({
      id: r.id,
      name: r.name,
      deviceId: r.deviceId,
      siteSlug: r.siteSlug,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      thresholdHigh: r.thresholdHigh,
      forSeconds: r.forSeconds,
      clearThreshold: r.clearThreshold,
      cooldownSeconds: r.cooldownSeconds,
      severity: r.severity,
      quietHours: r.quietHours,
      timezone: 'Africa/Cairo', // replaced per device by the engine
      escalateAfterSeconds: r.escalateAfterSeconds,
      channels: r.channels,
      enabled: r.enabled,
    }));
  }

  async loadDevices(): Promise<EngineDevice[]> {
    return SEED_DEVICES.map((d) => {
      const site = SEED_SITES.find((s) => s.slug === d.siteSlug)!;
      return {
        id: d.id,
        siteSlug: d.siteSlug,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        placeEn: site.placeEn,
        placeAr: site.placeAr,
        timezone: site.timezone,
        lastSeenAt: this.devices.get(d.id)?.lastSeenAt ?? null,
      };
    });
  }

  async loadStates() {
    return [...this.ruleStates.values()];
  }

  async contactsFor(): Promise<Contact[]> {
    // As in the database seed: the one demo contact (no real number) is on every rule.
    return [{ id: 1, ...SEED_CONTACT }];
  }

  async saveState(s: StoredRuleState) {
    this.ruleStates.set(`${s.ruleId}|${s.deviceId}`, { ...s, state: structuredClone(s.state) as RuleState });
  }

  async openAlert(ruleId: number, deviceId: string, at: Date, value: number | null) {
    const id = String(this.nextAlertId++);
    this.alerts.set(id, {
      id,
      ruleId,
      deviceId,
      state: 'firing',
      openedAt: at.getTime(),
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      peakValue: value,
      events: [],
    });
    if (this.alerts.size > MAX_ALERTS) {
      for (const [old, a] of this.alerts) {
        if (a.state === 'resolved') {
          this.alerts.delete(old);
          break;
        }
      }
    }
    return id;
  }

  async updateAlert(
    id: string,
    p: {
      state: AlertChange['state'];
      peak?: number | null;
      acknowledgedAt?: Date;
      acknowledgedBy?: string;
      resolvedAt?: Date;
    },
  ) {
    const a = this.alerts.get(id);
    if (!a) return;
    a.state = p.state;
    if (p.peak !== undefined && p.peak !== null) a.peakValue = p.peak;
    if (p.acknowledgedAt) a.acknowledgedAt = p.acknowledgedAt.getTime();
    if (p.acknowledgedBy) a.acknowledgedBy = p.acknowledgedBy;
    if (p.resolvedAt) a.resolvedAt = p.resolvedAt.getTime();
  }

  async addEvent(alertId: string, at: Date, kind: string, detail: Record<string, unknown>) {
    this.alerts.get(alertId)?.events.push({ at: at.getTime(), kind, detail });
  }

  async logNotification(n: NotificationRow) {
    this.notifications.push({ ...n, at: this.now() });
    if (this.notifications.length > MAX_ALERTS) this.notifications.shift();
  }

  async announce(change: AlertChange) {
    this.onAnnounce(change);
  }

  async alertTarget(alertId: string) {
    const a = this.alerts.get(alertId);
    return a ? { ruleId: a.ruleId, deviceId: a.deviceId } : null;
  }
}
