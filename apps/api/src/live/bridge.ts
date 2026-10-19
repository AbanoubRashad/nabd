/**
 * The API's own MQTT subscription (not shared): telemetry, status and command acks go straight to the
 * WebSocket hub, and acks to the command service. Ingest remains the only writer of readings.
 */
import mqtt, { type MqttClient } from 'mqtt';
import type { Logger } from 'pino';
import { parseAck, parseStatus, parseTelemetry, parseTopic } from '@nabd/shared';
import type { CommandService, Publisher } from './commands.js';
import type { Hub } from './hub.js';
import type { LatencyTracker } from './latency.js';

export const API_SUBSCRIPTIONS = ['nabd/v1/+/+/telemetry', 'nabd/v1/+/+/status', 'nabd/v1/+/+/cmd/ack'];

export interface BridgeDeps {
  hub: Hub;
  latency: LatencyTracker;
  commands: () => CommandService;
  known: () => ReadonlyMap<string, string>;
  log: Logger;
}

/** Handles one MQTT message. Exported for tests. */
export function handleMessage(
  topicName: string,
  payload: Buffer,
  d: BridgeDeps,
  receivedAt = Date.now(),
): void {
  const t = parseTopic(topicName);
  if (!t) return;
  // A device must be registered, under the site it says it is in.
  if (d.known().get(t.deviceId) !== t.siteSlug) return;
  const base = { deviceId: t.deviceId, siteSlug: t.siteSlug };

  if (t.leaf === 'telemetry') {
    const r = parseTelemetry(payload, new Date(receivedAt));
    if (!r.ok) return;
    const pushedAt = Date.now();
    d.hub.publish({
      type: 'reading',
      ...base,
      seq: r.value.seq,
      ts: r.value.ts,
      m: r.value.m,
      pushedAt: new Date(pushedAt).toISOString(),
    });
    d.latency.record(Date.parse(r.value.ts), receivedAt, pushedAt);
  } else if (t.leaf === 'status') {
    const r = parseStatus(payload);
    if (!r.ok) return;
    d.hub.publish({
      type: 'status',
      ...base,
      online: r.value.online,
      fw: r.value.fw,
      rssi: r.value.rssi,
      uptimeS: r.value.uptime_s,
    });
  } else if (t.leaf === 'cmd/ack') {
    const r = parseAck(payload);
    if (!r.ok) return;
    d.commands()
      .onAck(t.deviceId, r.value)
      .catch((err: unknown) => d.log.error({ err }, 'ack handling failed'));
  } else {
    return;
  }
  // The device page shows the raw stream; payloads are already size-checked by the parsers above.
  d.hub.publish({
    type: 'raw',
    ...base,
    topic: t.leaf,
    payload: payload.toString('utf8'),
    at: new Date(receivedAt).toISOString(),
  });
}

export function connectBridge(
  url: string,
  password: string,
  deps: BridgeDeps,
): { client: MqttClient; publisher: Publisher } {
  const client = mqtt.connect(url, {
    clientId: `svc-api-${process.pid}`,
    username: 'svc-api',
    password,
    protocolVersion: 4,
    keepalive: 30,
    reconnectPeriod: 2000,
  });
  client.on('connect', () => {
    deps.log.info({ url }, 'api connected to broker');
    client.subscribe(API_SUBSCRIPTIONS, { qos: 1 }, (err) => {
      if (err) deps.log.error({ err }, 'subscribe failed');
    });
  });
  client.on('error', (err) => deps.log.warn({ err: err.message }, 'mqtt error'));
  client.on('message', (t, payload) => handleMessage(t, payload, deps));

  const publisher: Publisher = {
    publish: async (t, payload) => {
      if (!client.connected) throw new Error('not connected to the broker');
      await client.publishAsync(t, payload, { qos: 1 });
    },
  };
  return { client, publisher };
}
