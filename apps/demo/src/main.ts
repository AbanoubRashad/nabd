/**
 * Nabd's live demo in one process, for free hosting without Docker. The parts are the real ones: the
 * simulator's 12 devices speak MQTT to an in-process broker with per-device passwords and ACLs, ingest's
 * router and rules engine read every message, and the API serves REST and the WebSocket exactly as in the
 * full stack. Only storage differs: memory (store.ts) instead of TimescaleDB, rebuilt on boot by back-fill.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mqtt from 'mqtt';
import { pino } from 'pino';
import { SEED_DEVICES } from '@nabd/shared';
import { providersFromEnv } from '@nabd/notify';
import { buildServer } from '@nabd/api/server';
import { connectBridge } from '@nabd/api/live/bridge';
import { CommandService, type DeviceInfo } from '@nabd/api/live/commands';
import { Hub } from '@nabd/api/live/hub';
import { LatencyTracker } from '@nabd/api/live/latency';
import { route } from '@nabd/ingest/route';
import { RulesEngine } from '@nabd/ingest/rules/engine';
import { SimDevice } from '@nabd/simulator/device';
import { Fleet } from '@nabd/simulator/fleet';
import { TICK_MS, coldRoomDoorOffline } from '@nabd/simulator/models';
import { SeqStore } from '@nabd/simulator/seq-store';
import { backfill } from './backfill.js';
import { startBroker } from './broker.js';
import { DemoStore } from './store.js';

const log = pino({ name: 'demo', level: process.env.LOG_LEVEL ?? 'info' });
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
const realDevice = process.env.NABD_REAL_DEVICE || null;
const BACKFILL_MS = Number(process.env.DEMO_BACKFILL_HOURS ?? 24) * 3_600_000;

// Fresh random passwords on every boot: nothing outside this process ever connects to the broker.
const secret = () => randomBytes(18).toString('base64url');
const passwords = new Map<string, string>([
  ['svc-api', secret()],
  ['svc-ingest', secret()],
  ...SEED_DEVICES.map((d) => [d.id, secret()] as const),
]);
const broker = await startBroker(passwords);

const store = new DemoStore(realDevice);
// Notifications always go to the console in the demo, never to a real WhatsApp number or inbox.
let quiet = true;
const providers = providersFromEnv({}, (line) => {
  if (!quiet) log.info(line);
});

// ---- Back-fill the last day through the real rules engine, on simulated time ----
const started = Date.now();
const fleet = new Fleet(Math.random, new Date(started - BACKFILL_MS));
const seq = new SeqStore(join(mkdtempSync(join(tmpdir(), 'nabd-demo-')), 'seq.json'));
const clock = { now: started - BACKFILL_MS };
const pastEngine = new RulesEngine(store, providers, log, () => clock.now);
await pastEngine.load();
const written = await backfill({
  fleet,
  store,
  engine: pastEngine,
  clock,
  seq: (id) => seq.take(id),
  from: new Date(started - BACKFILL_MS),
  to: new Date(started),
  skip: (id) => id === realDevice,
});
log.info({ messages: written, ms: Date.now() - started }, 'back-filled the last day');

// ---- Ingest: the rules engine on live data, fed by the same router as the ingest service ----
const engine = new RulesEngine(store, providers, log);
await engine.load(); // picks up the rule states the back-fill left
quiet = false;
const reloadTimer = setInterval(() => {
  engine.load().catch((err: unknown) => log.warn({ err }, 'could not reload rules'));
}, 60_000);
const clockTimer = setInterval(() => void engine.tick(), 30_000);

const known = new Map<string, string>(SEED_DEVICES.map((d) => [d.id, d.siteSlug]));
const ingest = mqtt.connect(broker.url, {
  clientId: 'svc-ingest',
  username: 'svc-ingest',
  password: passwords.get('svc-ingest'),
  protocolVersion: 4,
});
ingest.on('message', (topic, payload) => {
  const r = route(topic, payload, known);
  if (r.kind === 'readings') {
    if (r.rows.length) {
      const m = Object.fromEntries(r.rows.map((row) => [row.metric, row.value]));
      store.addMessage(r.deviceId, r.rows[0]!.seq, r.ts, m);
      void engine.onReading(r.deviceId, r.ts, m);
    }
  } else if (r.kind === 'status') {
    store.updateStatus(r.update);
    if (r.update.online) engine.onSeen(r.update.deviceId, r.update.at);
  } else {
    log.debug({ topic, reason: r.letter.reason }, 'dead letter');
  }
});
await new Promise<void>((resolve) =>
  ingest.once('connect', () =>
    ingest.subscribe(['nabd/v1/+/+/telemetry', 'nabd/v1/+/+/status'], { qos: 1 }, () => resolve()),
  ),
);

// ---- API: hub, bridge and commands, wired as in apps/api/src/main.ts ----
const hub = new Hub(store);
const latency = new LatencyTracker();
let devices = new Map<string, DeviceInfo>();
async function refreshDevices() {
  const list = await store.listDevices();
  devices = new Map(list.map((d) => [d.id, { siteSlug: d.siteSlug, isSimulated: d.isSimulated }]));
}
await refreshDevices();
const registryTimer = setInterval(() => void refreshDevices(), 30_000);

store.onAnnounce = (change) => {
  const site = known.get(change.deviceId);
  if (site) hub.publish({ type: 'alert', deviceId: change.deviceId, siteSlug: site, alert: { ...change } });
};
store.onAlertAction = (alertId, action, by) => void engine.onAction(alertId, action, by);

const ref = {} as { commands: CommandService };
const { client: apiMqtt, publisher } = connectBridge(broker.url, passwords.get('svc-api')!, {
  hub,
  latency,
  commands: () => ref.commands,
  known: () => known,
  log,
});
const commands = (ref.commands = new CommandService(store, publisher, hub, () => devices));

// ---- The 12 devices, continuing the back-filled world from where it stopped ----
const simLog = log.child({ name: 'simulator' });
const sims = SEED_DEVICES.filter((d) => d.id !== realDevice).map(
  (device) =>
    new SimDevice({
      device,
      password: passwords.get(device.id)!,
      mqttUrl: broker.url,
      fleet,
      seq,
      log: simLog,
      timeoutRate: Number(process.env.SIM_COMMAND_TIMEOUT_RATE ?? 0.02),
    }),
);
for (const d of sims) if (!(d.id === 'nabd-11' && coldRoomDoorOffline(new Date()))) d.connect();
const tick = setInterval(() => {
  const now = new Date();
  fleet.tick(now);
  for (const d of sims) {
    // nabd-11 goes silent for 15 minutes every hour; the broker's Last Will marks it offline.
    if (d.id === 'nabd-11') {
      const offline = coldRoomDoorOffline(now);
      if (offline && d.connected) d.dropLink();
      else if (!offline && !d.connected) d.connect();
    }
    d.publishTelemetry(now);
  }
}, TICK_MS);
const heartbeat = setInterval(() => sims.forEach((d) => d.heartbeat()), 60_000);

const app = await buildServer({
  store,
  hub,
  latency,
  commands,
  publisher,
  providers,
  devices: () => devices,
  config: {
    // Sessions only matter for the owner's login, which the demo does not offer.
    jwtSecret: process.env.JWT_SECRET || secret(),
    secureCookies: production,
    webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3001,http://localhost:3000').split(','),
    whatsappAppSecret: null,
    whatsappVerifyToken: null,
    realDevice,
  },
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    for (const t of [tick, heartbeat, registryTimer, reloadTimer, clockTimer]) clearInterval(t);
    commands.close();
    hub.close();
    void (async () => {
      await app.close();
      await Promise.all(sims.map((d) => d.close()));
      await Promise.all([apiMqtt.endAsync(), ingest.endAsync()]);
      await broker.close();
      process.exit(0);
    })();
  });
}

await app.listen({ port, host: process.env.API_HOST ?? '0.0.0.0' });
log.info({ port, devices: sims.length, broker: broker.url }, 'demo ready');
