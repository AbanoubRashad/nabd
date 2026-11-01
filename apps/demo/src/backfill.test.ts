import { expect, test } from 'vitest';
import { providersFromEnv } from '@nabd/notify';
import { RulesEngine } from '@nabd/ingest/rules/engine';
import { Fleet } from '@nabd/simulator/fleet';
import { backfill } from './backfill.js';
import { DemoStore } from './store.js';

const silent = { info: () => {}, error: () => {} };
const providers = providersFromEnv({}, () => {});

test('one simulated hour fills the charts and opens alerts through the real rules engine', async () => {
  // 11:30 to 12:30 UTC, so nabd-11's silent quarter (12:00 to 12:15) comes after it has been seen.
  const to = Date.parse('2026-11-01T12:30:00Z');
  const from = to - 60 * 60_000;
  const store = new DemoStore(null, () => to);
  const clock = { now: from };
  const engine = new RulesEngine(store, providers, silent, () => clock.now);
  await engine.load();
  let seq = 0;

  const written = await backfill({
    fleet: new Fleet(() => 0.5, new Date(from)),
    store,
    engine,
    clock,
    seq: () => seq++,
    from: new Date(from),
    to: new Date(to),
  });

  // 1,800 ticks of 2 s; every device publishes on each, except nabd-11 during its silent quarter hour.
  expect(written).toBeGreaterThan(1800 * 11);
  expect(written).toBeLessThan(1800 * 12);
  const minutes = await store.series('nabd-07', 'probe_c', new Date(from), new Date(to), '1m');
  expect(minutes.points).toHaveLength(60);

  // The fridge door is left ajar every 20 minutes, and nabd-11 goes silent once an hour.
  const alerts = await store.listAlerts({ limit: 50 });
  const names = new Set(alerts.map((a) => a.ruleName));
  expect(alerts.filter((a) => a.deviceId === 'nabd-07').length).toBeGreaterThanOrEqual(2);
  expect(names.has('Device stopped reporting')).toBe(true);
  for (const a of alerts) {
    expect(Date.parse(a.openedAt)).toBeGreaterThanOrEqual(from);
    expect(Date.parse(a.openedAt)).toBeLessThanOrEqual(to);
  }
});
