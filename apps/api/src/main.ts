import './sentry.js';
import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { createPool } from '@nabd/db';
import { readCredentials } from '@nabd/db/credentials';
import { providersFromEnv } from '@nabd/notify';
import { connectBridge } from './live/bridge.js';
import { CommandService, type DeviceInfo } from './live/commands.js';
import { Hub } from './live/hub.js';
import { LatencyTracker } from './live/latency.js';
import { PgStore } from './pg-store.js';
import { buildServer } from './server.js';

const log = pino({ name: 'api', level: process.env.LOG_LEVEL ?? 'info' });
const production = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET || (production ? '' : randomBytes(32).toString('hex'));
if (!jwtSecret) throw new Error('JWT_SECRET must be set in production');
if (!process.env.JWT_SECRET) log.warn('JWT_SECRET not set: using a random one, so sessions end on restart');

const pool = createPool();
const store = new PgStore(pool);
const hub = new Hub(store);
const latency = new LatencyTracker();

// Device registry, refreshed every 30 s: who may publish, under which site, and whether it is real.
let devices = new Map<string, DeviceInfo>();
async function refreshDevices() {
  const list = await store.listDevices();
  devices = new Map(list.map((d) => [d.id, { siteSlug: d.siteSlug, isSimulated: d.isSimulated }]));
}
await refreshDevices();
const registryTimer = setInterval(() => {
  refreshDevices().catch((err: unknown) => log.warn({ err }, 'device refresh failed'));
}, 30_000);

const credentials = readCredentials();
// The bridge and the command service need each other: the bridge routes acks, the service publishes.
const ref = {} as { commands: CommandService };
const { client: mqttClient, publisher } = connectBridge(
  process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  credentials.services['svc-api'],
  {
    hub,
    latency,
    commands: () => ref.commands,
    known: () => new Map([...devices].map(([id, d]) => [id, d.siteSlug])),
    log,
  },
);
const commands = (ref.commands = new CommandService(store, publisher, hub, () => devices));
const recovered = await commands.recover();
if (recovered) log.info({ recovered }, 'timed out commands left open by the previous run');

// Alerts are opened and resolved by ingest; it announces each change with NOTIFY, and we push it live.
const listener = await pool.connect();
await listener.query('LISTEN nabd_alerts');
listener.on('notification', (n) => {
  if (n.channel !== 'nabd_alerts' || !n.payload) return;
  try {
    const alert = JSON.parse(n.payload) as { deviceId: string } & Record<string, unknown>;
    const site = devices.get(alert.deviceId)?.siteSlug;
    if (site) hub.publish({ type: 'alert', deviceId: alert.deviceId, siteSlug: site, alert });
  } catch (err) {
    log.warn({ err }, 'bad alert notification');
  }
});

const app = await buildServer({
  store,
  hub,
  latency,
  commands,
  publisher,
  providers: providersFromEnv(process.env, (line) => log.info(line)),
  devices: () => devices,
  config: {
    jwtSecret,
    secureCookies: production,
    webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3001,http://localhost:3000').split(','),
    whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || null,
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || null,
    realDevice: process.env.NABD_REAL_DEVICE || null,
  },
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(registryTimer);
    commands.close();
    hub.close();
    void (async () => {
      await app.close();
      await mqttClient.endAsync();
      listener.release();
      await pool.end();
      process.exit(0);
    })();
  });
}

await app.listen({ port: Number(process.env.API_PORT ?? 4000), host: process.env.API_HOST ?? '0.0.0.0' });
