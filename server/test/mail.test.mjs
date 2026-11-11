// Mail providers: which one the environment selects, and the HTTPS request each sends (fetch is stubbed).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fromEnv, parseSender } from '../src/domain/mail.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function captureFetch(status = 201) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response('{}', { status });
  };
  return calls;
}

const mail = { to: 'dev@example.com', subject: 'Confirm your email for Nutrikit', text: 'Open this link: https://x/verify-email?token=abc' };

test('the sender address is split into a name and an email', () => {
  assert.deepEqual(parseSender('Nutrikit <someone@gmail.com>'), { name: 'Nutrikit', email: 'someone@gmail.com' });
  assert.deepEqual(parseSender('"Nutrikit Team" <no-reply@nutrikit.ai>'), { name: 'Nutrikit Team', email: 'no-reply@nutrikit.ai' });
  assert.deepEqual(parseSender('someone@gmail.com'), { email: 'someone@gmail.com' });
});

test('Brevo, Resend or none is chosen from the environment', () => {
  const from = 'Nutrikit <someone@gmail.com>';
  assert.equal(fromEnv({ BREVO_API_KEY: 'b', NUTRIKIT_MAIL_FROM: from }).name, 'brevo');
  assert.equal(fromEnv({ RESEND_API_KEY: 'r', NUTRIKIT_MAIL_FROM: from }).name, 'resend');
  assert.equal(fromEnv({ BREVO_API_KEY: 'b', RESEND_API_KEY: 'r', NUTRIKIT_MAIL_FROM: from }).name, 'brevo', 'Brevo first when both are set');
  assert.equal(fromEnv({ BREVO_API_KEY: 'b', RESEND_API_KEY: 'r', NUTRIKIT_MAIL_FROM: from, NUTRIKIT_MAIL_PROVIDER: 'resend' }).name, 'resend');
  assert.equal(fromEnv({ BREVO_API_KEY: 'b', NODE_ENV: 'production' }).name, 'none', 'a key without a sender sends nothing');
  assert.equal(fromEnv({ NODE_ENV: 'production' }).name, 'none');
  assert.equal(fromEnv({}).name, 'console', 'development prints emails');
});

test('Brevo gets the transactional email request with the key in its api-key header', async () => {
  const calls = captureFetch();
  await fromEnv({ BREVO_API_KEY: 'xkeysib-test', NUTRIKIT_MAIL_FROM: 'Nutrikit <someone@gmail.com>' }).send(mail);
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['api-key'], 'xkeysib-test');
  assert.deepEqual(calls[0].body, {
    sender: { name: 'Nutrikit', email: 'someone@gmail.com' },
    to: [{ email: 'dev@example.com' }],
    subject: mail.subject,
    textContent: mail.text,
  });
  assert.ok(calls[0].init.signal, 'the call has a deadline');
});

test('Resend gets its email request with a bearer key', async () => {
  const calls = captureFetch(200);
  await fromEnv({ RESEND_API_KEY: 're_test', NUTRIKIT_MAIL_FROM: 'Nutrikit <no-reply@nutrikit.ai>' }).send(mail);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
  assert.deepEqual(calls[0].body, { from: 'Nutrikit <no-reply@nutrikit.ai>', to: ['dev@example.com'], subject: mail.subject, text: mail.text });
});

test('a provider error fails the send without the key or message in the error', async () => {
  captureFetch(401);
  await assert.rejects(
    fromEnv({ BREVO_API_KEY: 'xkeysib-secret', NUTRIKIT_MAIL_FROM: 'someone@gmail.com' }).send(mail),
    (err) => err.message === 'email provider answered 401' && !err.message.includes('secret') && !err.message.includes('token'),
  );
});
