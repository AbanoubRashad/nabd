import { parseStatus, parseTelemetry, parseTopic } from '@nabd/shared';
import type { DeadLetter, DeviceStatusUpdate, ReadingRow } from '@nabd/db';

export type Routed =
  | { kind: 'readings'; deviceId: string; rows: ReadingRow[]; ts: Date }
  | { kind: 'status'; update: DeviceStatusUpdate }
  | { kind: 'dead'; letter: DeadLetter };

/** Payloads are stored in dead letters for debugging, cut to this length. */
const MAX_STORED_PAYLOAD = 2048;

/**
 * Turns one MQTT message into what ingest should do with it. Pure: `known` maps each registered device to
 * its site, so a message from an unknown device or under the wrong site becomes a dead letter instead of a
 * foreign-key error that would fail the whole batch.
 */
export function route(
  topic: string,
  payload: Buffer,
  known: ReadonlyMap<string, string>,
  now: Date = new Date(),
): Routed {
  const dead = (reason: string, deviceId: string | null = null): Routed => ({
    kind: 'dead',
    letter: { topic, deviceId, reason, payload: payload.toString('utf8').slice(0, MAX_STORED_PAYLOAD) },
  });

  const parsed = parseTopic(topic);
  if (!parsed) return dead('bad_topic');
  const { deviceId, siteSlug, leaf } = parsed;
  const site = known.get(deviceId);
  if (site === undefined) return dead('unknown_device');
  if (site !== siteSlug) return dead(`site_mismatch:${siteSlug}`, deviceId);

  if (leaf === 'telemetry') {
    const t = parseTelemetry(payload, now);
    if (!t.ok) return dead(t.reason, deviceId);
    const rows: ReadingRow[] = [];
    for (const [metric, value] of Object.entries(t.value.m)) {
      // A failed sensor publishes null with an entry in `errors`; there is nothing to store for it.
      if (value === null || value === undefined) continue;
      rows.push({ deviceId, ts: t.value.ts, seq: t.value.seq, metric, value });
    }
    return { kind: 'readings', deviceId, rows, ts: new Date(t.value.ts) };
  }

  if (leaf === 'status') {
    const s = parseStatus(payload);
    if (!s.ok) return dead(s.reason, deviceId);
    return {
      kind: 'status',
      update: {
        deviceId,
        online: s.value.online,
        fw: s.value.fw,
        rssi: s.value.rssi,
        uptimeS: s.value.uptime_s,
        bootReason: s.value.boot_reason,
        at: now,
      },
    };
  }

  return dead(`unexpected_leaf:${leaf}`, deviceId);
}
