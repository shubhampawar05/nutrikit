// Food requests: foods people tried to log that the catalog lacks are counted, AI estimates cover them, and an
// operator's approval makes an estimate answer that food for everyone.
import { sql, fakeProvider } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { estimateProblem, phraseParts, requestEstimates, requestKey } from '../src/domain/foodrequests.ts';

const app = await buildApp();
const ADMIN = { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' };
let base;
let provider;
let live;
let testKey;

/** A provider whose parse returns one unknown dish and whose estimates are canned. */
function estimatingProvider() {
  const p = fakeProvider();
  p.parseMeal = async (args) => {
    p.calls.push(['parseMeal', args]);
    return { meal: null, notes: '', items: [{ food: 'glorbix stew', quantity: 1, unit: 'bowl', grams: 300, confidence: 'medium' }], usage: { inputTokens: 300, outputTokens: 100 } };
  };
  p.estimateFoods = async (args) => {
    p.calls.push(['estimateFoods', args]);
    return {
      foods: args.foods.map((query) => ({
        query, known: query !== 'qwzx', name: `Estimated ${query}`,
        per100g: { calories: 120, protein: 6, fat: 4, carbs: 15, fiber: 3, sugar: 2, saturatedFat: 1, sodium: 250 },
        serving: { label: '1 bowl', unit: 'bowl', grams: 250 }, confidence: 'medium',
      })),
      usage: { inputTokens: 200, outputTokens: 150 },
    };
  };
  return p;
}

before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  provider = estimatingProvider();
  setProvider(provider);
  const res = await fetch(`${base}/portal/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' },
    body: JSON.stringify({ name: 'Food Co', email: 'food@example.test', password: 'correct horse battery' }),
  });
  const body = await res.json();
  live = body.firstKey.key;
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const t = await fetch(`${base}/portal/api/keys`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' }, body: JSON.stringify({ name: 'ci', mode: 'test' }),
  });
  testKey = (await t.json()).key;
});
after(() => app.close());

const log = async (key, text, ai = false) => {
  const res = await fetch(`${base}/v1/log/text`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(ai ? { ai } : {}) }) });
  assert.equal(res.status, 200);
  return res.json();
};
const row = async (phrase) => (await sql`SELECT * FROM food_requests WHERE phrase = ${phrase}`)[0];
const admin = (method, path, body) => fetch(`${base}${path}`, { method, headers: ADMIN, body: body ? JSON.stringify(body) : undefined });

test('a request is counted under its food words only', () => {
  assert.deepEqual(phraseParts('2 bowls Zorbly Khichdi'), { food: 'Zorbly Khichdi', quantity: 2, unit: 'bowls' });
  assert.equal(requestKey('  Zorbly  KHICHDI!! '), 'zorbly khichdi');
  assert.equal(requestKey('x'.repeat(300)).length, 100);
});

test('rules logging counts what it could not match, for live keys only', async () => {
  const r = await log(live, '2 eggs and 2 bowls zorbly khichdi');
  assert.equal(r.items.length, 1);
  assert.equal(r.unmatched.length, 1);
  await log(live, '1 plate Zorbly Khichdi');
  const z = await row('zorbly khichdi');
  assert.equal(z.count, 2);
  assert.equal(z.example, '2 bowls zorbly khichdi');
  assert.equal(z.status, 'open');
  assert.equal(z.estimate_status, 'none');

  await log(testKey, '1 bowl snorvel curry');
  assert.equal(await row('snorvel curry'), undefined, 'test keys are never counted');
  assert.equal(provider.calls.filter(([c]) => c === 'estimateFoods').length, 0, 'rules logging never calls the AI');
});

test('with ai, an unknown food is logged from an estimate, stored as pending, and reused', async () => {
  const r = await log(live, 'a bowl of glorbix stew', true);
  assert.equal(r.unmatched.length, 0);
  const [item] = r.items;
  assert.equal(item.food.source, 'ai-estimate');
  assert.equal(item.food.name, 'Estimated glorbix stew');
  assert.equal(item.confidence, 'low');
  assert.equal(item.grams, 300, "the AI parse's grams win over the estimate's serving");
  assert.equal(item.nutrients.calories.amount, 360);
  assert.equal(item.recognition.label, 'glorbix stew');
  const g = await row('glorbix stew');
  assert.equal(g.estimate_status, 'pending');
  assert.equal(g.estimate.name, 'Estimated glorbix stew');
  assert.equal(g.estimate.provider, 'fake');
  assert.equal(g.estimate_uses, 1);

  await log(live, 'glorbix stew again', true);
  assert.equal(provider.calls.filter(([c]) => c === 'estimateFoods').length, 1, 'a stored estimate is reused, not asked again');
  assert.equal((await row('glorbix stew')).estimate_uses, 2);
  assert.equal((await row('glorbix stew')).count, 2);
});

test('a pending estimate is not used by rules logging; an approved one is, and a rejected one stops', async () => {
  const before = await log(live, '1 bowl glorbix stew');
  assert.equal(before.unmatched.length, 1, 'pending estimates need ai: true');

  const { id } = await row('glorbix stew');
  assert.equal((await admin('PATCH', `/v1/admin/food-requests/${id}`, { estimateStatus: 'approved' })).status, 200);
  const approved = await log(live, '2 bowls glorbix stew');
  assert.equal(approved.unmatched.length, 0);
  assert.equal(approved.items[0].food.source, 'ai-estimate');
  assert.equal(approved.items[0].grams, 500, "2 bowls at the estimate's 250 g bowl");
  assert.equal(approved.totals.calories.amount, 600);

  await admin('PATCH', `/v1/admin/food-requests/${id}`, { estimateStatus: 'rejected' });
  assert.equal((await log(live, '1 bowl glorbix stew')).unmatched.length, 1);
  const asked = provider.calls.filter(([c]) => c === 'estimateFoods').length;
  const again = await log(live, 'glorbix stew', true);
  assert.equal(again.unmatched.length, 1, 'a rejected food is not estimated again, even with ai');
  assert.equal(provider.calls.filter(([c]) => c === 'estimateFoods').length, asked);
  assert.equal((await row('glorbix stew')).estimate_status, 'rejected');
});

test('a query the AI says is not a food stays unmatched', async () => {
  provider.parseMeal = async () => ({ meal: null, notes: '', items: [{ food: 'qwzx', quantity: 1, unit: 'serving', grams: 100, confidence: 'low' }], usage: { inputTokens: 1, outputTokens: 1 } });
  const r = await log(live, 'qwzx', true);
  assert.equal(r.items.length, 0);
  assert.equal(r.unmatched.length, 1);
  assert.equal((await row('qwzx')).estimate_status, 'none');
});

test('test keys get the sample estimate and leave nothing behind', async () => {
  const before = (await sql`SELECT count(*)::int AS n FROM food_requests`)[0].n;
  const r = await log(testKey, '2 eggs and a bowl of blimpo rolls', true);
  assert.equal(r.provider, 'test');
  const sample = r.items.find((i) => i.food.source === 'ai-estimate');
  assert.equal(sample.food.name, 'Sample estimate for "blimpo rolls"');
  assert.equal(sample.grams, 200, "the sample estimate's 200 g bowl");
  assert.equal(r.unmatched.length, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM food_requests`)[0].n, before);
});

test('the homepage demo counts its misses too', async () => {
  const res = await fetch(`${base}/portal/api/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' }, body: JSON.stringify({ text: '1 bowl frangle soup' }) });
  assert.equal(res.status, 200);
  assert.equal((await row('frangle soup')).count, 1);
});

test('admins list requests most asked first, filter them, and resolve or ignore them', async () => {
  assert.equal((await fetch(`${base}/v1/admin/food-requests`)).status, 401);
  const list = await (await admin('GET', '/v1/admin/food-requests')).json();
  const phrases = list.requests.map((r) => r.phrase);
  assert.ok(phrases.indexOf('glorbix stew') < phrases.indexOf('frangle soup'), 'most asked first');
  assert.equal(typeof list.counts.open, 'number');
  const glorbix = list.requests.find((r) => r.phrase === 'glorbix stew');
  assert.equal(glorbix.estimateStatus, 'rejected');
  assert.equal(glorbix.estimate.serving.grams, 250);

  const filtered = await (await admin('GET', '/v1/admin/food-requests?q=zorbly')).json();
  assert.deepEqual(filtered.requests.map((r) => r.phrase), ['zorbly khichdi']);

  const done = await admin('PATCH', `/v1/admin/food-requests/${filtered.requests[0].id}`, { status: 'resolved', note: 'alias added' });
  assert.equal(done.status, 200);
  assert.deepEqual(((({ status, note }) => ({ status, note }))(await done.json())), { status: 'resolved', note: 'alias added' });
  const open = await (await admin('GET', '/v1/admin/food-requests')).json();
  assert.ok(!open.requests.some((r) => r.phrase === 'zorbly khichdi'), 'resolved requests leave the open list');

  assert.equal((await admin('PATCH', '/v1/admin/food-requests/999999', { status: 'ignored' })).status, 404);
  assert.equal((await admin('PATCH', `/v1/admin/food-requests/${glorbix.id}`, {})).status, 400);
});

const good = (query, over = {}) => ({
  query, known: true, name: `Estimated ${query}`, confidence: 'medium', serving: { label: '1 bowl', unit: 'bowl', grams: 250 },
  per100g: { calories: 120, protein: 6, fat: 4, carbs: 15, fiber: 3, sugar: 2, saturatedFat: 1, sodium: 250, ...over },
});

test('an estimate must add up: calories from macros, parts within their whole, a real serving', () => {
  assert.equal(estimateProblem(good('dal')), null);
  assert.match(estimateProblem(good('dal', { calories: 50, fat: 20 })), /disagrees with its macros/);
  assert.match(estimateProblem(good('ghee', { calories: 950, fat: 105 })), /more than pure fat/);
  assert.match(estimateProblem(good('x', { protein: 60, carbs: 40, fat: 10, calories: 490 })), /more than 100 g/);
  assert.match(estimateProblem(good('x', { sugar: 30 })), /sugar exceeds carbs/);
  assert.match(estimateProblem(good('x', { saturatedFat: 9 })), /saturated fat exceeds fat/);
  assert.match(estimateProblem(good('x', { sodium: -1 })), /negative/);
  assert.match(estimateProblem({ ...good('x'), serving: { label: '1 bowl', unit: 'bowl', grams: 0 } }), /serving/);
  assert.equal(estimateProblem({ ...good('qwzx'), known: false }), 'not a food');
});

test('a failed estimate is asked once more, then left out; "not a food" is not asked again', async () => {
  const asked = [];
  const p = {
    name: 'fake',
    async estimateFoods({ foods }) {
      asked.push(foods);
      const first = asked.length === 1;
      return {
        foods: foods.map((q) => (q === 'dal' ? good(q)
          : q === 'bad twice' ? good(q, { calories: 10 })
          : q === 'qwzx' ? { ...good(q), known: false }
          : first ? good(q, { calories: 10 }) : good(q))),
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  const r = await requestEstimates(p, ['dal', 'fixed later', 'bad twice', 'qwzx']);
  assert.deepEqual(asked, [['dal', 'fixed later', 'bad twice', 'qwzx'], ['fixed later', 'bad twice']]);
  assert.deepEqual([...r.estimates.keys()].sort(), ['dal', 'fixed later']);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].query, 'bad twice');
  assert.match(r.rejected[0].problem, /disagrees with its macros/);
  assert.deepEqual(r.usage, { inputTokens: 20, outputTokens: 10 });
});
