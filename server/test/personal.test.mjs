// The personal catalog (data/foods.personal.db, built locally with `npm run build:db -- --personal`). It is
// gitignored, so these tests are skipped wherever it hasn't been built (CI, other machines).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERSONAL = path.join(ROOT, 'data/foods.personal.db');
const skip = !fs.existsSync(PERSONAL) && 'personal catalog not built (npm run build:db -- --personal)';
process.env.NUTRIKIT_CATALOG = PERSONAL; // this test file runs in its own process
const load = async () => ({
  ...(await import('../src/domain/db.ts')), ...(await import('../src/domain/textlog.ts')),
});
const item = async (text) => (await load()).logText(text).items[0];

test('the personal catalog adds INDB dishes with their source recorded', { skip }, async () => {
  const { foods } = await load();
  const n = foods().prepare("SELECT count(*) n FROM foods WHERE source = 'indb'").get().n;
  assert.ok(n > 700, `${n} INDB dishes`);
  const meta = JSON.parse(foods().prepare("SELECT value FROM meta WHERE key = 'indb_source'").get().value);
  assert.match(meta.license, /personal use only/);
  assert.ok(meta.skipped.every((s) => s.reason), 'every skipped dish says why');
});

test('INDB dishes log with their own servings, and USDA still leads where it names the food', { skip }, async () => {
  const kheer = await item('1 bowl kheer');
  assert.equal(kheer.food.name, 'Rice kheer (Chawal ki kheer)');
  assert.equal(kheer.portionMethod, 'portion');
  assert.equal((await item('1 bowl dal makhani')).food.source, 'indb');
  assert.equal((await item('1 plate poha')).food.name, 'Poha');
  assert.equal((await item('2 rotis')).food.source, 'sr_legacy', 'USDA chapati, not a speciality roti');
  assert.equal((await item('1 samosa')).food.name, 'Samosa');
  assert.equal((await item('2 gulab jamun')), undefined, 'deep-fried dishes are skipped, not guessed');
});

test('the committed catalog holds no INDB data', () => {
  // Read directly, not through NUTRIKIT_CATALOG.
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const db = new DatabaseSync(path.join(ROOT, 'data/foods.db'), { readOnly: true });
    assert.equal(db.prepare("SELECT count(*) n FROM foods WHERE source = 'indb'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM meta WHERE key = 'indb_source'").get().n, 0);
  });
});
