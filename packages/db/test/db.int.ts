// Integration test against a real TimescaleDB (Testcontainers). Run with `pnpm test:int` (needs Docker).
// Checks the schema migration applies in one transaction, idempotent inserts, dead letters, and that the
// continuous aggregates refresh with exact averages.
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertDeadLetters,
  insertReadings,
  listKnownDevices,
  touchDevices,
  updateDeviceStatus,
} from '../src/index.js';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('timescale/timescaledb:2.30.2-pg16').start();
  const databaseUrl = container.getConnectionUri();
  await runner({
    databaseUrl,
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
  pool = new pg.Pool({ connectionString: databaseUrl });
  await pool.query(
    `INSERT INTO sites (slug, name_en, name_ar, place_en, place_ar, kind, lat, lng)
     VALUES ('wadi-natrun', 'Off-grid villa', 'فيلا', 'Wadi El Natrun', 'وادي النطرون', 'energy', 30.4, 30.3)`,
  );
  await pool.query(
    `INSERT INTO devices (id, site_id, name_en, name_ar, kind) VALUES ('nabd-01', 1, 'Rooftop power node', 'عقدة الطاقة', 'power')`,
  );
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

const at = (s: number) => new Date(Date.UTC(2026, 9, 14, 10, 0, s)).toISOString();

describe('TimescaleDB schema', () => {
  it('creates the hypertable with compression, retention and three continuous aggregates', async () => {
    const hyper = await pool.query(`SELECT hypertable_name FROM timescaledb_information.hypertables`);
    expect(hyper.rows.map((r: { hypertable_name: string }) => r.hypertable_name)).toContain('readings');
    const caggs = await pool.query(
      `SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name`,
    );
    expect(caggs.rows.map((r: { view_name: string }) => r.view_name)).toEqual([
      'readings_1d',
      'readings_1h',
      'readings_1m',
    ]);
    const jobs = await pool.query(`SELECT proc_name FROM timescaledb_information.jobs`);
    const procs = jobs.rows.map((r: { proc_name: string }) => r.proc_name);
    expect(procs).toEqual(
      expect.arrayContaining(['policy_retention', 'policy_refresh_continuous_aggregate']),
    );
    expect(procs.some((p) => p.includes('compression') || p.includes('columnstore'))).toBe(true);
  });

  it('stores a replayed seq only once', async () => {
    const rows = [
      { deviceId: 'nabd-01', ts: at(0), seq: 1, metric: 'pv_w', value: 3000 },
      { deviceId: 'nabd-01', ts: at(0), seq: 1, metric: 'soc', value: 80 },
    ];
    expect(await insertReadings(pool, rows)).toBe(2);
    expect(await insertReadings(pool, rows)).toBe(0);
    const count = await pool.query(`SELECT count(*)::int AS n FROM readings WHERE seq = 1`);
    expect(count.rows[0].n).toBe(2);
  });

  it('records dead letters', async () => {
    await insertDeadLetters(pool, [
      {
        topic: 'nabd/v1/wadi-natrun/nabd-01/telemetry',
        deviceId: 'nabd-01',
        reason: 'invalid_json',
        payload: '{',
      },
    ]);
    const r = await pool.query(`SELECT reason FROM dead_letters`);
    expect(r.rows).toEqual([{ reason: 'invalid_json' }]);
  });

  it('refreshes the aggregates with exact min, max and average', async () => {
    await insertReadings(
      pool,
      [10, 20, 60].map((value, i) => ({
        deviceId: 'nabd-01',
        ts: at(10 + i * 2),
        seq: 100 + i,
        metric: 'load_w',
        value,
      })),
    );
    await pool.query(`CALL refresh_continuous_aggregate('readings_1m', NULL, NULL)`);
    await pool.query(`CALL refresh_continuous_aggregate('readings_1h', NULL, NULL)`);
    const r = await pool.query(
      `SELECT min, max, sum / count AS avg, count::int FROM readings_1h WHERE metric = 'load_w'`,
    );
    expect(r.rows).toEqual([{ min: 10, max: 60, avg: 30, count: 3 }]);
  });

  it('applies status and never moves last_seen_at backwards', async () => {
    await updateDeviceStatus(pool, {
      deviceId: 'nabd-01',
      online: true,
      fw: '1.4.2',
      rssi: -61,
      at: new Date(at(30)),
    });
    await touchDevices(pool, new Map([['nabd-01', new Date(at(5))]]));
    const r = await pool.query(
      `SELECT online, fw_version, rssi, last_seen_at FROM devices WHERE id = 'nabd-01'`,
    );
    expect(r.rows[0]).toMatchObject({ online: true, fw_version: '1.4.2', rssi: -61 });
    expect((r.rows[0].last_seen_at as Date).toISOString()).toBe(at(30));
    expect(await listKnownDevices(pool)).toEqual([{ id: 'nabd-01', siteSlug: 'wadi-natrun' }]);
  });
});
