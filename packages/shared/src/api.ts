/**
 * API request and response shapes, shared by the API (request validation, OpenAPI) and the web app (types).
 * The OpenAPI document (docs/api/openapi.json) is generated from these schemas, so it cannot drift.
 */
import { z } from 'zod';
import { COMMAND_STATES } from './commands.js';
import { METRIC_KEYS } from './metrics.js';

export const siteStatus = z.enum(['ok', 'warning', 'critical']);

export const siteDto = z.object({
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  placeEn: z.string(),
  placeAr: z.string(),
  kind: z.string(),
  timezone: z.string(),
  lat: z.number(),
  lng: z.number(),
  image: z.string().nullable(),
  /** Worst open alert on the site's devices. */
  status: siteStatus,
  deviceIds: z.array(z.string()),
});
export type SiteDto = z.infer<typeof siteDto>;

export const latestReading = z.object({ value: z.number(), ts: z.string() });

export const deviceDto = z.object({
  id: z.string(),
  siteSlug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  kind: z.string(),
  isSimulated: z.boolean(),
  fwVersion: z.string().nullable(),
  online: z.boolean(),
  rssi: z.number().nullable(),
  uptimeS: z.number().nullable(),
  bootReason: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  /** Latest value per metric, from the last hour. */
  latest: z.record(z.string(), latestReading),
  status: z.enum(['ok', 'warning', 'critical', 'offline']),
});
export type DeviceDto = z.infer<typeof deviceDto>;

export const seriesPoint = z.object({
  t: z.string(),
  avg: z.number(),
  min: z.number(),
  max: z.number(),
});
export const seriesDto = z.object({
  deviceId: z.string(),
  metric: z.string(),
  source: z.enum(['raw', '1m', '1h', '1d']),
  from: z.string(),
  to: z.string(),
  points: z.array(seriesPoint),
});
export type SeriesDto = z.infer<typeof seriesDto>;

export const readingsQuery = z.object({
  metric: z.enum(METRIC_KEYS as [string, ...string[]]),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const commandDto = z.object({
  id: z.string(),
  deviceId: z.string(),
  op: z.string(),
  args: z.record(z.string(), z.unknown()),
  state: z.enum(COMMAND_STATES),
  requestedBy: z.string(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  expiresAt: z.string(),
  error: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
});
export type CommandDto = z.infer<typeof commandDto>;

export const createCommandBody = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('relay.set'),
    args: z.object({ ch: z.union([z.literal(1), z.literal(2)]), on: z.boolean() }),
  }),
  z.object({ op: z.literal('reboot'), args: z.object({}).default({}) }),
]);

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ruleBody = z
  .object({
    name: z.string().min(1).max(80),
    deviceId: z.string().nullable(),
    siteSlug: z.string().nullable(),
    metric: z.enum(METRIC_KEYS as [string, ...string[]]).nullable(),
    operator: z.enum(['gt', 'lt', 'outside', 'offline']),
    threshold: z.number().nullable(),
    thresholdHigh: z.number().nullable(),
    forSeconds: z.int().min(0).max(86_400),
    clearThreshold: z.number().nullable(),
    cooldownSeconds: z
      .int()
      .min(0)
      .max(7 * 86_400),
    severity: z.enum(['warning', 'critical']),
    quietHours: z.object({ start: hm, end: hm }).nullable(),
    channels: z.array(z.enum(['whatsapp', 'email'])).max(2),
    escalateAfterSeconds: z.int().min(60).max(86_400).nullable(),
    enabled: z.boolean().default(true),
  })
  .refine((r) => !(r.deviceId && r.siteSlug), { message: 'choose a device or a site, not both' })
  .refine((r) => r.operator === 'offline' || (r.metric !== null && r.threshold !== null), {
    message: 'value rules need a metric and a threshold',
  })
  .refine((r) => r.operator !== 'outside' || r.thresholdHigh !== null, {
    message: 'outside-range rules need an upper threshold',
  });
export type RuleBody = z.infer<typeof ruleBody>;

export const ruleDto = z.object({
  id: z.number(),
  name: z.string(),
  deviceId: z.string().nullable(),
  siteSlug: z.string().nullable(),
  metric: z.string().nullable(),
  operator: z.enum(['gt', 'lt', 'outside', 'offline']),
  threshold: z.number().nullable(),
  thresholdHigh: z.number().nullable(),
  forSeconds: z.number(),
  clearThreshold: z.number().nullable(),
  cooldownSeconds: z.number(),
  severity: z.enum(['warning', 'critical']),
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
  channels: z.array(z.enum(['whatsapp', 'email'])),
  escalateAfterSeconds: z.number().nullable(),
  enabled: z.boolean(),
  /** Is any alert from this rule open right now? */
  state: z.enum(['ok', 'firing']),
});
export type RuleDto = z.infer<typeof ruleDto>;

export const alertEventDto = z.object({
  at: z.string(),
  kind: z.string(),
  detail: z.record(z.string(), z.unknown()),
});

export const alertDto = z.object({
  id: z.string(),
  ruleId: z.number(),
  ruleName: z.string(),
  deviceId: z.string(),
  siteSlug: z.string(),
  severity: z.enum(['warning', 'critical']),
  state: z.enum(['pending', 'firing', 'acknowledged', 'muted', 'resolved']),
  openedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  peakValue: z.number().nullable(),
  events: z.array(alertEventDto).optional(),
});
export type AlertDto = z.infer<typeof alertDto>;

export const firmwareDto = z.object({
  version: z.string(),
  sha256: z.string(),
  url: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type FirmwareDto = z.infer<typeof firmwareDto>;

export const fleetEventDto = z.object({
  at: z.string(),
  kind: z.enum(['alert', 'command', 'ota']),
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  detail: z.string(),
  deviceId: z.string(),
});
export type FleetEventDto = z.infer<typeof fleetEventDto>;

export const statsDto = z.object({
  devicesTotal: z.number(),
  devicesOnline: z.number(),
  offline: z.array(z.object({ id: z.string(), since: z.string().nullable() })),
  messagesPerSecond: z.number(),
  openAlerts: z.object({ critical: z.number(), warning: z.number() }),
  /** p95 of pushed_at − device ts over the last ~1,000 live readings; null until there is data. */
  latencyP95Ms: z.number().nullable(),
  receiveP95Ms: z.number().nullable(),
  latencySamples: z.number(),
});
export type StatsDto = z.infer<typeof statsDto>;

export const historyDto = z.object({
  slug: z.string(),
  /** 24 entries, oldest first: the worst state in each hour. */
  hours: z.array(z.enum(['ok', 'warning', 'critical'])),
  /** Share of the 24 hours without a critical alert, 0–100. */
  uptimePct: z.number(),
});
export type HistoryDto = z.infer<typeof historyDto>;

export const userDto = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'viewer']),
});
export type UserDto = z.infer<typeof userDto>;

export const errorDto = z.object({ error: z.string(), message: z.string().optional() });
