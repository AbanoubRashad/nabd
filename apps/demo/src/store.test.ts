import { describe, expect, test } from 'vitest';
import { DemoStore, cairoMidnight } from './store.js';

const T0 = Date.parse('2026-11-01T10:00:00Z');
const at = (ms: number) => new Date(T0 + ms);

function storeAt(now = T0 + 60 * 60_000) {
  return new DemoStore(null, () => now);
}

describe('readings', () => {
  test('raw, one-minute and hourly series agree on the same data', async () => {
    const store = storeAt();
    for (let i = 0; i < 90; i++) store.addMessage('nabd-07', i, at(i * 20_000), { probe_c: i % 2 ? 4 : 6 });
    const from = at(0);
    const to = at(30 * 60_000);

    const raw = await store.series('nabd-07', 'probe_c', from, to, 'raw');
    expect(raw.points).toHaveLength(90);

    const minutes = await store.series('nabd-07', 'probe_c', from, to, '1m');
    expect(minutes.points).toHaveLength(30);
    expect(minutes.points[0]).toMatchObject({ min: 4, max: 6, avg: 16 / 3 }); // 6, 4, 6

    const hours = await store.series('nabd-07', 'probe_c', from, to, '1h');
    expect(hours.points).toEqual([{ t: at(0).toISOString(), avg: 5, min: 4, max: 6 }]);
  });

  test('raw readings older than an hour are dropped, roll-ups are kept', async () => {
    const now = T0 + 3 * 60 * 60_000;
    const store = storeAt(now);
    store.addMessage('nabd-07', 1, at(0), { probe_c: 5 });
    store.addMessage('nabd-07', 2, new Date(now - 1000), { probe_c: 5 });
    const raw = await store.messagesSince('nabd-07', 0, at(0), 100);
    expect(raw.map((m) => m.seq)).toEqual([2]);
    const minutes = await store.series('nabd-07', 'probe_c', at(0), new Date(now), '1m');
    expect(minutes.points).toHaveLength(2);
  });

  test('null values are not stored, and latest keeps the newest value', async () => {
    const store = storeAt();
    store.addMessage('nabd-04', 1, at(1000), { air_c: 21, rh: null });
    store.addMessage('nabd-04', 2, at(0), { air_c: 19 }); // a late replay must not overwrite
    const d = await store.getDevice('nabd-04');
    expect(d?.latest).toEqual({ air_c: { value: 21, ts: at(1000).toISOString() } });
  });

  test('readingsToday counts from midnight in Cairo', async () => {
    const now = Date.parse('2026-11-01T23:30:00Z'); // 01:30 on 2 Nov in Cairo (UTC+2)
    const store = storeAt(now);
    store.addMessage('nabd-04', 1, new Date('2026-11-01T21:30:00Z'), { air_c: 20, rh: 50 }); // 23:30 Cairo, yesterday
    store.addMessage('nabd-04', 2, new Date('2026-11-01T22:30:00Z'), { air_c: 20, rh: 50 }); // 00:30 Cairo, today
    expect(await store.readingsToday()).toBe(2);
    expect(new Date(cairoMidnight(now)).toISOString()).toBe('2026-11-01T22:00:00.000Z');
  });
});

describe('alerts and status', () => {
  test('an open alert sets the device, site and rule status until it resolves', async () => {
    const store = storeAt();
    store.updateStatus({ deviceId: 'nabd-07', online: true, at: at(0) });
    const id = await store.openAlert(1, 'nabd-07', at(0), 8.4);
    await store.addEvent(id, at(0), 'opened', {});

    const rule = (await store.listRules()).find((r) => r.id === 1)!;
    expect(rule.state).toBe('firing');
    const device = await store.getDevice('nabd-07');
    expect(device?.status).toBe(rule.severity);
    const site = (await store.listSites()).find((s) => s.slug === device?.siteSlug);
    expect(site?.status).toBe(rule.severity);
    expect((await store.recentEvents(5))[0]).toMatchObject({ kind: 'alert', detail: 'opened' });

    await store.updateAlert(id, { state: 'resolved', resolvedAt: at(60_000) });
    expect((await store.getDevice('nabd-07'))?.status).toBe('ok');
    expect((await store.getAlert(id))?.events).toHaveLength(1);
  });

  test('a device without a status message is offline', async () => {
    expect((await storeAt().getDevice('nabd-01'))?.status).toBe('offline');
  });

  test('every device is labelled simulated unless it is the configured real board', async () => {
    expect((await new DemoStore(null).listDevices()).every((d) => d.isSimulated)).toBe(true);
    const real = (await new DemoStore('nabd-01').listDevices()).filter((d) => !d.isSimulated);
    expect(real.map((d) => d.id)).toEqual(['nabd-01']);
  });

  test('a rule with alerts is disabled instead of deleted', async () => {
    const store = storeAt();
    await store.openAlert(2, 'nabd-11', at(0), null);
    expect(await store.deleteRule(2)).toBe(true);
    expect((await store.getRule(2))?.enabled).toBe(false);
    expect(await store.deleteRule(3)).toBe(true);
    expect(await store.getRule(3)).toBeNull();
  });

  test('acknowledge and mute go to the rules engine', async () => {
    const store = storeAt();
    const calls: string[] = [];
    store.onAlertAction = (id, action, by) => calls.push(`${id}:${action}:${by}`);
    await store.requestAlertAction('7', 'ack', 'dashboard');
    expect(calls).toEqual(['7:ack:dashboard']);
  });
});
