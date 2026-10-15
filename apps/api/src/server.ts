import Fastify, { type FastifyInstance } from 'fastify';
import { TOPIC_ROOT } from '@nabd/shared';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.get('/healthz', async () => ({ ok: true, service: 'api', topicRoot: TOPIC_ROOT }));

  return app;
}
