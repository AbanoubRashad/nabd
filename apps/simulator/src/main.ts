import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pino } from 'pino';
import { SEED_DEVICES } from '@nabd/shared';
import { readCredentials } from '@nabd/db/credentials';
import { SimDevice } from './device.js';
import { Fleet } from './fleet.js';
import { TICK_MS, coldRoomDoorOffline } from './models.js';
import { SeqStore } from './seq-store.js';

const log = pino({ name: 'simulator', level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.SIMULATOR_PORT ?? 4200);
const mqttUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const realDevice = process.env.NABD_REAL_DEVICE || null;
const timeoutRate = Number(process.env.SIM_COMMAND_TIMEOUT_RATE ?? 0.02);

const credentials = readCredentials();
const fleet = new Fleet();
const seq = new SeqStore(resolve(process.env.SIM_STATE_DIR ?? '.sim-state', 'seq.json'));

// The real board publishes for itself in production; never impersonate it.
const devices = SEED_DEVICES.filter((d) => d.id !== realDevice).map((device) => {
  const password = credentials.devices[device.id];
  if (!password) throw new Error(`no MQTT credentials for ${device.id}; run \`pnpm credentials\``);
  return new SimDevice({ device, password, mqttUrl, fleet, seq, log, timeoutRate });
});

for (const d of devices) if (!(d.id === 'nabd-11' && coldRoomDoorOffline(new Date()))) d.connect();

const tick = setInterval(() => {
  const now = new Date();
  fleet.tick(now);
  for (const d of devices) {
    // nabd-11 goes silent for 15 minutes every hour; the broker's Last Will marks it offline.
    if (d.id === 'nabd-11') {
      const offline = coldRoomDoorOffline(now);
      if (offline && d.connected) {
        log.info('nabd-11 going offline for the scheduled 15 minutes');
        d.dropLink();
      } else if (!offline && !d.connected) {
        d.connect();
      }
    }
    d.publishTelemetry(now);
  }
}, TICK_MS);

const heartbeat = setInterval(() => devices.forEach((d) => d.heartbeat()), 60_000);

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    const connected = devices.filter((d) => d.connected).length;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'simulator',
        devices: devices.length,
        connected,
        published: devices.reduce((n, d) => n + d.stats.published, 0),
      }),
    );
    return;
  }
  res.writeHead(404).end();
});
server.listen(port, () => log.info({ port, mqttUrl, devices: devices.length }, 'simulator ready'));

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(tick);
    clearInterval(heartbeat);
    void Promise.all(devices.map((d) => d.close())).finally(() => server.close(() => process.exit(0)));
  });
}
