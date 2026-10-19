// Protocol test against an in-process broker (aedes): the device must behave like the firmware on the wire.
// The EMQX-specific parts (auth, ACL, shared subscriptions) are covered by the Testcontainers suite.
import { createServer, type Server } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_DEVICES, parseAck, parseStatus, parseTelemetry, type Ack } from '@nabd/shared';
import { SimDevice } from './device.js';
import { Fleet } from './fleet.js';
import { SeqStore } from './seq-store.js';

let broker: Aedes;
let server: Server;
let url: string;
let observer: MqttClient;
const received: { topic: string; payload: string; retain: boolean }[] = [];

beforeAll(async () => {
  broker = await Aedes.createBroker();
  server = createServer(broker.handle);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  url = `mqtt://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  observer = await mqtt.connectAsync(url, { clientId: 'observer' });
  await observer.subscribeAsync('nabd/v1/#', { qos: 1 });
  observer.on('message', (topic, payload, packet) =>
    received.push({ topic, payload: payload.toString(), retain: packet.retain }),
  );
});

afterAll(async () => {
  await observer.endAsync();
  await new Promise<void>((done) => broker.close(() => done()));
  server.close();
});

const waitFor = async <T>(find: () => T | undefined, ms = 3000): Promise<T> => {
  const until = Date.now() + ms;
  for (;;) {
    const hit = find();
    if (hit !== undefined) return hit;
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

function makeDevice(id: string) {
  const device = SEED_DEVICES.find((d) => d.id === id)!;
  const fleet = new Fleet(() => 0.5);
  const seq = new SeqStore(join(mkdtempSync(join(tmpdir(), 'nabd-sim-')), 'seq.json'));
  const sim = new SimDevice({
    device,
    password: 'x',
    mqttUrl: url,
    fleet,
    seq,
    log: pino({ level: 'silent' }),
  });
  return { sim, fleet, device };
}

describe('SimDevice on the wire', () => {
  it('announces itself, publishes valid telemetry and confirms a relay command in two steps', async () => {
    const { sim, fleet } = makeDevice('nabd-01');
    sim.connect();

    const status = await waitFor(() =>
      received.find((m) => m.topic === 'nabd/v1/wadi-natrun/nabd-01/status' && m.payload.includes('true')),
    );
    expect(parseStatus(status.payload)).toMatchObject({ ok: true, value: { online: true, fw: '1.4.2' } });

    // Retained: a client that subscribes later still gets the device's current status straight away.
    const late = await mqtt.connectAsync(url, { clientId: 'late-subscriber' });
    const retained = new Promise<boolean>((done) =>
      late.on('message', (_t, _p, packet) => done(packet.retain)),
    );
    await late.subscribeAsync('nabd/v1/wadi-natrun/nabd-01/status', { qos: 1 });
    expect(await retained).toBe(true);
    await late.endAsync();

    await waitFor(() => (sim.connected ? true : undefined));
    for (let i = 0; i < 3; i++) {
      fleet.tick(new Date());
      sim.publishTelemetry(new Date());
    }
    const telemetry = await waitFor(() => {
      const t = received.filter((m) => m.topic.endsWith('nabd-01/telemetry'));
      return t.length === 3 ? t : undefined;
    });
    const parsed = telemetry.map((m) => parseTelemetry(m.payload));
    expect(parsed.every((p) => p.ok)).toBe(true);
    expect(parsed.map((p) => (p.ok ? p.value.seq : -1))).toEqual([0, 1, 2]);

    const sentAt = Date.now();
    const exp = new Date(sentAt + 10_000).toISOString();
    await observer.publishAsync(
      'nabd/v1/wadi-natrun/nabd-01/cmd',
      JSON.stringify({ id: 'c-1', op: 'relay.set', args: { ch: 1, on: true }, exp }),
      { qos: 1 },
    );
    const acks = await waitFor(() => {
      const a = received
        .filter((m) => m.topic.endsWith('nabd-01/cmd/ack'))
        .map((m) => parseAck(m.payload))
        .flatMap((p): Ack[] => (p.ok ? [p.value] : []));
      return a.length === 2 ? a : undefined;
    });
    expect(acks.map((a) => a.state)).toEqual(['delivered', 'done']);
    expect(acks[1]?.relay).toEqual({ ch: 1, on: true });
    expect(Date.now() - sentAt).toBeGreaterThanOrEqual(800);
    expect(fleet.relay('nabd-01', 1)).toBe(true);

    await sim.close();
  });

  it('rejects expired commands and relays it does not have', async () => {
    const { sim } = makeDevice('nabd-07');
    sim.connect();
    await waitFor(() => (sim.connected ? true : undefined));
    await new Promise((r) => setTimeout(r, 100)); // let the subscription settle

    const cmd = (id: string, exp: string) =>
      observer.publishAsync(
        'nabd/v1/heliopolis/nabd-07/cmd',
        JSON.stringify({ id, op: 'relay.set', args: { ch: 1, on: true }, exp }),
        { qos: 1 },
      );
    await cmd('c-expired', new Date(Date.now() - 1000).toISOString());
    await cmd('c-norelay', new Date(Date.now() + 10_000).toISOString());

    const reasons = await waitFor(() => {
      const r = received
        .filter((m) => m.topic.endsWith('nabd-07/cmd/ack'))
        .map((m) => JSON.parse(m.payload) as Ack);
      return r.length === 2 ? r : undefined;
    });
    expect(reasons).toEqual([
      { id: 'c-expired', state: 'rejected', reason: 'expired' },
      { id: 'c-norelay', state: 'rejected', reason: 'no_such_relay' },
    ]);
    await sim.close();
  });

  it('lets the broker publish its Last Will when the link drops', async () => {
    const { sim } = makeDevice('nabd-11');
    sim.connect();
    await waitFor(() => (sim.connected ? true : undefined));
    const before = received.length;
    sim.dropLink();
    const will = await waitFor(() =>
      received.slice(before).find((m) => m.topic === 'nabd/v1/tenth-of-ramadan/nabd-11/status'),
    );
    expect(JSON.parse(will.payload)).toEqual({ online: false });
  });
});
