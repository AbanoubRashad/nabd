import { createServer } from 'node:http';
import { pino } from 'pino';
import { TOPIC_ROOT } from '@nabd/shared';

// Phase 0 placeholder: only the health endpoint. The MQTT work lands in Phase 1.
const log = pino({ name: 'simulator', level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.SIMULATOR_PORT ?? 4200);

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'simulator', topicRoot: TOPIC_ROOT }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(port, () => log.info({ port }, 'simulator ready'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
