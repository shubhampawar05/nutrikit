// AI serving counts (M3.0): an estimate's serving is "2 idlis, 80 g", so one idli is 40 g. Before servings carried a
// count, the whole serving was taken as one piece ("1 idli" = 80 g, "1 pakora" = 75 g). Stored estimates without a
// count have it read from the label only when unambiguous; anything else is flagged, never assumed to be 1.
// Providers are mocked throughout: no AI call is made.
import { sql, fakeProvider } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { estimateItem, estimateProblem, phraseParts, requestEstimates, servingCount } from '../src/domain/foodrequests.ts';
import { FOOD_ESTIMATES_SCHEMA } from '../src/domain/providers/prompts.ts';

// Through the API: rules logging uses an approved estimate for every caller, with no AI grams to override it.
const app = await buildApp();
let base;
let live;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  setProvider(fakeProvider());
  const res = await fetch(`${base}/portal/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' },
    body: JSON.stringify({ name: 'Serving Co', email: 'servings@example.test', password: 'correct horse battery' }),
  });
  live = (await res.json()).firstKey.key;
});
after(() => app.close());

const PER100 = { calories: 150, protein: 5, fat: 5, carbs: 21, fiber: 1, sugar: 1, saturatedFat: 1, sodium: 100 };
const estimate = (serving, name = 'Test dish') => ({ name, per100g: PER100, serving, confidence: 'medium', provider: 'fake', model: 'fake-1', at: '2026-11-19T00:00:00.000Z', sameAs: null });
const logged = (phrase, serving) => {
  const p = phraseParts(phrase);
  return estimateItem(phrase, estimate(serving), { quantity: p.quantity, unit: p.unit });
};

test('servingCount: an explicit quantity wins; old labels are read only when unambiguous', () => {
  assert.deepEqual(servingCount({ label: '1 bowl', quantity: 2 }), { count: 2, unclear: null });
  for (const [label, n] of [['2 pieces', 2], ['2 idlis', 2], ['three rotis', 3], ['1 bowl', 1], ['a glass', 1], ['100 g', 1], ['1 cup (240 ml)', 1], ['2 puris (60 g)', 2]]) {
    assert.deepEqual(servingCount({ label }), { count: n, unclear: null }, label);
  }
  for (const label of ['2-3 pieces', '2 to 3 vadas', 'a few pieces', 'about 2 idlis', '1 plate (2 pieces)', 'bowl', 'half plate', '']) {
    const c = servingCount({ label });
    assert.equal(c.count, null, `${label}: never assumed to be 1`);
    assert.ok(c.unclear, `${label}: says why`);
  }
  assert.equal(servingCount({ label: '1 bowl', quantity: 0 }).count, null);
});

test('idli: a "2 idlis, 80 g" serving makes one idli 40 g, with or without a stored quantity', () => {
  for (const serving of [{ label: '2 idlis', unit: 'piece', quantity: 2, grams: 80 }, { label: '2 pieces', unit: 'piece', grams: 80 }]) {
    assert.equal(logged('1 idli', serving).grams, 40);
    assert.equal(logged('3 idli', serving).grams, 120);
    assert.equal(logged('2 pieces idli', serving).grams, 80);
  }
  const item = logged('1 idli', { label: '2 idlis', unit: 'piece', quantity: 2, grams: 80 });
  assert.equal(item.food.source, 'ai-estimate', 'still an AI estimate, never catalog data');
  assert.equal(item.confidence, 'low');
  assert.match(item.portionMethod, /^ai-estimate-/);
  assert.equal(item.nutrients.calories.amount, 60, 'nutrients follow the corrected grams');
});

test('pakora, roti, puri: per-piece weights from multi-piece servings', () => {
  assert.equal(logged('1 pakora', { label: '3 pieces', unit: 'piece', quantity: 3, grams: 75 }).grams, 25);
  assert.equal(logged('6 pakora', { label: '3 pieces', unit: 'piece', grams: 75 }).grams, 150);
  assert.equal(logged('3 roti', { label: '2 rotis', unit: 'piece', grams: 80 }).grams, 120);
  assert.equal(logged('1 roti', { label: '2 rotis', unit: 'roti', quantity: 2, grams: 80 }).grams, 40);
  assert.equal(logged('4 puri', { label: '4 puris', unit: 'piece', quantity: 4, grams: 100 }).grams, 100);
});

test('single-unit servings behave exactly as before', () => {
  assert.equal(logged('1 samosa', { label: '1 piece', unit: 'piece', quantity: 1, grams: 100 }).grams, 100);
  assert.equal(logged('2 samosa', { label: '1 piece', unit: 'piece', grams: 100 }).grams, 200);
  const dal = { label: '1 bowl', unit: 'bowl', grams: 250 };
  assert.equal(logged('1 bowl dal', dal).grams, 250);
  assert.equal(logged('dal', dal).grams, 250);
  assert.equal(logged('100 g dal', dal).grams, 100, 'a mass is a mass');
});

test('another unit than the serving\'s own still means the whole serving, as before', () => {
  const idli = { label: '2 idlis', unit: 'piece', quantity: 2, grams: 80 };
  assert.equal(logged('1 serving idli', idli).grams, 80);
  assert.equal(logged('1 plate idli', idli).grams, 80);
});

test('an unclear old label is used whole, as before, and flagged instead of assumed to be one', () => {
  for (const label of ['2-3 pieces', 'a few pieces', '1 plate (2 pieces)']) {
    const item = logged('1 vada', { label, unit: 'piece', grams: 90 });
    assert.equal(item.grams, 90, `${label}: grams unchanged`);
    assert.equal(item.portionMethod, 'ai-estimate-unclear-serving-count');
    assert.match(item.portionBasis, /count is unclear/);
  }
  const given = estimateItem('1 vada', estimate({ label: 'a few pieces', unit: 'piece', grams: 90 }), { quantity: 1, unit: 'piece', grams: 45 });
  assert.equal(given.grams, 45, "an AI parse's own grams still win");
  assert.equal(given.portionMethod, 'provided-grams', 'and need no flag');
});

test('the schema asks for the count and the whole weight; a bad count is rejected', () => {
  const s = FOOD_ESTIMATES_SCHEMA.properties.foods.items.properties.serving;
  assert.deepEqual(s.required, ['label', 'unit', 'quantity', 'grams']);
  const good = { query: 'x', known: true, name: 'X', per100g: PER100, confidence: 'medium', sameAs: null };
  assert.equal(estimateProblem({ ...good, serving: { label: '2 idlis', unit: 'piece', quantity: 2, grams: 80 } }), null);
  assert.equal(estimateProblem({ ...good, serving: { label: '1 bowl', unit: 'bowl', grams: 250 } }), null, 'old shape still valid');
  assert.match(estimateProblem({ ...good, serving: { label: '2 idlis', unit: 'piece', quantity: 0, grams: 80 } }), /quantity/);
});

test('requestEstimates keeps the serving count it is given', async () => {
  const provider = {
    name: 'fake', model: 'fake-1',
    async estimateFoods({ foods }) {
      return { foods: foods.map((q) => ({ query: q, known: true, name: q, per100g: PER100, serving: { label: '2 idlis', unit: 'piece', quantity: 2, grams: 80 }, confidence: 'medium', sameAs: null })), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const { estimates } = await requestEstimates(provider, ['zibbet idli']);
  assert.deepEqual(estimates.get('zibbet idli').serving, { label: '2 idlis', unit: 'piece', quantity: 2, grams: 80 });
});


test('API: an approved old-format estimate ("2 pieces", no quantity) logs per piece', async () => {
  const stored = estimate({ label: '2 pieces', unit: 'piece', grams: 80 }, 'Zibbet idli');
  await sql`INSERT INTO food_requests (phrase, example, reason, estimate, estimate_status)
    VALUES ('zibbet idli', '1 zibbet idli', 'no matching food', ${sql.json(stored)}, 'approved')
    ON CONFLICT (phrase) DO UPDATE SET estimate = EXCLUDED.estimate, estimate_status = 'approved'`;
  const res = await fetch(`${base}/v1/log/text`, { method: 'POST', headers: { Authorization: `Bearer ${live}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '3 zibbet idli' }) });
  assert.equal(res.status, 200);
  const [item] = (await res.json()).items;
  assert.equal(item.food.source, 'ai-estimate');
  assert.equal(item.grams, 120);
  const [row] = await sql`SELECT estimate FROM food_requests WHERE phrase = 'zibbet idli'`;
  assert.deepEqual(row.estimate.serving, { label: '2 pieces', unit: 'piece', grams: 80 }, 'the stored estimate is not rewritten');
});
