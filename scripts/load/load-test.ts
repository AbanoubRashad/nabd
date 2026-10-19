/**
 * Load test: N virtual devices publishing telemetry at 1 msg/s through EMQX, with a WebSocket client
 * measuring device → screen latency and the ingest /metrics sampled for throughput and insert latency.
 *
 *   pnpm load provision --devices 500     create load-test devices (DB rows + EMQX users)
 *   pnpm load run --devices 500 --minutes 10
 *   pnpm load cleanup                     remove them and their readings
 *
 * Results go to scripts/load/results/<timestamp>.json and a Markdown table is printed for
 * docs/PERFORMANCE.md. Only measured values are reported.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mqtt, { type MqttClient } from 'mqtt';
import pg from 'pg';
import WebSocket from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = 'load-test';
const FIRST_ID = 1001; // nabd-1001 … matches the EMQX ACL pattern ^nabd-[0-9]{2,4}$

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
};

const devices = Number(arg('devices', '500'));
const ids = Array.from({ length: devices }, (_, i) => `nabd-${FIRST_ID + i}`);
const password = (id: string) => `load-${id}-${env('LOAD_SECRET', 'local-load-test')}`;

/** EMQX management API: a token from the dashboard login, then the built-in user database. */
async function emqx(path: string, init: RequestInit = {}) {
  const base = env('EMQX_API', 'http://localhost:18083/api/v5');
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env('EMQX_DASHBOARD_PASSWORD') }),
  });
  const { token } = (await login.json()) as { token: string };
  return fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
}
const USERS = '/authentication/password_based:built_in_database/users';

async function provision() {
  const db = new pg.Pool({ connectionString: env('DATABASE_URL') });
  await db.query(
    `INSERT INTO sites (slug, name_en, name_ar, place_en, place_ar, kind, lat, lng)
     VALUES ($1, 'Load test', 'اختبار التحمل', 'Load test', 'اختبار التحمل', 'test', 30, 31) ON CONFLICT (slug) DO NOTHING`,
    [SITE],
  );
  await db.query(
    `INSERT INTO devices (id, site_id, name_en, name_ar, kind, is_simulated)
     SELECT id, (SELECT id FROM sites WHERE slug = $1), 'Load test node', 'عقدة اختبار', 'power', true
     FROM unnest($2::text[]) AS id ON CONFLICT (id) DO NOTHING`,
    [SITE, ids],
  );
  await db.end();
  let created = 0;
  for (const id of ids) {
    const res = await emqx(USERS, {
      method: 'POST',
      body: JSON.stringify({ user_id: id, password: password(id) }),
    });
    if (res.ok || res.status === 409) created++;
  }
  console.log(`provisioned ${ids.length} devices in site "${SITE}" (${created} broker users ready)`);
}

async function cleanup() {
  const db = new pg.Pool({ connectionString: env('DATABASE_URL') });
  await db.query(`DELETE FROM readings WHERE device_id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM devices WHERE id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM sites WHERE slug = $1`, [SITE]);
  await db.end();
  for (const id of ids) await emqx(`${USERS}/${id}`, { method: 'DELETE' });
  console.log(`removed ${ids.length} load-test devices`);
}

const pct = (values: number[], p: number) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!);
};

/** Reads one histogram's quantile-free summary (sum / count) and a counter from Prometheus text. */
async function scrape() {
  const text = await (await fetch(env('INGEST_METRICS', 'http://localhost:4100/metrics'))).text();
  const value = (name: string) =>
    text
      .split('\n')
      .filter((l) => l.startsWith(name))
      .reduce((n, l) => n + Number(l.split(' ').at(-1)), 0);
  return {
    messages: value('nabd_ingest_messages_total'),
    insertSum: value('nabd_ingest_insert_seconds_sum'),
    insertCount: value('nabd_ingest_insert_seconds_count'),
    dropped: value('nabd_ingest_dropped_rows_total'),
    dead: value('nabd_ingest_dead_letters_total'),
  };
}

function dockerStats(): string | null {
  try {
    return execFileSync(
      'docker',
      ['stats', '--no-stream', '--format', '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}'],
      {
        encoding: 'utf8',
      },
    );
  } catch {
    return null;
  }
}

async function run() {
  const minutes = Number(arg('minutes', '10'));
  const url = env('MQTT_URL', 'mqtt://localhost:1883');
  const clients: MqttClient[] = [];
  let published = 0;
  let failed = 0;

  // The screen side: one WebSocket client on the load-test site, as a dashboard would be.
  const latencies: number[] = [];
  const ws = new WebSocket(env('WS_URL', 'ws://localhost:4000/ws'));
  ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', sites: [SITE] })));
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as { type: string; ts?: string };
    if (msg.type === 'reading' && msg.ts) latencies.push(Date.now() - Date.parse(msg.ts));
  });

  // Connect at 50 devices per second, like a fleet coming back after an outage.
  for (const id of ids) {
    clients.push(
      mqtt.connect(url, {
        clientId: id,
        username: id,
        password: password(id),
        protocolVersion: 4,
        reconnectPeriod: 2000,
      }),
    );
    if (clients.length % 50 === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${clients.length} devices connecting; publishing for ${minutes} min`);

  const before = await scrape();
  const started = Date.now();
  const seq = new Map<string, number>();
  const stats: string[] = [];
  const statsTimer = setInterval(() => {
    const s = dockerStats();
    if (s) stats.push(s);
  }, 60_000);

  // Every device publishes once a second, spread evenly over the second.
  const tick = setInterval(() => {
    const now = Date.now();
    clients.forEach((c, i) => {
      setTimeout(
        () => {
          if (!c.connected) return;
          const id = ids[i]!;
          const n = (seq.get(id) ?? Math.floor(started / 1000)) + 1;
          seq.set(id, n);
          const payload = JSON.stringify({
            seq: n,
            ts: new Date().toISOString(),
            m: { bus_v: 51 + Math.random(), load_w: 900 + Math.random() * 400 },
          });
          c.publish(`nabd/v1/${SITE}/${id}/telemetry`, payload, { qos: 1 }, (err) =>
            err ? failed++ : published++,
          );
        },
        (i / clients.length) * 1000,
      );
    });
    if (now - started > minutes * 60_000) clearInterval(tick);
  }, 1000);

  await new Promise((r) => setTimeout(r, minutes * 60_000 + 15_000)); // let the last batches drain
  clearInterval(statsTimer);
  const after = await scrape();
  const seconds = (Date.now() - started) / 1000;
  clients.forEach((c) => c.end(true));
  ws.close();

  const result = {
    at: new Date().toISOString(),
    devices,
    minutes,
    published,
    failedPublishes: failed,
    publishRatePerSecond: Math.round((published / seconds) * 10) / 10,
    ingestMessagesPerSecond: Math.round(((after.messages - before.messages) / seconds) * 10) / 10,
    meanInsertMs:
      after.insertCount > before.insertCount
        ? Math.round(
            ((after.insertSum - before.insertSum) / (after.insertCount - before.insertCount)) * 10000,
          ) / 10
        : null,
    droppedRows: after.dropped - before.dropped,
    deadLetters: after.dead - before.dead,
    deviceToScreenMs: {
      samples: latencies.length,
      p50: pct(latencies, 0.5),
      p95: pct(latencies, 0.95),
      p99: pct(latencies, 0.99),
    },
    dockerStats: stats,
  };
  const dir = resolve(HERE, 'results');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${result.at.replaceAll(':', '-')}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nresults: ${file}\n`);
  console.log(
    `| Devices | Duration | Published/s | Ingested/s | Mean insert | Device → screen p95 | Dropped |`,
  );
  console.log(`| --- | --- | --- | --- | --- | --- | --- |`);
  console.log(
    `| ${devices} | ${minutes} min | ${result.publishRatePerSecond} | ${result.ingestMessagesPerSecond} | ${result.meanInsertMs ?? '—'} ms | ${result.deviceToScreenMs.p95 ?? '—'} ms | ${result.droppedRows} |`,
  );
  process.exit(0);
}

const command = process.argv[2];
if (command === 'provision') await provision();
else if (command === 'cleanup') await cleanup();
else if (command === 'run') await run();
else {
  console.log('usage: pnpm load provision|run|cleanup [--devices 500] [--minutes 10]');
  console.log('Test passwords derive from LOAD_SECRET (default "local-load-test").');
}
