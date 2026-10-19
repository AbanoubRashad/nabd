import pg from 'pg';

export type { Pool, PoolClient } from 'pg';

/** Creates the connection pool. Every query in Nabd is parameterised; never interpolate values into SQL. */
export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString, max: 10, application_name: process.env.SERVICE_NAME ?? 'nabd' });
}

type Queryable = Pick<pg.Pool, 'query'>;

export interface ReadingRow {
  deviceId: string;
  ts: string;
  seq: number;
  metric: string;
  value: number;
}

/**
 * Inserts a batch of readings in one round trip using `unnest` arrays. Rows that collide with the idempotency
 * key (a replayed `seq`) are skipped. Returns the number of rows actually inserted.
 */
export async function insertReadings(db: Queryable, rows: readonly ReadingRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await db.query(
    `INSERT INTO readings (device_id, ts, seq, metric, value)
     SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::bigint[], $4::text[], $5::float8[])
     ON CONFLICT DO NOTHING`,
    [
      rows.map((r) => r.deviceId),
      rows.map((r) => r.ts),
      rows.map((r) => r.seq),
      rows.map((r) => r.metric),
      rows.map((r) => r.value),
    ],
  );
  return result.rowCount ?? 0;
}

/** Moves `last_seen_at` forward for each device (never backwards, so a replay cannot make a device look stale). */
export async function touchDevices(db: Queryable, seen: ReadonlyMap<string, Date>): Promise<void> {
  if (seen.size === 0) return;
  await db.query(
    `UPDATE devices d SET last_seen_at = GREATEST(d.last_seen_at, s.seen_at)
     FROM unnest($1::text[], $2::timestamptz[]) AS s(id, seen_at)
     WHERE d.id = s.id`,
    [[...seen.keys()], [...seen.values()]],
  );
}

export interface DeadLetter {
  topic: string;
  deviceId: string | null;
  reason: string;
  payload: string;
}

export async function insertDeadLetters(db: Queryable, rows: readonly DeadLetter[]): Promise<void> {
  if (rows.length === 0) return;
  await db.query(
    `INSERT INTO dead_letters (topic, device_id, reason, payload)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])`,
    [
      rows.map((r) => r.topic),
      rows.map((r) => r.deviceId),
      rows.map((r) => r.reason),
      rows.map((r) => r.payload),
    ],
  );
}

export interface DeviceStatusUpdate {
  deviceId: string;
  online: boolean;
  fw?: string | undefined;
  rssi?: number | undefined;
  uptimeS?: number | undefined;
  bootReason?: string | undefined;
  at: Date;
}

/** Applies a retained status message or a Last Will. Fields the message leaves out keep their old value. */
export async function updateDeviceStatus(db: Queryable, s: DeviceStatusUpdate): Promise<void> {
  await db.query(
    `UPDATE devices SET
       online = $2,
       fw_version = COALESCE($3, fw_version),
       rssi = CASE WHEN $2 THEN COALESCE($4, rssi) ELSE NULL END,
       uptime_s = COALESCE($5, uptime_s),
       boot_reason = COALESCE($6, boot_reason),
       last_seen_at = CASE WHEN $2 THEN GREATEST(last_seen_at, $7) ELSE last_seen_at END
     WHERE id = $1`,
    [s.deviceId, s.online, s.fw ?? null, s.rssi ?? null, s.uptimeS ?? null, s.bootReason ?? null, s.at],
  );
}

export interface KnownDevice {
  id: string;
  siteSlug: string;
}

/** The devices ingest accepts readings from, with the site each one is registered under. */
export async function listKnownDevices(db: Queryable): Promise<KnownDevice[]> {
  const result = await db.query<{ id: string; site_slug: string }>(
    `SELECT d.id, s.slug AS site_slug FROM devices d JOIN sites s ON s.id = d.site_id`,
  );
  return result.rows.map((r) => ({ id: r.id, siteSlug: r.site_slug }));
}
