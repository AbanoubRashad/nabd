import { createHmac, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  INITIAL_RULE_STATE,
  METRICS,
  TOPIC_ROOT,
  evaluate,
  pickSource,
  topic,
  type RuleConfig,
} from '@nabd/shared';
import { renderText, sendWithRetry, type Providers } from '@nabd/notify';
import { authPlugin, requireRole } from './auth.js';
import {
  alertDto,
  commandDto,
  createCommandBody,
  deviceDto,
  errorDto,
  firmwareDto,
  fleetEventDto,
  historyDto,
  readingsQuery,
  ruleBody,
  ruleDto,
  seriesDto,
  siteDto,
  statsDto,
  userDto,
  type RuleDto,
} from './dto.js';
import type { CommandService, DeviceInfo, Publisher } from './live/commands.js';
import type { Hub } from './live/hub.js';
import type { LatencyTracker } from './live/latency.js';
import type { Store } from './store.js';

export interface ServerDeps {
  store: Store;
  hub: Hub;
  latency: LatencyTracker;
  commands: CommandService;
  publisher: Publisher;
  providers: Providers;
  /** device id → registry info, refreshed by main.ts. */
  devices: () => ReadonlyMap<string, DeviceInfo>;
  config: {
    jwtSecret: string;
    secureCookies: boolean;
    webOrigins: string[];
    whatsappAppSecret: string | null;
    whatsappVerifyToken: string | null;
    logLevel?: string;
  };
}

const idParam = z.object({ id: z.string().max(64) });
const numericId = z.object({ id: z.coerce.number().int().positive() });

function ruleConfig(r: RuleDto, timezone = 'Africa/Cairo'): RuleConfig {
  return {
    operator: r.operator,
    threshold: r.threshold,
    thresholdHigh: r.thresholdHigh,
    forSeconds: r.forSeconds,
    clearThreshold: r.clearThreshold,
    cooldownSeconds: r.cooldownSeconds,
    severity: r.severity,
    quietHours: r.quietHours,
    timezone,
    escalateAfterSeconds: r.escalateAfterSeconds,
  };
}

/** Verifies Meta's `X-Hub-Signature-256: sha256=<hex>` over the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { store, hub, latency, commands } = deps;
  const app = Fastify({
    logger: { level: deps.config.logLevel ?? process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true, // behind Caddy; request.ip is the client's address
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Nabd API',
        version: '1.0.0',
        description:
          'REST API for the Nabd IoT platform. Cookie auth; mutating requests need the `x-nabd-csrf` header.',
      },
      servers: [{ url: 'http://localhost:4000' }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(helmet, { contentSecurityPolicy: false }); // JSON API; the web app sets its own CSP
  await app.register(cors, { origin: deps.config.webOrigins, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin, {
    store,
    jwtSecret: deps.config.jwtSecret,
    secureCookies: deps.config.secureCookies,
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.get('/healthz', { schema: { hide: true } }, async () => ({
    ok: true,
    service: 'api',
    topicRoot: TOPIC_ROOT,
    clients: hub.size,
  }));

  // ---- auth ---------------------------------------------------------------------------------------------

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        body: z.object({ email: z.email().max(200), password: z.string().min(1).max(200) }),
        response: { 200: userDto, 401: errorDto },
      },
    },
    async (req, reply) => {
      const user = await app.auth.login(req.body.email, req.body.password, reply);
      if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], response: { 200: userDto, 401: errorDto } },
    },
    async (req, reply) => {
      const user = await app.auth.refresh(req, reply);
      if (!user) return reply.code(401).send({ error: 'invalid_refresh_token' });
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  );

  app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    await app.auth.logout(req, reply);
    return reply.code(204).send();
  });

  app.get(
    '/auth/me',
    {
      schema: {
        tags: ['auth'],
        response: { 200: z.object({ role: z.enum(['admin', 'viewer', 'anon']), name: z.string() }) },
      },
    },
    async (req) => ({ role: req.identity.role, name: req.identity.name }),
  );

  // ---- fleet --------------------------------------------------------------------------------------------

  app.get('/sites', { schema: { tags: ['fleet'], response: { 200: z.array(siteDto) } } }, () =>
    store.listSites(),
  );

  app.get('/sites/history', { schema: { tags: ['fleet'], response: { 200: z.array(historyDto) } } }, () =>
    store.siteHistory(),
  );

  app.get('/devices', { schema: { tags: ['fleet'], response: { 200: z.array(deviceDto) } } }, () =>
    store.listDevices(),
  );

  app.get(
    '/devices/:id',
    { schema: { tags: ['fleet'], params: idParam, response: { 200: deviceDto, 404: errorDto } } },
    async (req, reply) =>
      (await store.getDevice(req.params.id)) ?? reply.code(404).send({ error: 'not_found' }),
  );

  app.get(
    '/devices/:id/readings',
    {
      schema: {
        tags: ['fleet'],
        description:
          'Picks raw, 1m, 1h or 1d data automatically so the series stays at or under 2,000 points.',
        params: idParam,
        querystring: readingsQuery,
        response: { 200: seriesDto, 400: errorDto, 404: errorDto },
      },
    },
    async (req, reply) => {
      const to = req.query.to ? new Date(req.query.to) : new Date();
      const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 15 * 60_000);
      if (from >= to) return reply.code(400).send({ error: 'bad_range', message: 'from must be before to' });
      if (!deps.devices().has(req.params.id)) return reply.code(404).send({ error: 'not_found' });
      return store.series(
        req.params.id,
        req.query.metric,
        from,
        to,
        pickSource(from.getTime(), to.getTime()),
      );
    },
  );

  app.get('/fleet/stats', { schema: { tags: ['fleet'], response: { 200: statsDto } } }, async () => {
    const [devices, alerts] = await Promise.all([
      store.listDevices(),
      store.listAlerts({ open: true, limit: 500 }),
    ]);
    return {
      devicesTotal: devices.length,
      devicesOnline: devices.filter((d) => d.online).length,
      offline: devices.filter((d) => !d.online).map((d) => ({ id: d.id, since: d.lastSeenAt })),
      messagesPerSecond: latency.rate(),
      openAlerts: {
        critical: alerts.filter((a) => a.severity === 'critical').length,
        warning: alerts.filter((a) => a.severity === 'warning').length,
      },
      latencyP95Ms: latency.p95('push'),
      receiveP95Ms: latency.p95('receive'),
      latencySamples: latency.samples,
    };
  });

  app.get(
    '/events',
    {
      schema: {
        tags: ['fleet'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
        response: { 200: z.array(fleetEventDto) },
      },
    },
    (req) => store.recentEvents(req.query.limit),
  );

  // ---- commands -----------------------------------------------------------------------------------------

  app.post(
    '/devices/:id/commands',
    {
      schema: {
        tags: ['commands'],
        description:
          'Anonymous demo visitors may switch relays on simulated devices only, at most once every 3 seconds per IP.',
        params: idParam,
        body: createCommandBody,
        response: { 202: commandDto, 400: errorDto, 403: errorDto, 404: errorDto, 429: errorDto },
      },
    },
    async (req, reply) => {
      const result = await commands.create(
        req.params.id,
        req.body as Parameters<CommandService['create']>[1],
        { role: req.identity.role, name: req.identity.name, ip: req.ip },
      );
      if (!result.ok) return reply.code(result.status).send({ error: result.error, message: result.message });
      return reply.code(202).send(result.command);
    },
  );

  app.get(
    '/commands/:id',
    { schema: { tags: ['commands'], params: idParam, response: { 200: commandDto, 404: errorDto } } },
    async (req, reply) =>
      (await store.getCommand(req.params.id)) ?? reply.code(404).send({ error: 'not_found' }),
  );

  // ---- alert rules --------------------------------------------------------------------------------------

  app.get('/alert-rules', { schema: { tags: ['alerts'], response: { 200: z.array(ruleDto) } } }, () =>
    store.listRules(),
  );

  app.post(
    '/alert-rules',
    {
      preHandler: requireRole('admin'),
      schema: { tags: ['alerts'], body: ruleBody, response: { 201: ruleDto, 400: errorDto } },
    },
    async (req, reply) => reply.code(201).send(await store.createRule(req.body)),
  );

  app.patch(
    '/alert-rules/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['alerts'],
        params: numericId,
        body: ruleBody,
        response: { 200: ruleDto, 404: errorDto },
      },
    },
    async (req, reply) =>
      (await store.updateRule(req.params.id, req.body)) ?? reply.code(404).send({ error: 'not_found' }),
  );

  app.delete(
    '/alert-rules/:id',
    { preHandler: requireRole('admin'), schema: { tags: ['alerts'], params: numericId } },
    async (req, reply) =>
      (await store.deleteRule(req.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ error: 'not_found' }),
  );

  app.post(
    '/alert-rules/:id/test',
    {
      schema: {
        tags: ['alerts'],
        description: 'Backtest over the last 7 days of one-minute roll-ups: "would have fired N times".',
        params: numericId,
        response: {
          200: z.object({ fired: z.number(), devices: z.number(), days: z.number() }),
          404: errorDto,
        },
      },
    },
    async (req, reply) => {
      const rule = await store.getRule(req.params.id);
      if (!rule) return reply.code(404).send({ error: 'not_found' });
      if (rule.operator === 'offline' || !rule.metric) return { fired: 0, devices: 0, days: 7 };
      const to = new Date();
      const from = new Date(to.getTime() - 7 * 86_400_000);
      const pick = rule.operator === 'gt' ? 'max' : rule.operator === 'lt' ? 'min' : 'avg';
      const config = ruleConfig(rule);
      let fired = 0;
      const devices = await store.ruleDevices(rule);
      for (const deviceId of devices) {
        let state = INITIAL_RULE_STATE;
        for (const p of await store.minuteSeries(deviceId, rule.metric, from, to, pick)) {
          const r = evaluate(config, state, { kind: 'reading', at: p.at, value: p.value });
          state = r.state;
          fired += r.effects.filter((e) => e.type === 'open').length;
        }
      }
      return { fired, devices: devices.length, days: 7 };
    },
  );

  app.post(
    '/alert-rules/:id/test-message',
    {
      preHandler: requireRole('admin'),
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: {
        tags: ['alerts'],
        params: numericId,
        response: { 200: z.object({ sent: z.number(), preview: z.string() }), 404: errorDto },
      },
    },
    async (req, reply) => {
      const rule = await store.getRule(req.params.id);
      if (!rule) return reply.code(404).send({ error: 'not_found' });
      const unit = rule.metric ? (METRICS[rule.metric as keyof typeof METRICS]?.unit ?? '') : '';
      const message = {
        severity: rule.severity,
        reason: 'test' as const,
        subject: rule.name,
        value: rule.threshold === null ? 'no data' : `${rule.threshold} ${unit}`.trim(),
        detail: 'This is a test message from the rule builder.',
        locale: 'en' as const,
        alertId: null,
      };
      let sent = 0;
      for (const channel of rule.channels) {
        // The demo contact has no real number; providers fall back to the console without credentials.
        const result = await sendWithRetry(
          deps.providers[channel],
          channel === 'email' ? 'demo@example.com' : 'demo',
          message,
          {
            attempts: 1,
          },
        );
        if (result.ok) sent++;
      }
      return { sent, preview: renderText(message) };
    },
  );

  // ---- alerts -------------------------------------------------------------------------------------------

  app.get(
    '/alerts',
    {
      schema: {
        tags: ['alerts'],
        querystring: z.object({
          open: z.enum(['true', 'false']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.array(alertDto) },
      },
    },
    (req) => store.listAlerts({ open: req.query.open === 'true', limit: req.query.limit }),
  );

  app.get(
    '/alerts/:id',
    { schema: { tags: ['alerts'], params: idParam, response: { 200: alertDto, 404: errorDto } } },
    async (req, reply) =>
      (await store.getAlert(req.params.id)) ?? reply.code(404).send({ error: 'not_found' }),
  );

  app.post(
    '/alerts/:id/ack',
    {
      preHandler: requireRole('admin', 'viewer'),
      schema: {
        tags: ['alerts'],
        params: idParam,
        response: { 202: z.object({ ok: z.boolean() }), 404: errorDto },
      },
    },
    async (req, reply) => {
      const alert = await store.getAlert(req.params.id);
      if (!alert) return reply.code(404).send({ error: 'not_found' });
      await store.requestAlertAction(alert.id, 'ack', req.identity.name);
      return reply.code(202).send({ ok: true });
    },
  );

  // ---- firmware -----------------------------------------------------------------------------------------

  app.get('/firmware', { schema: { tags: ['firmware'], response: { 200: z.array(firmwareDto) } } }, () =>
    store.listFirmware(),
  );

  app.post(
    '/devices/:id/ota',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['firmware'],
        params: idParam,
        body: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
        response: { 202: z.object({ ok: z.boolean(), version: z.string() }), 404: errorDto, 503: errorDto },
      },
    },
    async (req, reply) => {
      const device = deps.devices().get(req.params.id);
      const release = await store.getFirmware(req.body.version);
      if (!device || !release) return reply.code(404).send({ error: 'not_found' });
      const offer = {
        version: release.version,
        url: release.url,
        sha256: release.sha256,
        sig: release.signature,
      };
      try {
        await deps.publisher.publish(topic(device.siteSlug, req.params.id, 'ota'), JSON.stringify(offer));
      } catch {
        return reply.code(503).send({ error: 'broker_unavailable' });
      }
      await store.recordRollout(release.version, req.params.id);
      return reply.code(202).send({ ok: true, version: release.version });
    },
  );

  // ---- WhatsApp webhook ---------------------------------------------------------------------------------

  // Meta signs the exact bytes it sent, so this route keeps the raw body.
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );

    scope.get('/webhooks/whatsapp', { schema: { hide: true } }, async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (
        q['hub.mode'] === 'subscribe' &&
        deps.config.whatsappVerifyToken &&
        q['hub.verify_token'] === deps.config.whatsappVerifyToken
      ) {
        return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      }
      return reply.code(403).send();
    });

    scope.post(
      '/webhooks/whatsapp',
      { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { hide: true } },
      async (req, reply) => {
        const raw = req.body as string;
        const secret = deps.config.whatsappAppSecret;
        if (
          !secret ||
          !verifyMetaSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, secret)
        ) {
          return reply.code(401).send({ error: 'bad_signature' });
        }
        type Inbound = { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } };
        let messages: Inbound[] = [];
        try {
          const body = JSON.parse(raw) as { entry?: { changes?: { value?: { messages?: Inbound[] } }[] }[] };
          messages =
            body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.messages ?? []) ?? []) ?? [];
        } catch {
          return reply.code(400).send({ error: 'invalid_json' });
        }
        for (const m of messages) {
          const text = (m.text?.body ?? m.button?.text ?? '').trim();
          if (!m.from || (text !== '1' && text !== '2')) continue;
          const alertId = await store.alertForRecipient(`+${m.from.replace(/^\+/, '')}`);
          if (alertId)
            await store.requestAlertAction(alertId, text === '1' ? 'ack' : 'mute', `whatsapp:+${m.from}`);
        }
        // Always 200 for a valid signature, or Meta retries.
        return reply.code(200).send({ ok: true });
      },
    );
  });

  // ---- live ---------------------------------------------------------------------------------------------

  app.get('/ws', { websocket: true, schema: { hide: true } }, (socket, req) => {
    const client = hub.add(socket, req.identity.role);
    const known = () => new Map([...deps.devices()].map(([id, d]) => [id, d.siteSlug]));
    socket.on('message', (data: Buffer) => {
      hub
        .onMessage(client, data.toString(), known())
        .catch((err: unknown) => req.log.warn({ err }, 'ws message failed'));
    });
    socket.on('close', () => hub.remove(client));
  });

  return app;
}
