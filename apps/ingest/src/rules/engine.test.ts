import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEED_RULES, type RuleState } from '@nabd/shared';
import type { AlertMessage, Provider } from '@nabd/notify';
import { RulesEngine } from './engine.js';
import type {
  AlertChange,
  EngineDevice,
  EngineRule,
  NotificationRow,
  RulesStore,
  StoredRuleState,
} from './types.js';

const fridgeRule: EngineRule = {
  ...SEED_RULES[0],
  id: 1,
  channels: ['whatsapp', 'email'],
  timezone: 'Africa/Cairo',
  enabled: true,
};
const offlineRule: EngineRule = {
  ...SEED_RULES[1],
  id: 2,
  channels: ['whatsapp'],
  timezone: 'Africa/Cairo',
  enabled: true,
};

const fridge: EngineDevice = {
  id: 'nabd-07',
  siteSlug: 'heliopolis',
  nameEn: 'Medicine fridge',
  nameAr: 'ثلاجة الأدوية',
  placeEn: 'Heliopolis, Cairo',
  placeAr: 'مصر الجديدة، القاهرة',
  timezone: 'Africa/Cairo',
  lastSeenAt: null,
};

class FakeStore implements RulesStore {
  rules: EngineRule[] = [fridgeRule];
  devices: EngineDevice[] = [fridge];
  states = new Map<string, StoredRuleState>();
  alerts = new Map<
    string,
    { ruleId: number; deviceId: string; state: string; peak: number | null; ackBy?: string }
  >();
  events: { alertId: string; kind: string; detail: Record<string, unknown> }[] = [];
  notifications: NotificationRow[] = [];
  announced: AlertChange[] = [];

  async loadRules() {
    return this.rules;
  }
  async loadDevices() {
    return this.devices;
  }
  async loadStates() {
    return [...this.states.values()];
  }
  async contactsFor() {
    return [
      {
        id: 1,
        name: 'Clinic manager (demo)',
        whatsappE164: null,
        email: 'demo@example.com',
        locale: 'en' as const,
      },
    ];
  }
  async saveState(s: StoredRuleState) {
    this.states.set(`${s.ruleId}:${s.deviceId}`, structuredClone(s));
  }
  async openAlert(ruleId: number, deviceId: string, _at: Date, value: number | null) {
    const id = String(this.alerts.size + 1);
    this.alerts.set(id, { ruleId, deviceId, state: 'firing', peak: value });
    return id;
  }
  async updateAlert(id: string, p: { state: string; peak?: number | null; acknowledgedBy?: string }) {
    const a = this.alerts.get(id)!;
    a.state = p.state;
    if (p.peak !== undefined) a.peak = p.peak;
    if (p.acknowledgedBy) a.ackBy = p.acknowledgedBy;
  }
  async addEvent(alertId: string, _at: Date, kind: string, detail: Record<string, unknown>) {
    this.events.push({ alertId, kind, detail });
  }
  async logNotification(n: NotificationRow) {
    this.notifications.push(n);
  }
  async announce(c: AlertChange) {
    this.announced.push(c);
  }
  async alertTarget(id: string) {
    const a = this.alerts.get(id);
    return a ? { ruleId: a.ruleId, deviceId: a.deviceId } : null;
  }
}

/** A provider that behaves like the console one but records what it would have sent. */
function recorder() {
  const sent: { to: string; message: AlertMessage }[] = [];
  const provider: Provider = {
    channel: 'console',
    send: async (to, message) => {
      sent.push({ to, message });
      return { providerMessageId: `m${sent.length}` };
    },
  };
  return { sent, provider };
}

const silent = { info: () => {}, error: () => {} };
const MIN = 60_000;

describe('RulesEngine', () => {
  // The engine skips readings older than 60 s (replays), so the clock is faked to match the readings.
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  async function feed(engine: RulesEngine, from: number, minutes: number, probe: number, door = 1) {
    for (let t = from; t < from + minutes * MIN; t += 2000) {
      vi.setSystemTime(t);
      await engine.onReading('nabd-07', new Date(t), { probe_c: probe, door, compressor: 1 });
    }
  }

  it('runs the fridge scenario: one alert after 5 min, one message per channel, ack, resolve below 7.5 °C', async () => {
    const store = new FakeStore();
    const { sent, provider } = recorder();
    const engine = new RulesEngine(store, { whatsapp: provider, email: provider }, silent);
    await engine.load();

    const t0 = Date.parse('2026-10-14T11:31:00Z');
    await feed(engine, t0, 6, 8.3);
    await engine.idle();

    expect(store.alerts.size).toBe(1);
    expect(store.events.map((e) => e.kind)).toEqual(['opened', 'notified']);
    expect(store.events[0]?.detail.crossedAt).toBe(new Date(t0).toISOString());
    // WhatsApp (to the demo contact by name, console) and email.
    expect(sent.map((s) => s.to)).toEqual(['Clinic manager (demo)', 'demo@example.com']);
    expect(sent[0]?.message).toMatchObject({
      subject: 'Medicine fridge, Heliopolis',
      value: '8.3 °C',
      detail: 'It has been above 8.0 °C for 5 minutes. Door: open.',
    });

    // Still warm for another 10 minutes: no second message (cooldown and no re-open).
    await feed(engine, t0 + 6 * MIN, 10, 8.4);
    await engine.onAction('1', 'ack', 'whatsapp:+201000000000', new Date(t0 + 16 * MIN));
    await feed(engine, t0 + 16 * MIN, 1, 7.8); // above the clear threshold
    await feed(engine, t0 + 17 * MIN, 1, 7.2, 0);
    await engine.idle();

    expect(store.alerts.get('1')).toMatchObject({
      state: 'resolved',
      peak: 8.4,
      ackBy: 'whatsapp:+201000000000',
    });
    expect(store.events.map((e) => e.kind)).toEqual([
      'opened',
      'notified',
      'acknowledged',
      'resolved',
      'notified',
    ]);
    expect(sent.filter((s) => s.message.reason === 'opened')).toHaveLength(2);
    expect(sent.filter((s) => s.message.reason === 'resolved')).toHaveLength(2);
    expect(store.announced.map((a) => a.state)).toEqual(['firing', 'acknowledged', 'resolved']);
    expect(store.notifications.every((n) => n.status === 'sent' && n.alertId === '1')).toBe(true);
  });

  it('keeps a pending timer across a restart', async () => {
    const store = new FakeStore();
    const { provider } = recorder();
    const t0 = Date.parse('2026-10-14T11:31:00Z');

    const first = new RulesEngine(store, { whatsapp: provider, email: provider }, silent);
    await first.load();
    await feed(first, t0, 3, 8.5);
    await first.idle();
    expect((store.states.get('1:nabd-07')?.state as RuleState).status).toBe('pending');

    const second = new RulesEngine(store, { whatsapp: provider, email: provider }, silent);
    await second.load();
    await feed(second, t0 + 3 * MIN, 2.5, 8.5);
    await second.idle();
    expect(store.alerts.size).toBe(1); // 5 minutes in total, across both processes
  });

  it('opens "Device stopped reporting" from the clock after 5 minutes of silence', async () => {
    const store = new FakeStore();
    store.rules = [offlineRule];
    store.devices = [
      {
        ...fridge,
        id: 'nabd-11',
        siteSlug: 'tenth-of-ramadan',
        lastSeenAt: Date.parse('2026-10-14T11:00:00Z'),
      },
    ];
    const { sent, provider } = recorder();
    const engine = new RulesEngine(store, { whatsapp: provider, email: provider }, silent);
    await engine.load();

    await engine.tick(new Date('2026-10-14T11:04:00Z'));
    expect(store.alerts.size).toBe(0);
    await engine.tick(new Date('2026-10-14T11:05:30Z'));
    await engine.idle();
    expect(store.alerts.size).toBe(1);
    expect(sent[0]?.message).toMatchObject({ value: 'no data', detail: 'No message for 5 minutes.' });

    vi.setSystemTime(Date.parse('2026-10-14T11:15:00Z'));
    await engine.onReading('nabd-11', new Date('2026-10-14T11:15:00Z'), { door: 0 });
    await engine.idle();
    expect(store.alerts.get('1')?.state).toBe('resolved');
  });

  it('ignores replayed readings for rules, but still counts them as signs of life', async () => {
    const store = new FakeStore();
    const { sent, provider } = recorder();
    const engine = new RulesEngine(store, { whatsapp: provider, email: provider }, silent);
    await engine.load();
    vi.setSystemTime(Date.parse('2026-10-14T12:00:00Z'));
    for (let t = Date.parse('2026-10-14T09:00:00Z'); t < Date.parse('2026-10-14T09:10:00Z'); t += 2000) {
      await engine.onReading('nabd-07', new Date(t), { probe_c: 9 });
    }
    await engine.idle();
    expect(store.alerts.size).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
