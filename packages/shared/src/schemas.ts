import { z } from 'zod';
import { METRICS, isMetricKey, type MetricKey } from './metrics.js';

/** Payloads larger than this are rejected before parsing (the broker also caps packets at 4 KB). */
export const MAX_PAYLOAD_BYTES = 2048;
/** Readings stamped further ahead than this are rejected. Old readings are accepted: they are replays. */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const isoTime = z.iso.datetime({ offset: true });

// ---- device → cloud -------------------------------------------------------------------------------------

export const telemetrySchema = z.strictObject({
  /** Per-device monotonic counter persisted in NVS; `(device_id, seq)` is the idempotency key. */
  seq: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  ts: isoTime,
  /** Metric values. `null` means the sensor failed this sample; never a made-up value. */
  m: z.record(z.string(), z.number().finite().nullable()),
  errors: z.array(z.string().max(64)).max(16).optional(),
});
export type Telemetry = Omit<z.infer<typeof telemetrySchema>, 'm'> & {
  m: Partial<Record<MetricKey, number | null>>;
};

export const statusSchema = z.strictObject({
  online: z.boolean(),
  fw: z.string().max(32).optional(),
  rssi: z.int().min(-127).max(0).optional(),
  uptime_s: z.int().min(0).optional(),
  boot_reason: z.string().max(32).optional(),
  profile: z.string().max(32).optional(),
});
export type Status = z.infer<typeof statusSchema>;

export const ACK_STATES = ['delivered', 'done', 'rejected'] as const;
export type AckState = (typeof ACK_STATES)[number];

/** Relay channel: the board has at most two. */
const relayChannel = z.union([z.literal(1), z.literal(2)]);

const commandId = z.string().regex(/^c-[A-Za-z0-9-]{1,40}$/);

export const ackSchema = z.strictObject({
  id: commandId,
  state: z.enum(ACK_STATES),
  reason: z.string().max(64).optional(),
  relay: z.strictObject({ ch: relayChannel, on: z.boolean() }).optional(),
});
export type Ack = z.infer<typeof ackSchema>;

// ---- cloud → device -------------------------------------------------------------------------------------

export const commandSchema = z.discriminatedUnion('op', [
  z.strictObject({
    id: commandId,
    op: z.literal('relay.set'),
    args: z.strictObject({ ch: relayChannel, on: z.boolean() }),
    exp: isoTime,
  }),
  z.strictObject({
    id: commandId,
    op: z.literal('reboot'),
    args: z.strictObject({}),
    exp: isoTime,
  }),
]);
export type Command = z.infer<typeof commandSchema>;

export const otaSchema = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  url: z.url({ protocol: /^https$/ }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Base64 DER ECDSA P-256 signature over the SHA-256 digest. */
  sig: z.base64(),
});
export type Ota = z.infer<typeof otaSchema>;

// ---- parsing at the edge --------------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

// TextEncoder/TextDecoder rather than Buffer: this package also runs in the browser.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function decode(payload: Uint8Array | string): ParseResult<unknown> {
  const bytes = typeof payload === 'string' ? encoder.encode(payload).byteLength : payload.byteLength;
  if (bytes > MAX_PAYLOAD_BYTES) return { ok: false, reason: `payload_too_large:${bytes}` };
  let text: string;
  try {
    text = typeof payload === 'string' ? payload : decoder.decode(payload);
  } catch {
    return { ok: false, reason: 'invalid_utf8' };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

function zodReason(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `schema:${issue.path.join('.') || '(root)'}:${issue.code}` : 'schema';
}

function parseWith<T>(schema: z.ZodType<T>, payload: Uint8Array | string): ParseResult<T> {
  const decoded = decode(payload);
  if (!decoded.ok) return decoded;
  const result = schema.safeParse(decoded.value);
  return result.success ? { ok: true, value: result.data } : { ok: false, reason: zodReason(result.error) };
}

/**
 * Validates a telemetry payload: size, JSON, shape, registry keys, plausibility ranges and clock skew.
 * The first problem found becomes the dead-letter reason.
 */
export function parseTelemetry(payload: Uint8Array | string, now: Date = new Date()): ParseResult<Telemetry> {
  const parsed = parseWith(telemetrySchema, payload);
  if (!parsed.ok) return parsed;
  const t = parsed.value;

  for (const [key, value] of Object.entries(t.m)) {
    if (!isMetricKey(key)) return { ok: false, reason: `unknown_metric:${key.slice(0, 32)}` };
    if (value === null) continue;
    const def = METRICS[key];
    if (value < def.min || value > def.max) return { ok: false, reason: `out_of_range:${key}` };
  }
  if (Object.keys(t.m).length === 0) return { ok: false, reason: 'no_metrics' };
  if (Date.parse(t.ts) - now.getTime() > MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'ts_in_future' };

  return { ok: true, value: t as Telemetry };
}

export const parseStatus = (payload: Uint8Array | string) => parseWith(statusSchema, payload);
export const parseAck = (payload: Uint8Array | string) => parseWith(ackSchema, payload);
export const parseCommand = (payload: Uint8Array | string) => parseWith(commandSchema, payload);
export const parseOta = (payload: Uint8Array | string) => parseWith(otaSchema, payload);
