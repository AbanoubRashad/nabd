// `pnpm --filter @nabd/api openapi`: writes docs/api/openapi.json and a Postman collection generated from
// the route schemas, so the published spec always matches the code. Needs no database or broker.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_DEVICES } from '@nabd/shared';
import { ConsoleProvider } from '@nabd/notify';
import { CommandService } from '../live/commands.js';
import { Hub } from '../live/hub.js';
import { LatencyTracker } from '../live/latency.js';
import { MemoryStore } from '../memory-store.js';
import { buildServer } from '../server.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/api');
const store = new MemoryStore();
const hub = new Hub(store);
const publisher = { publish: async () => {} };
const devices = new Map(
  SEED_DEVICES.map((d) => [d.id, { siteSlug: d.siteSlug, isSimulated: d.isSimulated }]),
);
const commands = new CommandService(store, publisher, hub, () => devices);
const app = await buildServer({
  store,
  hub,
  latency: new LatencyTracker(),
  commands,
  publisher,
  providers: { whatsapp: new ConsoleProvider(), email: new ConsoleProvider() },
  devices: () => devices,
  config: {
    jwtSecret: 'openapi-generation-only',
    secureCookies: false,
    webOrigins: [],
    whatsappAppSecret: null,
    whatsappVerifyToken: null,
    logLevel: 'silent',
  },
});
await app.ready();

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: unknown;
}
const spec = app.swagger() as { paths: Record<string, Record<string, Operation>> };

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);

// Postman collection v2.1: one request per operation, grouped by tag, with the CSRF header on mutations.
const groups = new Map<string, unknown[]>();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const tag = op.tags?.[0] ?? 'other';
    const mutating = method !== 'get';
    const raw = `{{baseUrl}}${path.replace(/\{(\w+)\}/g, ':$1')}`;
    const list = groups.get(tag) ?? [];
    list.push({
      name: `${method.toUpperCase()} ${path}`,
      request: {
        method: method.toUpperCase(),
        header: mutating
          ? [
              { key: 'x-nabd-csrf', value: '1' },
              { key: 'content-type', value: 'application/json' },
            ]
          : [],
        url: {
          raw,
          host: ['{{baseUrl}}'],
          path: path
            .replace(/\{(\w+)\}/g, ':$1')
            .split('/')
            .filter(Boolean),
        },
        description: op.description ?? '',
        ...(op.requestBody ? { body: { mode: 'raw', raw: '{}' } } : {}),
      },
    });
    groups.set(tag, list);
  }
}
const collection = {
  info: {
    name: 'Nabd API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description:
      'Generated from the API route schemas. Log in with POST /auth/login first; cookies carry the session.',
  },
  variable: [{ key: 'baseUrl', value: 'http://localhost:4000' }],
  item: [...groups].map(([name, item]) => ({ name, item })),
};
writeFileSync(resolve(out, 'nabd.postman_collection.json'), `${JSON.stringify(collection, null, 2)}\n`);

console.log(
  `wrote ${Object.keys(spec.paths).length} paths to docs/api/openapi.json and the Postman collection`,
);
commands.close();
hub.close();
await app.close();
