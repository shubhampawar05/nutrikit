import { sql } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test database is migrated and isolated per file', async () => {
  const [{ db }] = await sql`SELECT current_database() AS db`;
  assert.match(db, /^nutrikit_test_[0-9a-f]{12}$/);
  await sql`INSERT INTO accounts (id, email, name, password_hash) VALUES ('acct_smoke', 'Smoke@Example.com', 'Smoke', 'x')`;
  const [row] = await sql`SELECT id, plan, created_at FROM accounts WHERE email = 'smoke@example.com'`;
  assert.equal(row.id, 'acct_smoke');
  assert.equal(row.plan, 'free');
  assert.ok(row.created_at instanceof Date);
  const [{ n }] = await sql`SELECT COUNT(*) AS n FROM accounts`;
  assert.equal(n, 1, 'bigint counts come back as numbers');
});

test('migrations read sslmode=require the libpq way (encrypt, do not verify)', async () => {
  const { migrationConnection } = await import('../src/pg.ts');
  const pooler = 'postgres://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  assert.deepEqual(migrationConnection(`${pooler}?sslmode=require`), { connectionString: pooler, ssl: { rejectUnauthorized: false } });
  assert.equal(migrationConnection(`${pooler}?sslmode=verify-full`), `${pooler}?sslmode=verify-full`);
  assert.equal(migrationConnection('postgres://u:p@localhost:5433/nutrikit'), 'postgres://u:p@localhost:5433/nutrikit');
});

test('migrations 005, 004 and 003 go down and up again, and 003 backfills allowance counters from usage history', async () => {
  const { migrate } = await import('../src/pg.ts');
  await migrate(process.env.DATABASE_URL, 'down', 3); // 005 (account deletion), 004 (email tokens), then 003
  const [{ exists, tokens }] = await sql`SELECT to_regclass('usage_periods') IS NOT NULL AS exists, to_regclass('email_tokens') IS NOT NULL AS tokens`;
  assert.equal(exists, false);
  assert.equal(tokens, false);

  await sql`INSERT INTO accounts (id, email, name, password_hash) VALUES ('acct_backfill', 'backfill@example.com', 'Backfill', 'x')`;
  await sql`INSERT INTO usage (key_id, account_id, endpoint, tokens, at) VALUES
    ('key_a', 'acct_backfill', 'search', 3, now()),
    ('key_b', 'acct_backfill', 'logPhoto', 23, now()),
    ('key_op', NULL, 'search', 7, now()),
    ('key_op', NULL, 'search', 5, date_trunc('month', now()) - interval '10 days')`;

  await migrate(process.env.DATABASE_URL, 'up');
  const rows = await sql`SELECT subject, to_char(period_start, 'YYYY-MM-DD') AS period, used FROM usage_periods ORDER BY subject, period_start`;
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = Object.fromEntries(rows.filter((r) => r.period.startsWith(month)).map((r) => [r.subject, r.used]));
  assert.equal(thisMonth['acct:acct_backfill'], 26, "an account's keys share one counter");
  assert.equal(thisMonth['key:key_op'], 7);
  assert.equal(rows.filter((r) => r.subject === 'key:key_op').length, 2, 'earlier months get their own rows');
  const [{ cols }] = await sql`SELECT COUNT(*) AS cols FROM information_schema.columns WHERE table_name = 'login_failures' AND column_name = 'ip'`;
  assert.equal(cols, 1);
  const [{ verified, back }] = await sql`
    SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'email_verified_at') AS verified,
           to_regclass('email_tokens') IS NOT NULL AS back`;
  assert.equal(verified, 1);
  assert.equal(back, true);
});
