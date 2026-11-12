// Shared test setup: give each test file its own throwaway Postgres database before modules use it.
// TEST_DATABASE_URL points at a server where this user may CREATE DATABASE (see .env.example).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import postgres from 'postgres';
import { createSql, closeAll, migrate } from '../src/pg.ts';
import { setMailer } from '../src/domain/mail.ts';

// A stand-in for the built React app (web/dist), so server tests don't need a web build.
const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrikit-web-'));
fs.mkdirSync(path.join(webDist, 'assets'));
fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Nutrikit</title><div id="root"></div><script type="module" src="/assets/app-3f9a1c.js"></script>');
fs.writeFileSync(path.join(webDist, 'assets/app-3f9a1c.js'), 'console.log("nutrikit")');
fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
// The page list the web build emits (web/src/seo.json is the real one).
fs.copyFileSync(new URL('../../web/src/seo.json', import.meta.url), path.join(webDist, 'seo.json'));
process.env.NUTRIKIT_WEB_DIST = webDist;

process.env.NUTRIKIT_OFFLINE = '0';
process.env.NUTRIKIT_LOG_LEVEL = 'silent';
// Test files sign up many accounts from 127.0.0.1; auth.test.mjs sets real limits where it checks them.
process.env.NUTRIKIT_SIGNUP_LIMIT = '100000';
process.env.NUTRIKIT_LOGIN_IP_LIMIT = '100000';
process.env.NUTRIKIT_EMAIL_IP_LIMIT = '100000';
delete process.env.RESEND_API_KEY;
delete process.env.BREVO_API_KEY;
delete process.env.NUTRIKIT_PUBLIC_URL; // pages and email links use the request's own host in tests

/** Every email the app sent in this test file, newest last (the test mailer records instead of sending). */
export const sentMail = [];
setMailer({ name: 'test', send: async (mail) => { sentMail.push(mail); } });
delete process.env.NUTRIKIT_TRUST_PROXY;
process.env.NUTRIKIT_ADMIN_TOKEN = 'test-admin-token';
delete process.env.NUTRIKIT_AUTH;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
// Tests make requests fail on purpose: never post those alerts to a real chat webhook from .env.
delete process.env.NUTRIKIT_ALERT_WEBHOOK_URL;

const adminUrl = process.env.TEST_DATABASE_URL || 'postgres://nutrikit:nutrikit@localhost:5433/postgres';
const dbName = `nutrikit_test_${crypto.randomBytes(6).toString('hex')}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
await admin.unsafe(`CREATE DATABASE ${dbName}`);
const url = new URL(adminUrl);
url.pathname = `/${dbName}`;
process.env.DATABASE_URL = url.toString();
await migrate(process.env.DATABASE_URL);

/** A pool on this file's test database, for tests that inspect or seed rows directly. */
export const sql = createSql();

after(async () => {
  await closeAll();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

/** Records past usage as the metering would: a `usage` row plus this month's allowance counter. */
export async function seedUsage({ keyId, accountId = null, endpoint = 'search', tokens }) {
  await sql`INSERT INTO usage (key_id, account_id, endpoint, tokens) VALUES (${keyId}, ${accountId}, ${endpoint}, ${tokens})`;
  const subject = accountId ? `acct:${accountId}` : `key:${keyId}`;
  await sql`INSERT INTO usage_periods AS p (subject, period_start, used) VALUES (${subject}, date_trunc('month', now() AT TIME ZONE 'UTC')::date, ${tokens})
    ON CONFLICT (subject, period_start) DO UPDATE SET used = p.used + EXCLUDED.used`;
}

/** A fake AI provider that records calls and returns canned results. */
export function fakeProvider() {
  const calls = [];
  return {
    calls,
    name: 'fake',
    async recognizeMeal(args) {
      calls.push(['recognizeMeal', args]);
      return {
        meal: 'lunch',
        notes: 'Grilled chicken with rice and broccoli',
        items: [
          { food: 'chicken breast, grilled', quantity: 1, unit: 'piece', grams: 150, confidence: 'high' },
          { food: 'rice, white, cooked', quantity: 1, unit: 'cup', grams: 158, confidence: 'medium' },
          { food: 'broccoli, cooked', quantity: 0.5, unit: 'cup', grams: 78, confidence: 'medium' },
        ],
        usage: { inputTokens: 1500, outputTokens: 400 },
      };
    },
    async readLabel(args) {
      calls.push(['readLabel', args]);
      return {
        isNutritionLabel: true, servingSize: '1 bar (40g)', servingGrams: 40, servingsPerContainer: 6,
        perServing: { calories: 190, protein: 10, fat: 7, carbs: 22, fiber: 3, sugar: 8, sodium: 140, cholesterol: null },
        usage: { inputTokens: 1200, outputTokens: 300 },
      };
    },
    async parseMeal(args) {
      calls.push(['parseMeal', args]);
      return {
        meal: 'breakfast', notes: '',
        items: [{ food: 'oatmeal', quantity: 1, unit: 'cup', grams: 234, confidence: 'high' }],
        usage: { inputTokens: 300, outputTokens: 100 },
      };
    },
    async advise(args) {
      calls.push(['advise', args]);
      const declined = /medication|insulin/i.test(args.question);
      return {
        answer: declined ? 'I can’t advise on medication. Please ask your doctor.' : '- **Greek yogurt**: about 10 g protein per 100 g',
        declined,
        usage: { inputTokens: 800, outputTokens: 250 },
      };
    },
  };
}
