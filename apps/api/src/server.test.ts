import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('api', () => {
  it('answers /healthz', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: 'api' });
    await app.close();
  });
});
