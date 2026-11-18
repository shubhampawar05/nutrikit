import './helpers.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';

const apps = [];
after(() => Promise.all(apps.map((a) => a.close())));

async function start() {
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  apps.push(app);
  return `http://127.0.0.1:${app.server.address().port}`;
}

const page = (base, path) => fetch(base + path, { headers: { Accept: 'text/html' } });

test('every response carries nosniff and Referrer-Policy; no HSTS without secure cookies', async () => {
  delete process.env.NUTRIKIT_SECURE_COOKIES;
  const base = await start();
  const responses = [
    await fetch(`${base}/v1/health`),
    await fetch(`${base}/portal/api/me`), // 401
    await fetch(`${base}/v1/nope`), // 404
    await page(base, '/'),
  ];
  for (const res of responses) {
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', res.url);
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', res.url);
    assert.equal(res.headers.get('strict-transport-security'), null, res.url);
  }
});

test('HSTS on every response when secure cookies are on', async () => {
  process.env.NUTRIKIT_SECURE_COOKIES = '1';
  try {
    const base = await start();
    for (const res of [await fetch(`${base}/v1/health`), await fetch(`${base}/portal/api/me`), await fetch(`${base}/v1/nope`), await page(base, '/')]) {
      const hsts = res.headers.get('strict-transport-security');
      assert.match(hsts, /max-age=(\d+)/, res.url);
      assert.ok(Number(hsts.match(/max-age=(\d+)/)[1]) >= 180 * 86400);
    }
  } finally {
    delete process.env.NUTRIKIT_SECURE_COOKIES;
  }
});

test('website pages get a strict Content Security Policy; API responses do not need one', async () => {
  const base = await start();
  for (const path of ['/', '/dashboard', '/index.html']) {
    const res = await page(base, path);
    assert.equal(res.status, 200, path);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, `${path} has a CSP`);
    const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(directives['script-src'], ["'self'", 'https://checkout.razorpay.com'], 'no inline or unlisted scripts');
    assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
    assert.ok(directives['frame-src'].includes('https://api.razorpay.com'), 'Razorpay Checkout can open');
    assert.ok(directives['img-src'].includes('https://images.openfoodfacts.org'));
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  }
  assert.equal((await fetch(`${base}/v1/health`)).headers.get('content-security-policy'), null);
});

test('server failures never expose a library error code (Postgres, Node); the API\'s own codes still show', async () => {
  const app = await buildApp();
  apps.push(app);
  const thrower = (err) => async () => { throw err; };
  app.get('/v1/test-pg', { schema: { hide: true } }, thrower(Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), { code: '23505' })));
  app.get('/v1/test-net', { schema: { hide: true } }, thrower(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' })));
  app.get('/v1/test-domain', { schema: { hide: true } }, thrower(Object.assign(new Error('the payment provider did not respond'), { status: 502, code: 'billing_error' })));
  await app.ready();
  for (const url of ['/v1/test-pg', '/v1/test-net']) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 500, url);
    assert.deepEqual(res.json(), { error: { code: 'internal_error', message: 'internal server error' } }, url);
  }
  const domain = await app.inject({ url: '/v1/test-domain' });
  assert.equal(domain.statusCode, 502);
  assert.equal(domain.json().error.code, 'billing_error');
});
