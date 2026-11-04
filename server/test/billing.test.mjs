import { sql, seedUsage } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';

const app = await buildApp();

const KEY_ID = 'rzp_test_fakekey';
const KEY_SECRET = 'fake_key_secret';
const WEBHOOK_SECRET = 'fake_webhook_secret';
const DAY = 864e5;
let base;
let fakeRazorpay;
const calls = [];
const orders = new Map();
let nextId = 1;
let hang = false;

before(async () => {
  // A stand-in for api.razorpay.com: create and fetch orders.
  fakeRazorpay = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
    if (hang) return; // never answers
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'POST' && req.url === '/v1/orders') {
      const order = { id: `order_${nextId++}`, entity: 'order', status: 'created', amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes };
      orders.set(order.id, order);
      return send(200, order);
    }
    const m = req.url.match(/^\/v1\/orders\/(order_\w+)$/);
    if (req.method === 'GET' && m && orders.has(m[1])) return send(200, orders.get(m[1]));
    send(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'not found' } });
  });
  await new Promise((r) => fakeRazorpay.listen(0, r));
  process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${fakeRazorpay.address().port}`;
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  setProvider({ name: 'none' });
});
after(() => { app.close(); fakeRazorpay.closeAllConnections(); fakeRazorpay.close(); });

async function signup() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-Nutrikit-Portal': '1', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  const { body } = await call('POST', '/portal/api/signup', { name: 'Pay Co', email: `pay-${crypto.randomUUID()}@example.com`, password: 'correct horse battery' });
  return { call, accountId: body.account.id };
}

// What Razorpay Checkout hands the browser after a successful payment.
const paymentResponse = (orderId, { secret = KEY_SECRET, paymentId = `pay_${crypto.randomBytes(6).toString('hex')}` } = {}) => ({
  razorpay_payment_id: paymentId,
  razorpay_order_id: orderId,
  razorpay_signature: crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'),
});

/** Buys `plan` for the user: create the order, then confirm the payment as the browser would. */
async function pay(user, plan) {
  const order = await user.call('POST', '/portal/api/billing/order', { plan });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const response = paymentResponse(order.body.orderId);
  const verified = await user.call('POST', '/portal/api/billing/verify', response);
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return { ...verified.body, response, orderId: order.body.orderId };
}

const daysLeft = (iso) => (Date.parse(iso) - Date.now()) / DAY;

function webhook(event, { secret = WEBHOOK_SECRET } = {}) {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'X-Razorpay-Signature': sig, 'Content-Type': 'application/json' }, body: raw });
}
const orderPaid = (orderId, paymentId) => ({
  event: 'order.paid',
  payload: { order: { entity: orders.get(orderId) }, payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } },
});

test('the account view reports Razorpay billing (public key only) and INR prices', async () => {
  const { call } = await signup();
  const me = (await call('GET', '/portal/api/me')).body;
  assert.deepEqual(me.billing, { enabled: true, mode: 'test', currency: 'INR', keyId: KEY_ID });
  assert.ok(!JSON.stringify(me).includes(KEY_SECRET), 'the key secret is never sent');
  assert.deepEqual([me.plans.free.price, me.plans.starter.price, me.plans.growth.price, me.plans.enterprise.price], [0, 1499, 11999, null]);
  assert.equal(me.plans.starter.currency, 'INR');
  assert.equal(me.plan.expiresAt, null);
});

test('starting a payment creates an INR order tagged with the account and plan', async () => {
  const { call, accountId } = await signup();
  const r = await call('POST', '/portal/api/billing/order', { plan: 'growth' });
  assert.equal(r.status, 201);
  assert.match(r.body.orderId, /^order_/);
  assert.deepEqual({ ...r.body, orderId: undefined }, { orderId: undefined, keyId: KEY_ID, plan: 'growth', amount: 1199900, currency: 'INR' });
  const sent = calls.at(-1);
  assert.equal(sent.path, '/v1/orders');
  assert.equal(sent.auth, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
  assert.deepEqual({ ...sent.body, receipt: undefined }, { amount: 1199900, currency: 'INR', receipt: undefined, notes: { account_id: accountId, plan: 'growth' } });
  assert.ok(sent.body.receipt.length <= 40);
  // Creating an order changes nothing until it is paid.
  assert.equal((await call('GET', '/portal/api/me')).body.plan.id, 'free');
});

test('plans that cannot be bought online are refused', async () => {
  const { call } = await signup();
  assert.equal((await call('POST', '/portal/api/billing/order', { plan: 'enterprise' })).body.error.code, 'contact_sales');
  assert.equal((await call('POST', '/portal/api/billing/order', { plan: 'free' })).status, 400);
  assert.equal((await call('POST', '/portal/api/billing/order', { plan: 'toString' })).status, 400);
});

test('a verified payment unlocks the plan for 30 days; paying again extends it; a replay does not', async () => {
  const user = await signup();
  const first = await pay(user, 'starter');
  assert.equal(first.plan.id, 'starter');
  assert.ok(Math.abs(daysLeft(first.plan.expiresAt) - 30) < 0.01, 'about 30 days');

  const replay = await user.call('POST', '/portal/api/billing/verify', first.response);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.plan.expiresAt, first.plan.expiresAt, 'the same payment is not applied twice');

  const second = await pay(user, 'starter');
  assert.ok(Math.abs(daysLeft(second.plan.expiresAt) - 60) < 0.01, 'extended to about 60 days');
  const [{ n }] = await sql`SELECT COUNT(*) AS n FROM payments WHERE account_id = ${user.accountId}`;
  assert.equal(n, 2);
});

test('moving up starts a fresh period; moving down waits for the period to end', async () => {
  const user = await signup();
  await pay(user, 'starter');
  const growth = await pay(user, 'growth');
  assert.equal(growth.plan.id, 'growth');
  assert.ok(Math.abs(daysLeft(growth.plan.expiresAt) - 30) < 0.01);
  const down = await user.call('POST', '/portal/api/billing/order', { plan: 'starter' });
  assert.equal(down.status, 409);
  assert.equal(down.body.error.code, 'plan_active');
});

test('an ended period reads as Free everywhere, and the plan can be bought again', async () => {
  const user = await signup();
  const { body: signupKey } = await user.call('POST', '/portal/api/keys', { name: 'k2' });
  await pay(user, 'growth');
  await sql`UPDATE accounts SET plan_expires_at = now() - interval '1 day' WHERE id = ${user.accountId}`;
  const me = (await user.call('GET', '/portal/api/me')).body;
  assert.equal(me.plan.id, 'free');
  assert.equal(me.plan.expiresAt, null);
  // API keys get Free limits too: the Free allowance (2,000 tokens) is enforced again.
  await seedUsage({ keyId: signupKey.id, accountId: user.accountId, tokens: 2000 });
  const res = await fetch(`${base}/v1/foods/search?q=egg`, { headers: { Authorization: `Bearer ${signupKey.key}` } });
  assert.equal(res.status, 429);
  // Buying after expiry starts a new 30 days (not counted from the old end date).
  const again = await pay(user, 'starter');
  assert.ok(Math.abs(daysLeft(again.plan.expiresAt) - 30) < 0.01);
});

test('operator plan changes have no end date', async () => {
  const user = await signup();
  await pay(user, 'starter');
  const admin = { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' };
  await fetch(`${base}/v1/admin/accounts/${user.accountId}/plan`, { method: 'POST', headers: admin, body: JSON.stringify({ plan: 'enterprise' }) });
  const me = (await user.call('GET', '/portal/api/me')).body;
  assert.equal(me.plan.id, 'enterprise');
  assert.equal(me.plan.expiresAt, null);
});

test('forged or foreign payment responses change nothing', async () => {
  const owner = await signup();
  const { body } = await owner.call('POST', '/portal/api/billing/order', { plan: 'growth' });
  const forged = await owner.call('POST', '/portal/api/billing/verify', paymentResponse(body.orderId, { secret: 'wrong_secret' }));
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error.code, 'invalid_payment');
  assert.equal((await owner.call('POST', '/portal/api/billing/verify', {})).status, 400);

  // A genuine response for someone else's order.
  const other = await signup();
  const foreign = await other.call('POST', '/portal/api/billing/verify', paymentResponse(body.orderId));
  assert.equal(foreign.status, 400);
  assert.equal((await other.call('GET', '/portal/api/me')).body.plan.id, 'free');
  assert.equal((await owner.call('GET', '/portal/api/me')).body.plan.id, 'free');
});

test('the order.paid webhook applies a payment the browser never confirmed, once', async () => {
  const user = await signup();
  const { body } = await user.call('POST', '/portal/api/billing/order', { plan: 'starter' });
  const event = orderPaid(body.orderId, 'pay_webhook_only');
  const r = await webhook(event);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).applied, 'payment');
  const me = (await user.call('GET', '/portal/api/me')).body;
  assert.equal(me.plan.id, 'starter');
  assert.equal((await (await webhook(event)).json()).applied, null, 'a second delivery is ignored');
  assert.equal((await user.call('GET', '/portal/api/me')).body.plan.expiresAt, me.plan.expiresAt);

  // The browser confirmation arriving after the webhook does not extend the period again.
  await user.call('POST', '/portal/api/billing/verify', paymentResponse(body.orderId, { paymentId: 'pay_webhook_only' }));
  assert.equal((await user.call('GET', '/portal/api/me')).body.plan.expiresAt, me.plan.expiresAt);
  assert.equal((await webhook({ event: 'payment.failed', payload: {} })).status, 200);
});

test('webhooks with a bad or missing signature are rejected', async () => {
  const user = await signup();
  const { body } = await user.call('POST', '/portal/api/billing/order', { plan: 'growth' });
  const event = orderPaid(body.orderId, 'pay_forged');
  assert.equal((await webhook(event, { secret: 'wrong' })).status, 400);
  assert.equal((await fetch(`${base}/webhooks/razorpay`, { method: 'POST', body: JSON.stringify(event) })).status, 400);
  assert.equal((await user.call('GET', '/portal/api/me')).body.plan.id, 'free');
});

test('without Razorpay credentials billing is off and upgrade requests remain', async () => {
  const saved = { id: process.env.RAZORPAY_KEY_ID, hook: process.env.RAZORPAY_WEBHOOK_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    const { call } = await signup();
    assert.deepEqual((await call('GET', '/portal/api/me')).body.billing, { enabled: false, mode: null, currency: 'INR', keyId: null });
    assert.equal((await call('POST', '/portal/api/billing/order', { plan: 'starter' })).body.error.code, 'billing_disabled');
    assert.equal((await webhook({ event: 'order.paid' })).status, 501);
    assert.equal((await call('POST', '/portal/api/upgrade', { plan: 'starter', message: 'please' })).status, 201);
  } finally {
    process.env.RAZORPAY_KEY_ID = saved.id;
    process.env.RAZORPAY_WEBHOOK_SECRET = saved.hook;
  }
});

test('a Razorpay that never answers ends in 502 billing_error, not a hung request', async () => {
  const { call } = await signup();
  process.env.RAZORPAY_TIMEOUT_MS = '300';
  hang = true;
  try {
    const started = Date.now();
    const res = await call('POST', '/portal/api/billing/order', { plan: 'starter' });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'billing_error');
    assert.ok(Date.now() - started < 2000);
  } finally {
    hang = false;
    delete process.env.RAZORPAY_TIMEOUT_MS;
  }
});

test('a payment never moves an account to a cheaper plan, even one an operator set', async () => {
  const setPlan = (user, plan) => fetch(`${base}/v1/admin/accounts/${user.accountId}/plan`, {
    method: 'POST', headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
  });
  const order = (user, plan) => user.call('POST', '/portal/api/billing/order', { plan });

  const growth = await signup();
  await setPlan(growth, 'growth');
  const down = await order(growth, 'starter');
  assert.equal(down.status, 409);
  assert.equal(down.body.error.code, 'plan_active');

  const enterprise = await signup();
  await setPlan(enterprise, 'enterprise');
  for (const plan of ['starter', 'growth']) {
    const res = await order(enterprise, plan);
    assert.equal(res.status, 409, `enterprise -> ${plan}`);
    assert.equal(res.body.error.code, 'plan_active');
  }

  const starter = await signup();
  await setPlan(starter, 'starter');
  assert.equal((await order(starter, 'starter')).status, 201, 'extending the same plan');
  assert.equal((await order(starter, 'growth')).status, 201, 'moving up');
});
