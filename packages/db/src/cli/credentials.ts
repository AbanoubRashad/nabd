// `pnpm credentials`: generate development MQTT credentials for the 12 devices and the service accounts.
import { relative } from 'node:path';
import { CREDENTIALS_FILE, EMQX_USERS_FILE, REPO_ROOT, ensureCredentials } from '../credentials.js';

const { created } = ensureCredentials();
console.log(
  created.length ? `created credentials for: ${created.join(', ')}` : 'all credentials already exist',
);
console.log(`  ${relative(REPO_ROOT, CREDENTIALS_FILE)}  (used by the simulator, ingest, api and the seed)`);
console.log(`  ${relative(REPO_ROOT, EMQX_USERS_FILE)}  (EMQX bootstrap; restart EMQX to import new users)`);
