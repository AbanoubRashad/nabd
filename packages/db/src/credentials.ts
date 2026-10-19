import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_DEVICES } from '@nabd/shared';

/** Repo root, from both src/ (tsx) and dist/ (node). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Development credentials. Both paths are under a `secrets/` directory, which .gitignore excludes. */
export const CREDENTIALS_FILE = resolve(REPO_ROOT, 'secrets/dev-credentials.json');
export const EMQX_USERS_FILE = resolve(REPO_ROOT, 'infra/emqx/secrets/users.csv');

/** MQTT service accounts. Each one gets only the topics it needs (infra/emqx/acl.conf). */
export const SERVICE_ACCOUNTS = ['svc-ingest', 'svc-api'] as const;

export interface Credentials {
  devices: Record<string, string>;
  services: Record<(typeof SERVICE_ACCOUNTS)[number], string>;
}

const secret = () => randomBytes(24).toString('base64url');

export function readCredentials(file = process.env.NABD_CREDENTIALS_FILE ?? CREDENTIALS_FILE): Credentials {
  if (!existsSync(file)) {
    throw new Error(`${file} not found. Run \`pnpm credentials\` first.`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Credentials;
}

/**
 * Creates any missing credentials, keeping existing ones so a re-run does not lock out a running broker, and
 * writes the EMQX bootstrap file (plain passwords; EMQX hashes them with PBKDF2 on import).
 */
export function ensureCredentials(): { credentials: Credentials; created: string[] } {
  const current: Partial<Credentials> = existsSync(CREDENTIALS_FILE)
    ? (JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as Credentials)
    : {};
  const created: string[] = [];
  const devices = { ...current.devices };
  for (const d of SEED_DEVICES) {
    if (!devices[d.id]) {
      devices[d.id] = secret();
      created.push(d.id);
    }
  }
  const services = { ...current.services } as Credentials['services'];
  for (const s of SERVICE_ACCOUNTS) {
    if (!services[s]) {
      services[s] = secret();
      created.push(s);
    }
  }
  const credentials: Credentials = { devices, services };

  mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true });
  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });

  const rows = [...Object.entries(devices), ...Object.entries(services)].map(
    ([user, pw]) => `${user},${pw},false`,
  );
  mkdirSync(dirname(EMQX_USERS_FILE), { recursive: true });
  writeFileSync(EMQX_USERS_FILE, `user_id,password,is_superuser\n${rows.join('\n')}\n`, { mode: 0o600 });

  return { credentials, created };
}
