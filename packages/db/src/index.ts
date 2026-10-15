import pg from 'pg';

export type { Pool, PoolClient } from 'pg';

/** Creates the connection pool. Every query in Nabd is parameterised; never interpolate values into SQL. */
export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString, max: 10, application_name: process.env.SERVICE_NAME ?? 'nabd' });
}
