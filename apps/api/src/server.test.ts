import { createHmac } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { SEED_DEVICES } from '@nabd/shared';
import { ConsoleProvider } from '@nabd/notify';
import { CommandService, type DeviceInfo, type Publisher } from './live/commands.js';
import { Hub } from './live/hub.js';
import { LatencyTracker } from './live/latency.js';
import { MemoryStore } from './memory-store.js';
import { buildServer, verifyMetaSignature } from './server.js';

const CSRF = { 'x-nabd-csrf': '1' };
const APP_SECRET = 'meta-app-secret';

interface Harness {
  app: FastifyInstance;
  store: MemoryStore;
  hub: Hub;
  published: { topic: string; payload: string }[];
  commands: CommandService;
}

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) {
    h.commands.close();
    h.hub.close();
    await h.app.close();
  }
});

/** A fake broker link: records publishes, and can play the device's acks back through the service. */
async function harness(opts: { autoAck?: boolean; timeoutMs?: number } = {}): Promise<Harness> {
  const store = new MemoryStore();
  const hub = new Hub(store, 60_000);
  const published: { topic: string; payload: string }[] = [];
  const devices = new Map<string, DeviceInfo>(
    SEED_DEVICES.map((d) => [d.id, { siteSlug: d.siteSlug, isSimulated: d.isSimulated }]),
  );
  const ref = {} as { commands: CommandService };
  const publisher: Publisher = {
    publish: async (topic, payload) => {
      published.push({ topic, payload });
      if (opts.autoAck && topic.endsWith('/cmd')) {
        const cmd = JSON.parse(payload) as { id: string; args: { ch: 1 | 2; on: boolean } };
        const deviceId = topic.split('/')[3]!;
        setTimeout(() => void ref.commands.onAck(deviceId, { id: cmd.id, state: 'delivered' }), 20);
        setTimeout(
          () => void ref.commands.onAck(deviceId, { id: cmd.id, state: 'done', relay: cmd.args }),
          40,
        );
      }
    },
  };
  const commands = (ref.commands = new CommandService(
    store,
    publisher,
    hub,
    () => devices,
    opts.timeoutMs ?? 10_000,
  ));
  const app = await buildServer({
    store,
    hub,
    latency: new LatencyTracker(),
    commands,
    publisher,
    providers: { whatsapp: new ConsoleProvider(() => {}), email: new ConsoleProvider(() => {}) },
    devices: () => devices,
    config: {
      jwtSecret: 'test-secret-test-secret-test-secret',
      secureCookies: false,
      webOrigins: ['http://localhost:3001'],
      whatsappAppSecret: APP_SECRET,
      whatsappVerifyToken: 'verify-me',
      logLevel: 'silent',
    },
  });
  const h = { app, store, hub, published, commands };
  open.push(h);
  return h;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loginAsAdmin(h: Harness): Promise<string> {
  h.store.users.push({
    id: 1,
    email: 'owner@example.com',
    name: 'Owner',
    role: 'admin',
    passwordHash: await argon2.hash('correct horse', { type: argon2.argon2id }),
  });
  const res = await h.app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: CSRF,
    payload: { email: 'owner@example.com', password: 'correct horse' },
  });
  expect(res.statusCode).toBe(200);
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

describe('read endpoints', () => {
  it('serves health, sites and devices', async () => {
    const { app } = await harness();
    expect((await app.inject('/healthz')).json()).toMatchObject({ ok: true, service: 'api' });
    expect((await app.inject('/sites')).json()).toHaveLength(4);
    expect((await app.inject('/devices')).json()).toHaveLength(12);
    expect((await app.inject('/devices/nabd-99')).statusCode).toBe(404);
  });

  it('picks the aggregate from the requested range', async () => {
    const { app } = await harness();
    const to = '2026-10-14T12:00:00.000Z';
    const day = await app.inject(
      `/devices/nabd-01/readings?metric=bus_v&from=2026-10-13T12:00:00.000Z&to=${to}`,
    );
    expect(day.json()).toMatchObject({ source: '1m' });
    const bad = await app.inject(`/devices/nabd-01/readings?metric=warp&to=${to}`);
    expect(bad.statusCode).toBe(400);
  });

  it('publishes an OpenAPI document', async () => {
    const { app } = await harness();
    await app.ready();
    const spec = app.swagger() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(['/devices/{id}/readings', '/alert-rules/{id}/test']),
    );
  });
});

describe('commands (Phase 3)', () => {
  it('rejects a mutation without the CSRF header', async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: 'POST',
      url: '/devices/nabd-05/commands',
      payload: { op: 'relay.set', args: { ch: 1, on: false } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'csrf' });
  });

  it('runs sent → delivered → done for an anonymous visitor on a simulated device', async () => {
    const h = await harness({ autoAck: true });
    const res = await h.app.inject({
      method: 'POST',
      url: '/devices/nabd-05/commands',
      headers: CSRF,
      payload: { op: 'relay.set', args: { ch: 1, on: false } },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;
    expect(h.published[0]?.topic).toBe('nabd/v1/fayoum/nabd-05/cmd');
    expect(JSON.parse(h.published[0]!.payload)).toMatchObject({
      id,
      op: 'relay.set',
      args: { ch: 1, on: false },
    });

    await wait(80);
    const done = (await h.app.inject(`/commands/${id}`)).json() as Record<string, unknown>;
    expect(done).toMatchObject({
      state: 'done',
      result: { relay: { ch: 1, on: false } },
      requestedBy: 'demo visitor',
    });
    expect(done.sentAt).not.toBeNull();
    expect(done.deliveredAt).not.toBeNull();
  });

  it('limits anonymous visitors to one command every 3 seconds', async () => {
    const h = await harness();
    const send = () =>
      h.app.inject({
        method: 'POST',
        url: '/devices/nabd-06/commands',
        headers: CSRF,
        payload: { op: 'relay.set', args: { ch: 1, on: true } },
      });
    expect((await send()).statusCode).toBe(202);
    expect((await send()).statusCode).toBe(429);
  });

  it('never lets an anonymous visitor command the real board', async () => {
    const h = await harness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/devices/nabd-01/commands',
      headers: CSRF,
      payload: { op: 'relay.set', args: { ch: 1, on: true } },
    });
    expect(res.statusCode).toBe(403);
    expect(h.published).toHaveLength(0);
  });

  it('lets an admin command the real board', async () => {
    const h = await harness();
    const cookie = await loginAsAdmin(h);
    const res = await h.app.inject({
      method: 'POST',
      url: '/devices/nabd-01/commands',
      headers: { ...CSRF, cookie },
      payload: { op: 'relay.set', args: { ch: 1, on: true } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ requestedBy: 'Owner' });
  });

  it('times out when the device never answers, and accepts a late confirmation', async () => {
    const h = await harness({ timeoutMs: 50 });
    const res = await h.app.inject({
      method: 'POST',
      url: '/devices/nabd-12/commands',
      headers: CSRF,
      payload: { op: 'relay.set', args: { ch: 1, on: true } },
    });
    const id = (res.json() as { id: string }).id;
    await wait(80);
    expect((await h.app.inject(`/commands/${id}`)).json()).toMatchObject({ state: 'timeout' });

    await h.commands.onAck('nabd-12', { id, state: 'done', relay: { ch: 1, on: true } });
    expect((await h.app.inject(`/commands/${id}`)).json()).toMatchObject({ state: 'done' });
  });

  it('ignores an ack from a device the command was not sent to', async () => {
    const h = await harness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/devices/nabd-06/commands',
      headers: CSRF,
      payload: { op: 'relay.set', args: { ch: 1, on: true } },
    });
    const id = (res.json() as { id: string }).id;
    await h.commands.onAck('nabd-07', { id, state: 'done' });
    expect((await h.app.inject(`/commands/${id}`)).json()).toMatchObject({ state: 'sent' });
  });

  it('rejects a relay the device does not have', async () => {
    const h = await harness();
    const res = await h.app.inject({
      method: 'POST',
      url: '/devices/nabd-05/commands',
      headers: CSRF,
      payload: { op: 'relay.set', args: { ch: 2, on: true } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('auth and rules', () => {
  it('rejects a wrong password and keeps rule edits admin-only', async () => {
    const h = await harness();
    const bad = await h.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: CSRF,
      payload: { email: 'nobody@example.com', password: 'x' },
    });
    expect(bad.statusCode).toBe(401);

    const rule = {
      name: 'Pump soil too dry',
      deviceId: 'nabd-05',
      siteSlug: null,
      metric: 'soil_pct',
      operator: 'lt',
      threshold: 25,
      thresholdHigh: null,
      forSeconds: 600,
      clearThreshold: 30,
      cooldownSeconds: 3600,
      severity: 'warning',
      quietHours: null,
      channels: ['whatsapp'],
      escalateAfterSeconds: null,
      enabled: true,
    };
    expect(
      (await h.app.inject({ method: 'POST', url: '/alert-rules', headers: CSRF, payload: rule })).statusCode,
    ).toBe(401);

    const cookie = await loginAsAdmin(h);
    expect((await h.app.inject({ url: '/auth/me', headers: { cookie } })).json()).toEqual({
      role: 'admin',
      name: 'Owner',
    });
    const created = await h.app.inject({
      method: 'POST',
      url: '/alert-rules',
      headers: { ...CSRF, cookie },
      payload: rule,
    });
    expect(created.statusCode).toBe(201);
  });

  it('rotates refresh tokens: each one works once', async () => {
    const h = await harness();
    const cookies = await loginAsAdmin(h);
    const refresh = cookies.split('; ').find((c) => c.startsWith('nabd_rt='))!;
    const first = await h.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { ...CSRF, cookie: refresh },
    });
    expect(first.statusCode).toBe(200);
    const again = await h.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { ...CSRF, cookie: refresh },
    });
    expect(again.statusCode).toBe(401);
  });

  it('backtests a rule over the stored minutes', async () => {
    const h = await harness();
    const start = Date.now() - 86_400_000;
    // Two warm spells of 6 minutes, far enough apart to be two alerts.
    h.store.minutes = Array.from({ length: 120 }, (_, i) => ({
      at: start + i * 60_000,
      value: (i >= 10 && i < 16) || (i >= 80 && i < 86) ? 8.5 : 5,
    }));
    const res = await h.app.inject({ method: 'POST', url: '/alert-rules/1/test', headers: CSRF });
    expect(res.json()).toEqual({ fired: 2, devices: 1, days: 7 });
  });
});

describe('WhatsApp webhook', () => {
  const sign = (body: string) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
  const reply = (text: string) =>
    JSON.stringify({
      entry: [
        {
          changes: [{ value: { messages: [{ from: '201000000000', type: 'text', text: { body: text } }] } }],
        },
      ],
    });

  it('answers the verification handshake', async () => {
    const { app } = await harness();
    const ok = await app.inject(
      '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42',
    );
    expect(ok.body).toBe('42');
    expect((await app.inject('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=no')).statusCode).toBe(
      403,
    );
  });

  it('refuses an unsigned or badly signed request', async () => {
    const { app } = await harness();
    const body = reply('1');
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('turns reply "1" into an acknowledgement and "2" into a mute', async () => {
    const h = await harness();
    h.store.recipients.set('+201000000000', '42');
    for (const text of ['1', '2', 'hello']) {
      const body = reply(text);
      const res = await h.app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
    }
    expect(h.store.actions).toEqual([
      { alertId: '42', action: 'ack', by: 'whatsapp:+201000000000' },
      { alertId: '42', action: 'mute', by: 'whatsapp:+201000000000' },
    ]);
  });

  it('verifies signatures in constant time and rejects wrong lengths', () => {
    expect(verifyMetaSignature('x', 'sha256=abcd', 's')).toBe(false);
    expect(verifyMetaSignature('x', undefined, 's')).toBe(false);
  });
});

describe('WebSocket', () => {
  it('pushes subscribed events and back-fills missed readings by seq', async () => {
    const h = await harness();
    h.store.messages = [
      { deviceId: 'nabd-07', seq: 10, ts: new Date().toISOString(), m: { probe_c: 5.1 } },
      { deviceId: 'nabd-07', seq: 11, ts: new Date().toISOString(), m: { probe_c: 5.2 } },
    ];
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const address = h.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const received: Record<string, unknown>[] = [];
    ws.on('message', (d) => received.push(JSON.parse(d.toString()) as Record<string, unknown>));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'subscribe', sites: ['heliopolis'], since: { 'nabd-07': 10 } }));
    await wait(100);

    h.hub.publish({
      type: 'reading',
      deviceId: 'nabd-07',
      siteSlug: 'heliopolis',
      seq: 12,
      ts: new Date().toISOString(),
      m: { probe_c: 5.3 },
    });
    h.hub.publish({
      type: 'reading',
      deviceId: 'nabd-04',
      siteSlug: 'fayoum',
      seq: 1,
      ts: new Date().toISOString(),
      m: { air_c: 30 },
    });
    await wait(100);
    ws.close();

    const types = received.map((m) => m.type);
    expect(types).toEqual(['hello', 'subscribed', 'backfill', 'reading']);
    const backfill = received[2] as { readings: { seq: number }[] };
    expect(backfill.readings.map((r) => r.seq)).toEqual([11]);
    expect(received[3]).toMatchObject({ deviceId: 'nabd-07', seq: 12 });
  });
});
