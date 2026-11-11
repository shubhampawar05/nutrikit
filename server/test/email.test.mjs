// Email verification and password reset (portal-auth spec).
import { sql, sentMail } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setMailer } from '../src/domain/mail.ts';

const app = await buildApp();
let base;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

function browser() {
  let cookie = '';
  return {
    async call(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-Nutrikit-Portal': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
    },
  };
}

let counter = 0;
const email = () => `mail${++counter}-${Date.now()}@example.com`;
const PASSWORD = 'correct horse battery';
const lastMailTo = (to) => sentMail.filter((m) => m.to === to).at(-1);
const tokenIn = (mail, page) => new URL(mail.text.match(new RegExp(`https?://\\S+/${page}\\?token=\\S+`))[0]).searchParams.get('token');

async function signUp(addr = email()) {
  const b = browser();
  const res = await b.call('POST', '/portal/api/signup', { name: 'Mail Co', email: addr, password: PASSWORD });
  assert.equal(res.status, 201);
  return { b, addr, res };
}

test('signup emails a verification link; the link verifies the address once, and again is harmless', async () => {
  const { b, addr, res } = await signUp();
  assert.equal(res.body.account.emailVerified, false);
  const mail = lastMailTo(addr);
  assert.match(mail.subject, /confirm your email/i);
  const token = tokenIn(mail, 'verify-email');
  assert.ok(token.length >= 40);

  const [stored] = await sql`SELECT id_hash FROM email_tokens WHERE purpose = 'verify' AND email = ${addr}`;
  assert.notEqual(stored.id_hash, token, 'only a hash of the token is stored');

  const ok = await browser().call('POST', '/portal/api/email/verify', { token });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { verified: true, email: addr });
  assert.equal((await b.call('GET', '/portal/api/me')).body.account.emailVerified, true);
  assert.equal((await browser().call('POST', '/portal/api/email/verify', { token })).status, 200, 'a second click still says verified');
});

test('a bad or expired verification link is refused', async () => {
  assert.equal((await browser().call('POST', '/portal/api/email/verify', { token: 'nope' })).body.error.code, 'invalid_token');
  const { addr } = await signUp();
  const token = tokenIn(lastMailTo(addr), 'verify-email');
  await sql`UPDATE email_tokens SET expires_at = now() - interval '1 minute' WHERE email = ${addr}`;
  const res = await browser().call('POST', '/portal/api/email/verify', { token });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_token');
});

test('the dashboard can send a new link, which replaces the old one, and is throttled', async () => {
  const { b, addr } = await signUp();
  const first = tokenIn(lastMailTo(addr), 'verify-email');
  assert.deepEqual((await b.call('POST', '/portal/api/email/verification')).body, { sent: true });
  const second = tokenIn(lastMailTo(addr), 'verify-email');
  assert.notEqual(first, second);
  assert.equal((await browser().call('POST', '/portal/api/email/verify', { token: first })).status, 400, 'the older link stops working');
  await b.call('POST', '/portal/api/email/verification'); // the third send this hour, the last one allowed
  const third = tokenIn(lastMailTo(addr), 'verify-email');
  const limited = await b.call('POST', '/portal/api/email/verification');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'too_many_emails');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await browser().call('POST', '/portal/api/email/verify', { token: second })).status, 400, 'replaced by the third');
  assert.equal((await browser().call('POST', '/portal/api/email/verify', { token: third })).status, 200);
  assert.deepEqual((await b.call('POST', '/portal/api/email/verification')).body, { verified: true });
  assert.equal((await browser().call('POST', '/portal/api/email/verification')).status, 401, 'needs a session');
});

test('forgot password answers the same for unknown and known addresses, and only mails real accounts', async () => {
  const before = sentMail.length;
  const unknown = await browser().call('POST', '/portal/api/password/forgot', { email: `nobody-${Date.now()}@example.com` });
  assert.deepEqual([unknown.status, unknown.body], [200, { ok: true }]);
  assert.equal(sentMail.length, before, 'no email for an unknown address');

  const { addr } = await signUp();
  const known = await browser().call('POST', '/portal/api/password/forgot', { email: addr.toUpperCase() });
  assert.deepEqual([known.status, known.body], [200, { ok: true }]);
  assert.match(lastMailTo(addr).subject, /reset your nutrikit password/i);

  const invalid = await browser().call('POST', '/portal/api/password/forgot', { email: 'not-an-email' });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.error.fields.email);
});

test('a reset link sets a new password, ends other sessions, verifies the address and signs in; it works once', async () => {
  const { b: oldSession, addr } = await signUp();
  await browser().call('POST', '/portal/api/password/forgot', { email: addr });
  const token = tokenIn(lastMailTo(addr), 'reset-password');

  const weak = await browser().call('POST', '/portal/api/password/reset', { token, password: 'short' });
  assert.equal(weak.status, 400);
  assert.ok(weak.body.error.fields.password);

  const fresh = browser();
  const ok = await fresh.call('POST', '/portal/api/password/reset', { token, password: 'a brand new passphrase' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /nk_session=.+; Path=\/; HttpOnly/);
  assert.equal(ok.body.account.emailVerified, true, 'the link reached the inbox, so the address is verified');
  assert.equal((await fresh.call('GET', '/portal/api/me')).status, 200, 'signed in');
  assert.equal((await oldSession.call('GET', '/portal/api/me')).status, 401, 'every earlier session ended');

  assert.equal((await browser().call('POST', '/portal/api/login', { email: addr, password: PASSWORD })).status, 401, 'old password no longer works');
  assert.equal((await browser().call('POST', '/portal/api/login', { email: addr, password: 'a brand new passphrase' })).status, 200);
  const reused = await browser().call('POST', '/portal/api/password/reset', { token, password: 'another passphrase here' });
  assert.equal(reused.body.error.code, 'invalid_token', 'a reset link works once');
});

test('an expired reset link is refused, and a newer link replaces an older one', async () => {
  const { addr } = await signUp();
  await browser().call('POST', '/portal/api/password/forgot', { email: addr });
  const older = tokenIn(lastMailTo(addr), 'reset-password');
  await browser().call('POST', '/portal/api/password/forgot', { email: addr });
  const newer = tokenIn(lastMailTo(addr), 'reset-password');
  assert.equal((await browser().call('POST', '/portal/api/password/reset', { token: older, password: 'a brand new passphrase' })).status, 400);
  await sql`UPDATE email_tokens SET expires_at = now() - interval '1 second' WHERE email = ${addr} AND purpose = 'reset'`;
  assert.equal((await browser().call('POST', '/portal/api/password/reset', { token: newer, password: 'a brand new passphrase' })).status, 400);
});

test('reset emails per address are capped silently, and per network with a 429', async () => {
  const { addr } = await signUp();
  for (let i = 0; i < 3; i++) await browser().call('POST', '/portal/api/password/forgot', { email: addr });
  const count = sentMail.filter((m) => m.to === addr && /reset/i.test(m.subject)).length;
  const fourth = await browser().call('POST', '/portal/api/password/forgot', { email: addr });
  assert.deepEqual(fourth.body, { ok: true }, 'the answer does not change');
  assert.equal(sentMail.filter((m) => m.to === addr && /reset/i.test(m.subject)).length, count, 'but nothing more is sent');

  process.env.NUTRIKIT_EMAIL_IP_LIMIT = '1';
  try {
    const limited = await browser().call('POST', '/portal/api/password/forgot', { email: email() });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'too_many_emails');
  } finally {
    process.env.NUTRIKIT_EMAIL_IP_LIMIT = '100000';
  }
});

test('a mail outage never fails a signup, and the dashboard says it could not send', async () => {
  setMailer({ name: 'down', send: async () => { throw new Error('provider down'); } });
  try {
    const { b, res } = await signUp();
    assert.equal(res.body.account.emailVerified, false);
    const resend = await b.call('POST', '/portal/api/email/verification');
    assert.equal(resend.status, 503);
    assert.equal(resend.body.error.code, 'email_unavailable');
    assert.deepEqual((await browser().call('POST', '/portal/api/password/forgot', { email: email() })).body, { ok: true });
  } finally {
    setMailer({ name: 'test', send: async (mail) => { sentMail.push(mail); } });
  }
});
