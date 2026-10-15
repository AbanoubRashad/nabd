import { buildServer } from './server.js';

const app = buildServer();
const port = Number(process.env.API_PORT ?? 4000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host: process.env.API_HOST ?? '0.0.0.0' });
