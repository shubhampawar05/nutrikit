// PostgreSQL connections for the application store, and schema migrations.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { runner } from 'node-pg-migrate';
import type { RunnerOption } from 'node-pg-migrate';
import type { ClientConfig } from 'pg';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const open = new Set<Sql>();

/** Opens a pool. bigint columns (counts, sums, token limits) come back as JS numbers. */
export function createSql(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  const sql = postgres(url, {
    max: Number(process.env.NUTRIKIT_DB_POOL || 10),
    onnotice: () => {},
    types: { bigint: { to: 20, from: [20], parse: Number, serialize: String } },
  });
  open.add(sql);
  return sql;
}

/** Closes every pool opened by createSql (tests and scripts). */
export async function closeAll(): Promise<void> {
  await Promise.all([...open].map((sql) => sql.end({ timeout: 5 })));
  open.clear();
}

export async function migrate(url = process.env.DATABASE_URL, direction: RunnerOption['direction'] = 'up', count?: number) {
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return runner({ databaseUrl: migrationConnection(url), dir: MIGRATIONS_DIR, direction, count, migrationsTable: 'pgmigrations', log: () => {}, singleTransaction: true });
}

// The migration runner uses pg, which reads sslmode=require/prefer as verify-full; postgres.js (the app's
// pool) and libpq read them as "encrypt, don't verify". Give pg the libpq meaning so one DATABASE_URL works
// for both against hosted Postgres whose certificate is signed by the provider's own CA (Supabase, Render).
export function migrationConnection(url: string): string | ClientConfig {
  const parsed = new URL(url);
  const mode = parsed.searchParams.get('sslmode');
  if (mode !== 'require' && mode !== 'prefer') return url;
  parsed.searchParams.delete('sslmode');
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } };
}
