import { sql } from './helpers.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../src/app.ts';
import { createKey } from '../src/domain/auth.ts';

const apps = [];
after(() => Promise.all(apps.map((a) => a.close())));

/** Builds and starts an app; `lines` collects its JSON log output. */
async function start(opts = {}, extra = () => {}) {
  const lines = [];
  const logStream = new Writable({ write(chunk, _enc, done) { lines.push(...String(chunk).trim().split('\n')); done(); } });
  const app = await buildApp({ logStream, logLevel: 'info', ...opts });
  extra(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  apps.push(app);
  return { app, lines, base: `http://127.0.0.1:${app.server.address().port}` };
}

const demo = (base, ip) => fetch(`${base}/portal/api/demo`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
  body: JSON.stringify({ text: 'an apple' }),
});

test('one trusted proxy hop: per-address limits use X-Forwarded-For', async () => {
  const { base } = await start({ trustProxy: 1 });
  for (let i = 0; i < 20; i++) assert.equal((await demo(base, '203.0.113.7')).status, 200);
  assert.equal((await demo(base, '203.0.113.7')).status, 429);
  assert.equal((await demo(base, '203.0.113.8')).status, 200, 'another client address has its own limit');
});

test('trusted proxy addresses (CIDR list) work like a hop count', async () => {
  const { base } = await start({ trustProxy: '127.0.0.0/8, ::1' });
  for (let i = 0; i < 20; i++) assert.equal((await demo(base, '192.0.2.10')).status, 200);
  assert.equal((await demo(base, '192.0.2.10')).status, 429);
  assert.equal((await demo(base, '192.0.2.11')).status, 200);
});

test('no trusted proxy: a forged X-Forwarded-For is ignored', async () => {
  const { base } = await start({ trustProxy: 0 });
  for (let i = 0; i < 20; i++) assert.equal((await demo(base, `198.51.100.${i}`)).status, 200);
  assert.equal((await demo(base, '198.51.100.99')).status, 429, 'all requests count against the socket address');
});

test('X-Request-Id: generated, reused when well-formed, replaced when not, present on errors', async () => {
  const { base } = await start();
  const generated = (await fetch(`${base}/v1/health`)).headers.get('x-request-id');
  assert.match(generated, /^[0-9a-f-]{36}$/);
  assert.notEqual((await fetch(`${base}/v1/health`)).headers.get('x-request-id'), generated);

  const supplied = await fetch(`${base}/v1/health`, { headers: { 'X-Request-Id': 'checkout-42' } });
  assert.equal(supplied.headers.get('x-request-id'), 'checkout-42');

  const malformed = await fetch(`${base}/v1/health`, { headers: { 'X-Request-Id': 'bad id <script>' } });
  assert.match(malformed.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);

  const unauthorized = await fetch(`${base}/v1/foods/search?q=apple`, { headers: { 'X-Request-Id': 'err-1' } });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('x-request-id'), 'err-1');
  const missing = await fetch(`${base}/v1/nope`, { headers: { 'X-Request-Id': 'err-2' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-request-id'), 'err-2');
});

test('request logs: one JSON line per request with ids, never credentials or bodies', async () => {
  const { base, lines } = await start();
  const { key, id: keyId } = await createKey(sql, { name: 'log test' });
  const search = await fetch(`${base}/v1/foods/search?q=apple`, { headers: { Authorization: `Bearer ${key}`, 'X-Request-Id': 'log-search' } });
  assert.equal(search.status, 200);

  const password = 'a very secret password 123';
  const signup = await fetch(`${base}/portal/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' },
    body: JSON.stringify({ name: 'Logger', email: `log-${Date.now()}@example.com`, password }),
  });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const firstKey = (await signup.json()).firstKey.key;
  assert.equal((await fetch(`${base}/portal/api/me`, { headers: { Cookie: cookie } })).status, 200);
  await new Promise((r) => setTimeout(r, 50));

  const entries = lines.map((l) => JSON.parse(l));
  const line = entries.find((e) => e.requestId === 'log-search' && e.msg === 'request');
  assert.ok(line, 'the search was logged');
  assert.equal(line.method, 'GET');
  assert.equal(line.route, '/v1/foods/search');
  assert.equal(line.status, 200);
  assert.equal(typeof line.durationMs, 'number');
  assert.equal(line.keyId, keyId);
  assert.ok(entries.some((e) => e.msg === 'request' && e.route === '/portal/api/me' && e.accountId), 'portal calls log the account');

  const all = lines.join('\n');
  for (const secret of [key, firstKey, cookie.split('=')[1], password]) assert.ok(!all.includes(secret), 'no secret in the logs');
});

test('an unexpected error answers 500 without details and is logged with its stack', async () => {
  const { base, lines } = await start({}, (app) => {
    app.get('/v1/boom', { schema: { hide: true } }, async () => { throw new Error('internal detail'); });
  });
  const res = await fetch(`${base}/v1/boom`, { headers: { 'X-Request-Id': 'boom-1' } });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: { code: 'internal_error', message: 'internal server error' } });
  await new Promise((r) => setTimeout(r, 50));
  const logged = lines.map((l) => JSON.parse(l)).find((e) => e.requestId === 'boom-1' && e.level === 50);
  assert.ok(logged, 'logged at error level under the request id');
  assert.match(logged.err.stack, /internal detail/);
});

test('readiness checks the database and catalog; liveness never touches the database', async () => {
  const { base } = await start();
  const ready = await fetch(`${base}/v1/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', checks: { database: 'ok', catalog: 'ok' } });

  // A server whose database is unreachable (nothing listens on port 1).
  const down = await start({ databaseUrl: 'postgres://nutrikit:nutrikit@127.0.0.1:1/nutrikit' });
  const notReady = await fetch(`${down.base}/v1/health/ready`);
  assert.equal(notReady.status, 503);
  assert.deepEqual(await notReady.json(), { status: 'not_ready', checks: { database: 'fail', catalog: 'ok' } });
  assert.equal((await fetch(`${down.base}/v1/health`)).status, 200);
});
