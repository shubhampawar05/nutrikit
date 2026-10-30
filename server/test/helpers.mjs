// Shared test setup: give each test file its own throwaway Postgres database before modules use it.
// TEST_DATABASE_URL points at a server where this user may CREATE DATABASE (see .env.example).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import postgres from 'postgres';
import { createSql, closeAll, migrate } from '../src/pg.ts';

// A stand-in for the built React app (web/dist), so server tests don't need a web build.
const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrikit-web-'));
fs.mkdirSync(path.join(webDist, 'assets'));
fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Nutrikit</title><div id="root"></div><script type="module" src="/assets/app-3f9a1c.js"></script>');
fs.writeFileSync(path.join(webDist, 'assets/app-3f9a1c.js'), 'console.log("nutrikit")');
fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
process.env.NUTRIKIT_WEB_DIST = webDist;

process.env.NUTRIKIT_OFFLINE = '0';
process.env.NUTRIKIT_ADMIN_TOKEN = 'test-admin-token';
delete process.env.NUTRIKIT_AUTH;
delete process.env.ANTHROPIC_API_KEY;

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
  };
}
