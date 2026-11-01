// The demo broker must keep the full stack's security rules: own password, own topic subtree.
import { afterAll, beforeAll, expect, test } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import { ownsTopic, startBroker, type DemoBroker } from './broker.js';

let broker: DemoBroker;
const passwords = new Map([
  ['nabd-05', 'pw-05'],
  ['nabd-06', 'pw-06'],
  ['svc-api', 'pw-api'],
]);
const clients: MqttClient[] = [];

function connect(clientId: string, username: string, password: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(broker.url, {
      clientId,
      username,
      password,
      reconnectPeriod: 0,
      protocolVersion: 4,
    });
    clients.push(c);
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });
}

beforeAll(async () => {
  broker = await startBroker(passwords);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.endAsync()));
  await broker.close();
});

test('ownsTopic matches only the device subtree', () => {
  expect(ownsTopic('nabd-05', 'nabd/v1/fayoum/nabd-05/telemetry')).toBe(true);
  expect(ownsTopic('nabd-05', 'nabd/v1/fayoum/nabd-06/cmd')).toBe(false);
  expect(ownsTopic('nabd-05', 'nabd/v1/+/+/telemetry')).toBe(false);
  expect(ownsTopic('nabd-05', 'other/v1/fayoum/nabd-05/x')).toBe(false);
});

test('a wrong password is refused', async () => {
  await expect(connect('nabd-05', 'nabd-05', 'nope')).rejects.toThrow();
});

test("a device cannot connect under another device's id", async () => {
  await expect(connect('nabd-06', 'nabd-05', 'pw-05')).rejects.toThrow();
});

test('a device reaches only its own subtree; services see everything', async () => {
  const api = await connect('svc-api', 'svc-api', 'pw-api');
  const received: string[] = [];
  api.on('message', (t) => received.push(t));
  await api.subscribeAsync('nabd/v1/+/+/telemetry', { qos: 1 });

  const dev = await connect('nabd-05', 'nabd-05', 'pw-05');
  // SUBACK 0x80: mqtt.js rejects the subscribe, and the client stays connected.
  await expect(dev.subscribeAsync('nabd/v1/fayoum/nabd-06/cmd', { qos: 1 })).rejects.toThrow(
    /Subscribe error/,
  );
  expect(dev.connected).toBe(true);

  await dev.publishAsync('nabd/v1/fayoum/nabd-05/telemetry', '{}', { qos: 1 });
  // aedes drops an unauthorized publish by closing the client, so this one goes last.
  await dev.publishAsync('nabd/v1/fayoum/nabd-06/telemetry', '{}', { qos: 0 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  expect(received).toEqual(['nabd/v1/fayoum/nabd-05/telemetry']);
});
