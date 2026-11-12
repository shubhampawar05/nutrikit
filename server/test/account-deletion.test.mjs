import { sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';

const app = await buildApp();
let base;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

const PASSWORD = 'correct horse battery';
const ADMIN = { Authorization: 'Bearer test-admin-token' };
let counter = 0;
const email = () => `delete${++counter}-${Date.now()}@example.com`;

/** A cookie-keeping portal client. */
function browser() {
  let cookie = '';
  return {
    async call(method, path, body, { csrf = true } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-Nutrikit-Portal': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
    },
  };
}

async function signUp(addr = email()) {
  const b = browser();
  const { body } = await b.call('POST', '/portal/api/signup', { name: 'Delete Co', email: addr, password: PASSWORD });
  return { b, addr, accountId: body.account.id, key: body.firstKey.key };
}

const count = async (query) => Number((await query)[0].n);

test('deleting needs a session, the CSRF header and the right password', async () => {
  assert.equal((await browser().call('POST', '/portal/api/account/delete', { password: PASSWORD })).status, 401);
  const { b, accountId } = await signUp();
  assert.equal((await b.call('POST', '/portal/api/account/delete', { password: PASSWORD }, { csrf: false })).status, 403);

  const wrong = await b.call('POST', '/portal/api/account/delete', { password: 'not my password' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'invalid_password');
  assert.equal(wrong.body.error.fields.password, 'Password is incorrect');
  assert.equal((await b.call('POST', '/portal/api/account/delete', {})).status, 400, 'a missing password is wrong too');
  assert.equal(await count(sql`SELECT COUNT(*) AS n FROM accounts WHERE id = ${accountId}`), 1, 'still there');
  assert.equal((await b.call('GET', '/portal/api/me')).status, 200, 'still signed in');
});

test('deleting removes the account and everything tied to it, and signs out', async () => {
  const { b, addr, accountId, key } = await signUp();
  assert.equal((await fetch(`${base}/v1/foods/search?q=apple`, { headers: { Authorization: `Bearer ${key}` } })).status, 200);
  await b.call('POST', '/portal/api/upgrade', { plan: 'growth', message: 'hello' });
  await sql`INSERT INTO login_failures (email) VALUES (${addr})`;
  await sql`INSERT INTO email_sends (email, purpose) VALUES (${addr}, 'verify')`;

  const res = await b.call('POST', '/portal/api/account/delete', { password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: true });
  assert.match(res.headers.get('set-cookie'), /nk_session=;.*Max-Age=0/, 'the session cookie is cleared');

  assert.equal((await b.call('GET', '/portal/api/me')).status, 401);
  assert.equal((await fetch(`${base}/v1/foods/search?q=apple`, { headers: { Authorization: `Bearer ${key}` } })).status, 401, 'its API keys stop working');
  for (const [table, query] of [
    ['accounts', sql`SELECT COUNT(*) AS n FROM accounts WHERE id = ${accountId}`],
    ['sessions', sql`SELECT COUNT(*) AS n FROM sessions WHERE account_id = ${accountId}`],
    ['api_keys', sql`SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ${accountId}`],
    ['usage', sql`SELECT COUNT(*) AS n FROM usage WHERE account_id = ${accountId}`],
    ['usage_periods', sql`SELECT COUNT(*) AS n FROM usage_periods WHERE subject = ${`acct:${accountId}`}`],
    ['upgrade_requests', sql`SELECT COUNT(*) AS n FROM upgrade_requests WHERE account_id = ${accountId}`],
    ['email_tokens', sql`SELECT COUNT(*) AS n FROM email_tokens WHERE account_id = ${accountId}`],
    ['login_failures', sql`SELECT COUNT(*) AS n FROM login_failures WHERE email = ${addr}`],
    ['email_sends', sql`SELECT COUNT(*) AS n FROM email_sends WHERE email = ${addr}`],
  ]) assert.equal(await count(query), 0, `${table} rows are gone`);

  assert.equal((await browser().call('POST', '/portal/api/login', { email: addr, password: PASSWORD })).status, 401, 'cannot log in again');
  assert.equal((await browser().call('POST', '/portal/api/signup', { name: 'Back again', email: addr, password: PASSWORD })).status, 201, 'the address can sign up afresh');
});

test('payments are kept for accounting, without the deleted account', async () => {
  const { b, accountId } = await signUp();
  const paymentId = `pay_del${Date.now()}`;
  await sql`INSERT INTO payments (payment_id, order_id, account_id, plan, amount, currency, period_end)
            VALUES (${paymentId}, 'order_del', ${accountId}, 'starter', 149900, 'INR', now() + interval '30 days')`;
  assert.equal((await b.call('POST', '/portal/api/account/delete', { password: PASSWORD })).status, 200);

  const [row] = await sql`SELECT account_id, amount FROM payments WHERE payment_id = ${paymentId}`;
  assert.equal(row.account_id, null);
  assert.equal(row.amount, 149900);
  const { payments } = await (await fetch(`${base}/v1/admin/payments`, { headers: ADMIN })).json();
  const listed = payments.find((p) => p.paymentId === paymentId);
  assert.deepEqual({ accountId: listed.accountId, email: listed.email, amount: listed.amount }, { accountId: null, email: null, amount: 1499 });
  const overview = await (await fetch(`${base}/v1/admin/overview`, { headers: ADMIN })).json();
  assert.ok(overview.payments.revenue >= 1499, 'still counted as revenue');
});

test('wrong passwords count as failed logins, so deletion cannot be used to guess', async () => {
  const { b } = await signUp();
  for (let i = 0; i < 5; i++) assert.equal((await b.call('POST', '/portal/api/account/delete', { password: `guess number ${i}` })).status, 400);
  const locked = await b.call('POST', '/portal/api/account/delete', { password: PASSWORD });
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('retry-after'), '900');
  assert.equal((await b.call('GET', '/portal/api/me')).status, 200, 'not deleted');
});
