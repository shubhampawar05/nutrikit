// Portal signup and login: async hashing, legacy hashes, and per-address throttles (portal-auth spec).
import { sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { createAccount, login } from '../src/domain/accounts.ts';

const app = await buildApp({ trustProxy: 1 }); // tests choose the client address with X-Forwarded-For
let base;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

let n = 0;
const email = (tag) => `${tag}-${Date.now()}-${n++}@example.com`;
const post = (path, body, ip) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1', 'X-Forwarded-For': ip },
  body: JSON.stringify(body),
});
const signup = (ip, fields = {}) => post('/portal/api/signup', { name: 'Throttle Test', email: email('signup'), password: 'long enough password', ...fields }, ip);

async function withLimits(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { await fn(); } finally { Object.assign(process.env, saved); }
}

test('an account stored with the old synchronous hashing still logs in', async () => {
  // Made by the previous scryptSync code with the same parameters.
  const legacy = 'scrypt$00112233445566778899aabbccddeeff$61a946d8b9d3110e54ba43e782c376bc9faeaee3ce4f39b6edb5f660add04ae4';
  const address = email('legacy');
  await sql`INSERT INTO accounts (id, email, name, password_hash) VALUES (${`acct_${Date.now().toString(16)}`}, ${address}, 'Legacy', ${legacy})`;
  assert.equal((await login(sql, { email: address, password: 'legacy password 123' })).email, address);
  await assert.rejects(login(sql, { email: address, password: 'wrong password' }), { code: 'invalid_credentials' });
});

test('unknown email and wrong password look the same', async () => {
  const address = email('known');
  await createAccount(sql, { name: 'Known', email: address, password: 'correct horse battery' });
  const unknown = await post('/portal/api/login', { email: email('nobody'), password: 'whatever password' }, '198.51.100.40');
  const wrong = await post('/portal/api/login', { email: address, password: 'not the password' }, '198.51.100.41');
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await unknown.json(), await wrong.json());
});

test('password hashing does not block other requests', async () => {
  const address = email('busy');
  await createAccount(sql, { name: 'Busy', email: address, password: 'correct horse battery' });
  const started = Date.now();
  const logins = Array.from({ length: 20 }, () => login(sql, { email: address, password: 'correct horse battery' }));
  const health = (async () => { await new Promise((r) => setTimeout(r, 5)); const t = Date.now(); await fetch(`${base}/v1/health`); return Date.now() - t; })();
  const [healthMs] = await Promise.all([health, ...logins]);
  const loginsMs = Date.now() - started;
  assert.ok(healthMs < loginsMs / 2, `health answered in ${healthMs} ms while 20 logins took ${loginsMs} ms`);
});

test('signups are throttled per client address, invalid attempts included', async () => {
  await withLimits({ NUTRIKIT_SIGNUP_LIMIT: '5' }, async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < 4; i++) assert.equal((await signup(ip)).status, 201);
    assert.equal((await signup(ip, { password: 'short' })).status, 400, 'an invalid attempt counts');
    const before = (await sql`SELECT COUNT(*) AS n FROM accounts`)[0].n;
    const sixth = await signup(ip);
    assert.equal(sixth.status, 429);
    assert.equal((await sixth.json()).error.code, 'too_many_signups');
    const retry = Number(sixth.headers.get('retry-after'));
    assert.ok(retry >= 1 && retry <= 3600, `Retry-After ${retry}`);
    assert.equal((await sql`SELECT COUNT(*) AS n FROM accounts`)[0].n, before, 'nothing was created');

    for (let i = 0; i < 5; i++) assert.equal((await signup('203.0.113.51')).status, 201, 'another address has its own limit');

    await sql`UPDATE signup_attempts SET at = at - interval '61 minutes' WHERE ip = '203.0.113.50'`;
    assert.equal((await signup(ip)).status, 201, 'the hour passed');
  });
});

test('failed logins are throttled per client address across emails', async () => {
  await withLimits({ NUTRIKIT_LOGIN_IP_LIMIT: '20' }, async () => {
    const ip = '203.0.113.60';
    for (let i = 0; i < 20; i++) assert.equal((await post('/portal/api/login', { email: email('stuff'), password: 'guess guess' }, ip)).status, 401);
    const address = email('victim');
    await createAccount(sql, { name: 'Victim', email: address, password: 'correct horse battery' });
    const blocked = await post('/portal/api/login', { email: address, password: 'correct horse battery' }, ip);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'too_many_attempts');
    assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal((await post('/portal/api/login', { email: address, password: 'correct horse battery' }, '203.0.113.61')).status, 200, 'the owner, from elsewhere, is unaffected');
  });
});

test('the per-email limit still applies from many addresses', async () => {
  const address = email('target');
  await createAccount(sql, { name: 'Target', email: address, password: 'correct horse battery' });
  for (let i = 0; i < 5; i++) assert.equal((await post('/portal/api/login', { email: address, password: 'wrong wrong' }, `192.0.2.${i + 1}`)).status, 401);
  const res = await post('/portal/api/login', { email: address, password: 'correct horse battery' }, '192.0.2.99');
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '900');
});
