// Estimate provenance (M4): every AI estimate records how it was made (prompt and calc versions, model version,
// catalog candidates offered, attempts and rejection reasons), unknown nutrients stay null, and review never turns an
// estimate into verified data. Providers are mocked: no AI call is made.
import { sql, fakeProvider } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { ESTIMATE_PROMPT_VERSION, FOOD_ESTIMATES_SCHEMA, promptVersionOf } from '../src/domain/providers/prompts.ts';
import { ESTIMATE_CALC_VERSION, estimateItem, estimateProblem, requestEstimates } from '../src/domain/foodrequests.ts';

const app = await buildApp();
const ADMIN = { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' };
let base;
let live;
let testKey;
const GOOD = { calories: 120, protein: 6, fat: 4, carbs: 15, fiber: 3, sugar: 2, saturatedFat: 1, sodium: 250 };
const answer = (query, over = {}) => ({ query, known: true, name: `Estimated ${query}`, per100g: GOOD, serving: { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 250 }, confidence: 'medium', sameAs: null, ...over });

/** A provider whose parse returns the text's single food and whose estimates come from `make(query, attempt)`. */
function provider(make) {
  const p = fakeProvider();
  p.model = 'fake-model';
  const asked = new Map();
  p.parseMeal = async ({ text }) => ({ meal: null, notes: '', items: [{ food: text.replace(/^\d+\s+/, ''), quantity: 1, unit: 'bowl', grams: 0, confidence: 'medium' }], usage: { inputTokens: 1, outputTokens: 1 } });
  p.estimateFoods = async ({ foods }) => ({
    foods: foods.map((q) => { const n = (asked.get(q) ?? 0) + 1; asked.set(q, n); return make(q, n); }).filter(Boolean),
    usage: { inputTokens: 10, outputTokens: 10 }, model: 'fake-model', modelVersion: 'fake-model-2026-11-01',
  });
  return p;
}

before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  const res = await fetch(`${base}/portal/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' },
    body: JSON.stringify({ name: 'Provenance Co', email: 'provenance@example.test', password: 'correct horse battery' }),
  });
  const body = await res.json();
  live = body.firstKey.key;
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const t = await fetch(`${base}/portal/api/keys`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' }, body: JSON.stringify({ name: 'ci', mode: 'test' }) });
  testKey = (await t.json()).key;
});
after(() => app.close());

const log = async (key, text, ai = false) => {
  const res = await fetch(`${base}/v1/log/text`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(ai ? { ai } : {}) }) });
  assert.equal(res.status, 200);
  return res.json();
};
const row = async (phrase) => (await sql`SELECT * FROM food_requests WHERE phrase = ${phrase}`)[0];
const adminList = async () => (await (await fetch(`${base}/v1/admin/food-requests?status=all`, { headers: ADMIN })).json()).requests;

test('the prompt version is a stable hash of the prompt and schema', () => {
  assert.match(ESTIMATE_PROMPT_VERSION, /^[0-9a-f]{12}$/);
  assert.notEqual(promptVersionOf({ system: 'other', message: () => '' }), ESTIMATE_PROMPT_VERSION);
});

test('a new estimate records its provenance: versions, model version, candidates and attempts', async () => {
  const p = provider((q) => answer(q));
  const candidates = [[{ id: 1, name: 'Some curry', calories: 110 }]];
  const { estimates } = await requestEstimates(p, ['glimmet stew'], candidates);
  const e = estimates.get('glimmet stew');
  assert.equal(e.provider, 'fake');
  assert.equal(e.model, 'fake-model');
  assert.equal(e.modelVersion, 'fake-model-2026-11-01');
  assert.equal(e.promptVersion, ESTIMATE_PROMPT_VERSION);
  assert.equal(e.calcVersion, ESTIMATE_CALC_VERSION);
  assert.deepEqual(e.candidates, [{ id: 1, name: 'Some curry', calories: 110 }]);
  assert.equal(e.attempts, 1);
  assert.equal(e.previousProblems, undefined);
  assert.ok(!Number.isNaN(Date.parse(e.at)));
});

test('an estimate accepted on the second attempt keeps why the first was rejected', async () => {
  const p = provider((q, n) => (n === 1 ? answer(q, { per100g: { ...GOOD, calories: 999 } }) : answer(q)));
  const { estimates } = await requestEstimates(p, ['blarney pie']);
  const e = estimates.get('blarney pie');
  assert.equal(e.attempts, 2);
  assert.equal(e.previousProblems.length, 1);
  assert.match(e.previousProblems[0], /more than pure fat/);
});

test('unknown nutrients stay null: allowed for fiber, sugar, saturated fat and sodium, absent from the item, never 0', () => {
  const props = FOOD_ESTIMATES_SCHEMA.properties.foods.items.properties.per100g.properties;
  assert.deepEqual(props.sodium.type, ['number', 'null']);
  assert.equal(props.calories.type, 'number');
  const unknownSodium = answer('x', { per100g: { ...GOOD, sodium: null, sugar: null } });
  assert.equal(estimateProblem(unknownSodium), null);
  assert.match(estimateProblem(answer('x', { per100g: { ...GOOD, calories: null } })), /missing/);
  assert.match(estimateProblem(answer('x', { per100g: { ...GOOD, sodium: -1 } })), /negative/);
  const stored = { ...unknownSodium, provider: 'fake', model: 'm', at: '2026-11-19T00:00:00.000Z' };
  const item = estimateItem('1 bowl x', stored, { quantity: 1, unit: 'bowl' });
  assert.equal(item.nutrients.sodium, undefined, 'unknown sodium is not reported');
  assert.equal(item.nutrients.sugar, undefined);
  assert.ok(item.nutrients.calories.amount > 0);
});

test('older estimates without provenance still read, with null versions', () => {
  const legacy = { name: 'Old stew', per100g: GOOD, serving: { label: '1 bowl', unit: 'bowl', grams: 250 }, confidence: 'medium', provider: 'openai', model: 'gpt-5-mini', at: '2026-10-01T00:00:00.000Z', sameAs: null };
  const item = estimateItem('1 bowl old stew', legacy, { quantity: 1, unit: 'bowl' }, 'approved');
  assert.equal(item.grams, 250);
  assert.deepEqual(item.basis, { kind: 'ai-estimate', status: 'approved', provider: 'openai', model: 'gpt-5-mini', modelVersion: null, promptVersion: null, calcVersion: null, estimatedAt: '2026-10-01T00:00:00.000Z' });
});

test('API: provenance survives storage and comes back on the item and in the admin list', async () => {
  setProvider(provider((q) => answer(q)));
  const r = await log(live, '1 zandle curry', true);
  const [item] = r.items;
  assert.equal(item.food.source, 'ai-estimate');
  assert.equal(item.confidence, 'low');
  assert.equal(item.basis.kind, 'ai-estimate');
  assert.equal(item.basis.status, 'pending');
  assert.equal(item.basis.promptVersion, ESTIMATE_PROMPT_VERSION);
  assert.equal(item.basis.calcVersion, ESTIMATE_CALC_VERSION);
  assert.equal(item.basis.modelVersion, 'fake-model-2026-11-01');
  const stored = (await row('zandle curry')).estimate;
  assert.equal(stored.promptVersion, ESTIMATE_PROMPT_VERSION);
  assert.ok(Array.isArray(stored.candidates));
  const listed = (await adminList()).find((x) => x.phrase === 'zandle curry');
  assert.equal(listed.estimate.calcVersion, ESTIMATE_CALC_VERSION);
  assert.deepEqual(listed.estimateFailures, []);
  assert.equal(listed.estimateReviewedAt, null);

  const t = await log(testKey, '1 zandle curry', true);
  assert.equal(t.items[0].basis.status, 'unstored', 'test keys get an estimate that is not kept');
});

test('API: an approved estimate stays an AI estimate, never verified data', async () => {
  const before = await row('zandle curry');
  const res = await fetch(`${base}/v1/admin/food-requests/${before.id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ estimateStatus: 'approved' }) });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.ok(updated.estimateReviewedAt, 'the review time is recorded');
  assert.deepEqual(updated.estimate, before.estimate, 'approval does not change the estimate');
  const r = await log(live, '2 bowls zandle curry'); // rules logging: no AI call
  const [item] = r.items;
  assert.equal(item.food.source, 'ai-estimate');
  assert.equal(item.food.id, 0);
  assert.equal(item.confidence, 'low');
  assert.equal(item.basis.status, 'approved');
  assert.equal(item.basis.kind, 'ai-estimate');
});

test('API: a rejected estimate keeps the estimate, the review time and the operator\'s note', async () => {
  setProvider(provider((q) => answer(q)));
  await log(live, '1 frabble soup', true);
  const r0 = await row('frabble soup');
  const res = await fetch(`${base}/v1/admin/food-requests/${r0.id}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ estimateStatus: 'rejected', note: 'calories far too low for this dish' }) });
  const updated = await res.json();
  assert.equal(updated.estimateStatus, 'rejected');
  assert.equal(updated.note, 'calories far too low for this dish');
  assert.ok(updated.estimateReviewedAt);
  assert.equal(updated.estimate.promptVersion, ESTIMATE_PROMPT_VERSION, 'the rejected estimate and its provenance are kept');
  assert.equal((await log(live, '1 frabble soup', true)).items.length, 0, 'a rejected estimate is not used');
});

test('API: when every answer is rejected, each reason is kept with the food, newest first', async () => {
  setProvider(provider((q, n) => answer(q, { per100g: { ...GOOD, calories: n === 1 ? 999 : 10 } })));
  const r = await log(live, '1 quorble bake', true);
  assert.equal(r.items.length, 0);
  const f = (await row('quorble bake')).estimate_failures;
  assert.equal(f.length, 2);
  assert.match(f[0].problem, /disagrees with its macros/, 'newest first: the second answer');
  assert.match(f[1].problem, /more than pure fat/);
  assert.equal(f[0].provider, 'fake');
  assert.equal(f[0].promptVersion, ESTIMATE_PROMPT_VERSION);
  assert.equal((await row('quorble bake')).estimate, null, 'no estimate is invented');
  for (let i = 0; i < 3; i++) await log(live, '1 quorble bake', true);
  assert.equal((await row('quorble bake')).estimate_failures.length, 5, 'only the last 5 are kept');
});

test('P0-4: with ai, an ambiguous bare word ("chicken") is not sent for an AI estimate', async () => {
  const p = provider((q) => answer(q));
  let asked = [];
  const inner = p.estimateFoods;
  p.estimateFoods = async (args) => { asked = asked.concat(args.foods); return inner(args); };
  setProvider(p);
  const r = await log(live, '1 chicken', true);
  assert.equal(r.items.length, 0);
  assert.ok(!asked.includes('chicken'));
});
