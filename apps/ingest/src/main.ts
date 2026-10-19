import { createServer } from 'node:http';
import mqtt from 'mqtt';
import { pino } from 'pino';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import {
  createPool,
  insertDeadLetters,
  insertReadings,
  listKnownDevices,
  touchDevices,
  updateDeviceStatus,
} from '@nabd/db';
import { readCredentials } from '@nabd/db/credentials';
import { Batcher } from './batcher.js';
import { route } from './route.js';
import { providersFromEnv } from '@nabd/notify';
import { RulesEngine } from './rules/engine.js';
import { PgRulesStore } from './rules/pg-store.js';

const log = pino({ name: 'ingest', level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.INGEST_PORT ?? 4100);
const mqttUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883';

// ---- metrics (Prometheus) -------------------------------------------------------------------------------

const registry = new Registry();
collectDefaultMetrics({ register: registry });
const messages = new Counter({
  name: 'nabd_ingest_messages_total',
  help: 'MQTT messages received, by kind',
  labelNames: ['kind'] as const,
  registers: [registry],
});
const deadLetters = new Counter({
  name: 'nabd_ingest_dead_letters_total',
  help: 'Messages rejected by validation, by reason',
  labelNames: ['reason'] as const,
  registers: [registry],
});
const batchSize = new Histogram({
  name: 'nabd_ingest_batch_rows',
  help: 'Readings per database write',
  buckets: [1, 10, 50, 100, 250, 500],
  registers: [registry],
});
const insertLatency = new Histogram({
  name: 'nabd_ingest_insert_seconds',
  help: 'Duration of one batch write',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});
const writeErrors = new Counter({
  name: 'nabd_ingest_write_errors_total',
  help: 'Failed batch writes',
  registers: [registry],
});
const droppedRows = new Counter({
  name: 'nabd_ingest_dropped_rows_total',
  help: 'Readings dropped because the in-memory buffer was full while the database was down',
  registers: [registry],
});
const pending = new Gauge({
  name: 'nabd_ingest_pending_rows',
  help: 'Rows waiting to be written',
  registers: [registry],
});
const deviceLag = new Histogram({
  name: 'nabd_ingest_receive_lag_seconds',
  help: 'received_at minus the device timestamp, for live (non-replayed) readings',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

// ---- database -------------------------------------------------------------------------------------------

const pool = createPool();
let known = new Map<string, string>();

async function refreshKnownDevices(): Promise<void> {
  const devices = await listKnownDevices(pool);
  known = new Map(devices.map((d) => [d.id, d.siteSlug]));
}

const batcher = new Batcher({
  // One transaction per batch, so readings and last-seen move together.
  write: async ({ readings, deadLetters: letters, seen }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertReadings(client, readings);
      await insertDeadLetters(client, letters);
      await touchDevices(client, seen);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
  onFlush: ({ rows, ms }) => {
    batchSize.observe(rows);
    insertLatency.observe(ms / 1000);
  },
  onError: (err, retryInMs) => {
    writeErrors.inc();
    log.error({ err, retryInMs }, 'batch write failed; rows kept for retry');
  },
  onDrop: (n) => {
    droppedRows.inc(n);
    log.error({ dropped: n }, 'buffer full, oldest readings dropped');
  },
});

// ---- MQTT -----------------------------------------------------------------------------------------------

await refreshKnownDevices();

// ---- rules engine (Phase 4) -------------------------------------------------------------------------------

const engine = new RulesEngine(
  new PgRulesStore(pool),
  providersFromEnv(process.env, (line) => log.info(line)),
  log,
);
await engine.load();
// Rule edits from the dashboard are picked up within a minute; the clock drives silence and escalation.
const reloadTimer = setInterval(() => {
  engine.load().catch((err: unknown) => log.warn({ err }, 'could not reload rules'));
}, 60_000);
const clockTimer = setInterval(() => void engine.tick(), 30_000);

// Acknowledge / mute requests from the API (dashboard button or WhatsApp reply) arrive by NOTIFY.
const listener = await pool.connect();
await listener.query('LISTEN nabd_alert_actions');
listener.on('notification', (n) => {
  if (n.channel !== 'nabd_alert_actions' || !n.payload) return;
  try {
    const a = JSON.parse(n.payload) as { alertId: string; action: 'ack' | 'mute'; by: string; at: string };
    void engine.onAction(a.alertId, a.action, a.by, new Date(a.at));
  } catch (err) {
    log.warn({ err }, 'bad alert action');
  }
});
const knownTimer = setInterval(() => {
  refreshKnownDevices().catch((err: unknown) => log.warn({ err }, 'could not refresh device list'));
}, 30_000);

const credentials = readCredentials();
const client = mqtt.connect(mqttUrl, {
  clientId: `svc-ingest-${process.pid}`,
  username: 'svc-ingest',
  password: credentials.services['svc-ingest'],
  protocolVersion: 4,
  keepalive: 30,
  reconnectPeriod: 2000,
});

// A shared subscription spreads messages across every ingest instance, so ingest scales out horizontally.
const SUBSCRIPTIONS = ['$share/ingest/nabd/v1/+/+/telemetry', '$share/ingest/nabd/v1/+/+/status'];

client.on('connect', () => {
  log.info({ mqttUrl }, 'connected to broker');
  client.subscribe(SUBSCRIPTIONS, { qos: 1 }, (err) => {
    if (err) log.error({ err }, 'subscribe failed');
  });
});
client.on('error', (err) => log.warn({ err: err.message }, 'mqtt error'));

client.on('message', (topic, payload) => {
  const now = new Date();
  const r = route(topic, payload, known, now);
  messages.inc({ kind: r.kind });
  switch (r.kind) {
    case 'readings': {
      const lag = (now.getTime() - r.ts.getTime()) / 1000;
      if (lag >= 0 && lag < 60) deviceLag.observe(lag); // older ones are replays from the offline buffer
      batcher.addReadings(r.deviceId, r.rows, r.ts);
      // Rules never block ingest: the engine queues its own work.
      void engine.onReading(
        r.deviceId,
        r.ts,
        Object.fromEntries(r.rows.map((row) => [row.metric, row.value])),
      );
      break;
    }
    case 'status':
      if (r.update.online) engine.onSeen(r.update.deviceId, r.update.at);
      updateDeviceStatus(pool, r.update).catch((err: unknown) => log.error({ err }, 'status update failed'));
      break;
    case 'dead':
      deadLetters.inc({ reason: r.letter.reason.split(':')[0] ?? r.letter.reason });
      log.debug({ topic, reason: r.letter.reason }, 'dead letter');
      batcher.addDeadLetter(r.letter);
      break;
  }
  pending.set(batcher.pending);
});

// ---- HTTP: health and metrics ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    const ok = client.connected;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, service: 'ingest', mqtt: client.connected, pending: batcher.pending }));
    return;
  }
  if (req.url === '/metrics') {
    pending.set(batcher.pending);
    registry
      .metrics()
      .then((body) => res.writeHead(200, { 'content-type': registry.contentType }).end(body))
      .catch(() => res.writeHead(500).end());
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, () => log.info({ port }, 'ingest ready'));

// ---- graceful shutdown: stop taking messages, drain the buffer, then close ------------------------------

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info({ signal, pending: batcher.pending }, 'draining');
    clearInterval(knownTimer);
    clearInterval(reloadTimer);
    clearInterval(clockTimer);
    void (async () => {
      await client.endAsync();
      const left = await batcher.drain();
      await engine.idle();
      listener.release();
      if (left > 0) log.error({ left }, 'shutdown with rows still unwritten');
      await pool.end();
      server.close(() => process.exit(left > 0 ? 1 : 0));
    })();
  });
}
