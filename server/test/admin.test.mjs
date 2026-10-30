import { sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';

const app = await buildApp();
let base;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  setProvider({ name: 'none' });
});
after(() => app.close());

const ADMIN = { Authorization: 'Bearer test-admin-token' };
const admin = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { ...ADMIN, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  return { status: res.status, body: await res.json() };
};

async function signup(name) {
  const res = await fetch(`${base}/portal/api/signup`, {
    method: 'POST',
    headers: { 'X-Nutrikit-Portal': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: `${name.toLowerCase().replace(/\W/g, '')}-${crypto.randomUUID().slice(0, 8)}@example.com`, password: 'correct horse battery' }),
  });
  const body = await res.json();
  return { id: body.account.id, email: body.account.email, key: body.firstKey };
}

/** Records a payment the way billing does: a payments row and a 30-day period. */
async function paid(account, plan, rupees, { daysAgo = 0 } = {}) {
  const paidAt = new Date(Date.now() - daysAgo * 864e5);
  const periodEnd = new Date(paidAt.getTime() + 30 * 864e5);
  await sql`INSERT INTO payments (payment_id, order_id, account_id, plan, amount, currency, period_end, created_at)
    VALUES (${`pay_${crypto.randomBytes(5).toString('hex')}`}, ${`order_${crypto.randomBytes(5).toString('hex')}`}, ${account.id}, ${plan}, ${rupees * 100}, 'INR', ${periodEnd}, ${paidAt})`;
  await sql`UPDATE accounts SET plan = ${plan}, plan_expires_at = ${periodEnd} WHERE id = ${account.id}`;
}

test('every new admin endpoint needs the admin token', async () => {
  for (const path of ['/v1/admin/overview', '/v1/admin/accounts', '/v1/admin/payments', '/v1/admin/keys']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 401, path);
    assert.equal((await res.json()).error.code, 'unauthorized');
    assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer wrong' } })).status, 401, path);
  }
});

test('overview, payments and accounts after purchases', async () => {
  const before = (await admin('/v1/admin/overview')).body;
  const ada = await signup('Ada Labs');
  const bob = await signup('Bob Foods');
  await paid(ada, 'starter', 1499);
  await paid(bob, 'growth', 11999, { daysAgo: 40 }); // paid 40 days ago: its period has ended

  const o = (await admin('/v1/admin/overview')).body;
  assert.equal(o.accounts, before.accounts + 2);
  assert.equal(o.activePaidPeriods, before.activePaidPeriods + 1, 'only Ada is still paid');
  assert.equal(o.payments.count, before.payments.count + 2);
  assert.equal(o.payments.revenue, before.payments.revenue + 1499 + 11999);
  assert.equal(o.payments.last30Days.revenue, before.payments.last30Days.revenue + 1499);
  assert.equal(o.byPlan.starter, (before.byPlan.starter ?? 0) + 1);
  assert.equal(o.byPlan.growth ?? 0, before.byPlan.growth ?? 0, 'an ended Growth period counts as Free');
  assert.ok(o.activeKeys >= 2);

  const payments = (await admin(`/v1/admin/payments?q=${encodeURIComponent(ada.email.slice(0, 12))}`)).body.payments;
  assert.equal(payments.length, 1);
  assert.deepEqual({ email: payments[0].email, plan: payments[0].plan, amount: payments[0].amount, currency: payments[0].currency },
    { email: ada.email, plan: 'starter', amount: 1499, currency: 'INR' });
  assert.match(payments[0].paymentId, /^pay_/);

  const accounts = (await admin(`/v1/admin/accounts?q=${encodeURIComponent('Bob Foods')}`)).body.accounts;
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].plan, 'free');
  assert.equal(accounts[0].planExpiresAt, null);
  assert.equal(accounts[0].totalPaid, 11999);
  assert.equal(accounts[0].activeKeys, 1);
  const adaRow = (await admin(`/v1/admin/accounts?q=${encodeURIComponent(ada.email)}`)).body.accounts[0];
  assert.equal(adaRow.plan, 'starter');
  assert.ok(Date.parse(adaRow.planExpiresAt) > Date.now() + 29 * 864e5);

  // A search that matches nothing, and characters with LIKE meaning, return nothing rather than everything.
  assert.deepEqual((await admin('/v1/admin/accounts?q=%25')).body.accounts, []);
});

test('keys list the owner; revoking cuts the key off; plan changes from the console have no end date', async () => {
  const cy = await signup('Cy Nutrition');
  const keys = (await admin(`/v1/admin/keys?q=${encodeURIComponent(cy.email)}`)).body.keys;
  assert.equal(keys.length, 1);
  assert.deepEqual({ id: keys[0].id, email: keys[0].email, accountName: keys[0].accountName, revokedAt: keys[0].revokedAt },
    { id: cy.key.id, email: cy.email, accountName: 'Cy Nutrition', revokedAt: null });

  const search = (k) => fetch(`${base}/v1/foods/search?q=apple`, { headers: { Authorization: `Bearer ${k}` } });
  assert.equal((await search(cy.key.key)).status, 200);
  assert.equal((await admin(`/v1/admin/keys/${cy.key.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await search(cy.key.key)).status, 401);
  assert.notEqual((await admin(`/v1/admin/keys?q=${encodeURIComponent(cy.email)}`)).body.keys[0].revokedAt, null);

  await paid(cy, 'starter', 1499);
  assert.equal((await admin(`/v1/admin/accounts/${cy.id}/plan`, { method: 'POST', body: JSON.stringify({ plan: 'enterprise' }) })).status, 200);
  const row = (await admin(`/v1/admin/accounts?q=${encodeURIComponent(cy.email)}`)).body.accounts[0];
  assert.equal(row.plan, 'enterprise');
  assert.equal(row.planExpiresAt, null);
});

test('upgrade requests show the effective plan', async () => {
  const dee = await signup('Dee Diet');
  await paid(dee, 'starter', 1499, { daysAgo: 45 });
  await sql`INSERT INTO upgrade_requests (account_id, plan, message) VALUES (${dee.id}, 'enterprise', 'big rollout')`;
  const req = (await admin('/v1/admin/upgrade-requests')).body.requests.find((r) => r.accountId === dee.id);
  assert.equal(req.currentPlan, 'free');
});
