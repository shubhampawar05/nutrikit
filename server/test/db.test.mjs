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
