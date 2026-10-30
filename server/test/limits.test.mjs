import { sql } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSql } from '../src/pg.ts';
import { createKey, authenticate, rateLimit } from '../src/domain/auth.ts';
import { createAccount, login } from '../src/domain/accounts.ts';

// A second pool on the same database stands in for a second app instance.
const other = createSql();

test('per-minute rate limit is shared across instances and sets Retry-After', async () => {
  const { key } = await createKey(sql, { name: 'limited' });
  const ctx = { ...(await authenticate(sql, { authorization: `Bearer ${key}` })), ratePerMinute: 4 };
  await rateLimit(sql, ctx);
  await rateLimit(other, ctx);
  await rateLimit(sql, ctx);
  await rateLimit(other, ctx);
  await assert.rejects(rateLimit(sql, ctx), (e) => e.status === 429 && e.code === 'rate_limited' && e.retryAfter >= 1 && e.retryAfter <= 60);
  await assert.rejects(rateLimit(other, ctx), (e) => e.code === 'rate_limited');
});

test('a rate window resets after a minute', async () => {
  const { key } = await createKey(sql, { name: 'reset' });
  const ctx = { ...(await authenticate(sql, { authorization: `Bearer ${key}` })), ratePerMinute: 1 };
  await rateLimit(sql, ctx);
  await assert.rejects(rateLimit(sql, ctx), (e) => e.code === 'rate_limited');
  await sql`UPDATE rate_windows SET window_start = window_start - interval '61 seconds' WHERE bucket = ${`key:${ctx.id}`}`;
  await rateLimit(other, ctx);
});

test('failed logins are throttled across instances: 5 per 15 minutes per email', async () => {
  const email = `throttle-${Date.now()}@example.com`;
  await createAccount(sql, { name: 'Throttle', email, password: 'correct horse battery' });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(login(i % 2 ? other : sql, { email, password: 'wrong password' }), (e) => e.code === 'invalid_credentials');
  }
  await assert.rejects(login(other, { email: email.toUpperCase(), password: 'correct horse battery' }),
    (e) => e.status === 429 && e.code === 'too_many_attempts' && e.retryAfter === 900);
  await sql`UPDATE login_failures SET at = at - interval '16 minutes'`;
  const account = await login(other, { email, password: 'correct horse battery' });
  assert.equal(account.email, email);
  const [{ n }] = await sql`SELECT COUNT(*) AS n FROM login_failures WHERE email = ${email}`;
  assert.equal(n, 0, 'a successful login clears the failures');
});
