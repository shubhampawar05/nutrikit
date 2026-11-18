import { sql } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test database is migrated and isolated per file', async () => {
  const [{ db }] = await sql`SELECT current_database() AS db`;
  assert.match(db, /^nutrikit_test_[0-9a-f]{12}$/);
  await sql`INSERT INTO accounts (id, name) VALUES ('acct_smoke', 'Smoke')`;
  await sql`INSERT INTO users (id, email, name, password_hash) VALUES ('usr_smoke', 'Smoke@Example.com', 'Smoke', 'x')`;
  await sql`INSERT INTO memberships (account_id, user_id, role) VALUES ('acct_smoke', 'usr_smoke', 'owner')`;
  const [row] = await sql`SELECT a.id, a.plan, a.created_at FROM accounts a JOIN memberships m ON m.account_id = a.id
    JOIN users u ON u.id = m.user_id WHERE u.email = 'smoke@example.com'`;
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

test('migrations 006 to 003 go down and up again, and 003 backfills allowance counters from usage history', async () => {
  const { migrate } = await import('../src/pg.ts');
  await sql`DELETE FROM memberships`; await sql`DELETE FROM users`; await sql`DELETE FROM accounts`; // the smoke team has no login to give back
  await migrate(process.env.DATABASE_URL, 'down', 4); // 006 (teams), 005 (account deletion), 004 (email tokens), then 003
  const [{ exists, tokens }] = await sql`SELECT to_regclass('usage_periods') IS NOT NULL AS exists, to_regclass('email_tokens') IS NOT NULL AS tokens`;
  assert.equal(exists, false);
  assert.equal(tokens, false);

  await sql`INSERT INTO accounts (id, email, name, password_hash) VALUES ('acct_backfill', 'backfill@example.com', 'Backfill', 'x')`;
  await sql`INSERT INTO usage (key_id, account_id, endpoint, tokens, at) VALUES
    ('key_a', 'acct_backfill', 'search', 3, now()),
    ('key_b', 'acct_backfill', 'logPhoto', 23, now()),
    ('key_op', NULL, 'search', 7, now()),
    ('key_op', NULL, 'search', 5, date_trunc('month', now()) - interval '10 days')`;

  await sql`INSERT INTO api_keys (id, key_hash, name, account_id) VALUES ('key_legacy', 'hash_legacy', 'Old key', 'acct_backfill')`;
  await migrate(process.env.DATABASE_URL, 'up');
  // 006: the account became a team owned by a user with its login; its key is live and remembers its maker.
  const [owner] = await sql`SELECT u.id, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = 'acct_backfill'`;
  assert.deepEqual({ ...owner }, { id: 'usr_backfill', email: 'backfill@example.com', role: 'owner' });
  const [key] = await sql`SELECT mode, created_by FROM api_keys WHERE id = 'key_legacy'`;
  assert.deepEqual({ ...key }, { mode: 'live', created_by: 'usr_backfill' });
  const rows = await sql`SELECT subject, to_char(period_start, 'YYYY-MM-DD') AS period, used FROM usage_periods ORDER BY subject, period_start`;
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = Object.fromEntries(rows.filter((r) => r.period.startsWith(month)).map((r) => [r.subject, r.used]));
  assert.equal(thisMonth['acct:acct_backfill'], 26, "an account's keys share one counter");
  assert.equal(thisMonth['key:key_op'], 7);
  assert.equal(rows.filter((r) => r.subject === 'key:key_op').length, 2, 'earlier months get their own rows');
  const [{ cols }] = await sql`SELECT COUNT(*) AS cols FROM information_schema.columns WHERE table_name = 'login_failures' AND column_name = 'ip'`;
  assert.equal(cols, 1);
  const [{ verified, back }] = await sql`
    SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_verified_at') AS verified,
           to_regclass('email_tokens') IS NOT NULL AS back`;
  assert.equal(verified, 1);
  assert.equal(back, true);
});
