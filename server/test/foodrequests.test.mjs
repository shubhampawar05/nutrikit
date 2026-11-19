// Food requests: foods people tried to log that the catalog lacks are counted, AI estimates cover them, and an
// operator's approval makes an estimate answer that food for everyone.
import { sql, fakeProvider } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { catalogCandidates, estimateItem, estimateProblem, phraseParts, requestEstimates, requestKey } from '../src/domain/foodrequests.ts';

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
    // grams is sent but ignored (audit P1-1): the amount is the quantity and unit, weighed by the portion rules.
    return { meal: null, notes: '', items: [{ food: 'glorbix stew', quantity: 1, unit: 'serving', grams: 300, confidence: 'medium' }], usage: { inputTokens: 300, outputTokens: 100 } };
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
  assert.equal(item.grams, 250, "the estimate's serving, never the AI parse's 300 g");
  assert.equal(item.nutrients.calories.amount, 300);
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
  const before = await log(live, 'glorbix stew');
  assert.equal(before.unmatched.length, 1, 'pending estimates need ai: true');

  const { id } = await row('glorbix stew');
  assert.equal((await admin('PATCH', `/v1/admin/food-requests/${id}`, { estimateStatus: 'approved' })).status, 200);
  const approved = await log(live, '2 glorbix stew');
  assert.equal(approved.unmatched.length, 0);
  assert.equal(approved.items[0].food.source, 'ai-estimate');
  assert.equal(approved.items[0].grams, 500, "2 servings of the estimate's 250 g serving");
  // A bowl of it is asked about: the estimate's "1 bowl = 250 g" is its own serving weight, not a bowl density.
  const bowl = await log(live, '1 bowl glorbix stew');
  assert.equal(bowl.items.length, 0);
  assert.match(bowl.unmatched[0].note, /no cited density for Estimated glorbix stew, so 1 bowl can't be weighed/);
  assert.equal(approved.totals.calories.amount, 600);

  await admin('PATCH', `/v1/admin/food-requests/${id}`, { estimateStatus: 'rejected' });
  assert.equal((await log(live, 'glorbix stew')).unmatched.length, 1);
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
  const r = await log(testKey, '2 eggs and blimpo rolls', true);
  assert.equal(r.provider, 'test');
  const sample = r.items.find((i) => i.food.source === 'ai-estimate');
  assert.equal(sample.food.name, 'Sample estimate for "blimpo rolls"');
  assert.equal(sample.grams, 200, "the sample estimate's 200 g serving");
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

test('a catalog food the model calls the same dish is logged from real data, only if offered and in agreement', async () => {
  const [dal] = catalogCandidates('dal');
  assert.ok(dal && dal.calories > 0, 'search offers catalog foods with their calories');
  const offered = [{ id: dal.id, name: dal.name, calories: dal.calories }];
  const answer = (sameAs, calories) => ({ ...good('daal fry special'), sameAs, per100g: { ...good('x').per100g, calories, carbs: (calories - 24 - 36) / 4 } });
  const ask = (e) => requestEstimates({ name: 'fake', estimateFoods: async () => ({ foods: [e], usage: { inputTokens: 1, outputTokens: 1 } }) }, ['daal fry special'], [offered]);

  const agreeing = (await ask(answer(dal.id, Math.round(dal.calories)))).estimates.get('daal fry special');
  assert.deepEqual(agreeing.sameAs, { id: dal.id, name: dal.name });
  const item = estimateItem('1 cup daal fry special', agreeing, { quantity: 1, unit: 'cup' });
  assert.equal(item.food.id, dal.id);
  assert.equal(item.food.source, 'survey');
  assert.equal(item.confidence, 'medium');
  assert.match(item.portionMethod, /^ai-same-as-/);

  const far = (await ask(answer(dal.id, Math.round(dal.calories * 2)))).estimates.get('daal fry special');
  assert.equal(far.sameAs, null, "the model's own figure disagrees: its estimate is used instead");
  const unoffered = (await ask(answer(123456789, Math.round(dal.calories)))).estimates.get('daal fry special');
  assert.equal(unoffered.sameAs, null, 'only an id we offered counts');
});

test('an estimate missing any nutrient, or a malformed one, is not usable', () => {
  assert.equal(estimateProblem({ ...good('x'), per100g: { calories: 150 } }), 'missing or negative values');
  const { sodium, ...noSodium } = good('x').per100g;
  assert.equal(estimateProblem({ ...good('x'), per100g: noSodium }), 'missing or negative values');
  assert.equal(estimateProblem({ ...good('x'), per100g: { ...good('x').per100g, fat: 'lots' } }), 'missing or negative values');
  assert.equal(estimateProblem(null), 'no estimate');
  assert.equal(estimateProblem({ ...good('x'), name: 42 }), 'no name');
});

test('a malformed reply is a failed estimate, not a crash', async () => {
  for (const reply of [{}, { foods: null }, { foods: [null, { known: true }] }, { foods: 'nope' }]) {
    const r = await requestEstimates({ name: 'fake', estimateFoods: async () => reply }, ['dal']);
    assert.equal(r.estimates.size, 0, JSON.stringify(reply));
    assert.deepEqual(r.rejected, [{ query: 'dal', problem: 'no answer for this food', problems: ['no answer for this food', 'no answer for this food'] }], 'both attempts are kept');
    assert.deepEqual(r.usage, { inputTokens: 0, outputTokens: 0 });
  }
});

test('a food the reply leaves out is asked again; a food answered twice counts once', async () => {
  const asked = [];
  const p = {
    name: 'fake',
    async estimateFoods({ foods }) {
      asked.push(foods);
      // First reply: "dal" twice (both failing), "kadhi" missing, "upma" renamed. Second: everything answered well.
      const foods1 = [good('dal', { calories: 10 }), good('dal', { calories: 10 }), good('upma (south indian)')];
      return { foods: asked.length === 1 ? foods1 : foods.map((q) => good(q)), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const r = await requestEstimates(p, ['dal', 'kadhi', 'upma']);
  assert.deepEqual(asked[1], ['dal', 'kadhi', 'upma']);
  assert.deepEqual([...r.estimates.keys()].sort(), ['dal', 'kadhi', 'upma']);
  assert.deepEqual(r.rejected, []);
});

test('when the retry fails, the first attempt\'s estimates are kept and the retried foods are rejected', async () => {
  let n = 0;
  const p = {
    name: 'fake',
    async estimateFoods({ foods, signal }) {
      assert.ok(signal instanceof AbortSignal, 'both attempts share one deadline');
      if (++n === 2) throw Object.assign(new Error('AI provider error (500)'), { status: 502, usage: { inputTokens: 7, outputTokens: 3 } });
      return { foods: foods.map((q) => (q === 'dal' ? good(q) : good(q, { calories: 10 }))), usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
  const r = await requestEstimates(p, ['dal', 'kadhi']);
  assert.deepEqual([...r.estimates.keys()], ['dal']);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].query, 'kadhi');
  assert.match(r.rejected[0].problem, /AI provider error/);
  assert.deepEqual(r.usage, { inputTokens: 17, outputTokens: 8 });
  // A failure on the first attempt is still an error.
  await assert.rejects(requestEstimates({ name: 'fake', estimateFoods: async () => { throw new Error('down'); } }, ['dal']), /down/);
});

test('when estimating fails after the meal was parsed, the parse\'s tokens are still charged', async () => {
  const saved = { parseMeal: provider.parseMeal, estimateFoods: provider.estimateFoods };
  provider.parseMeal = async () => ({ meal: null, notes: '', items: [{ food: 'vrintal bake', quantity: 1, unit: 'bowl', grams: 300, confidence: 'medium' }], usage: { inputTokens: 3000, outputTokens: 1000 } });
  provider.estimateFoods = async () => { throw Object.assign(new Error('AI provider error (500)'), { status: 502 }); };
  try {
    const res = await fetch(`${base}/v1/log/text`, { method: 'POST', headers: { Authorization: `Bearer ${live}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a bowl of vrintal bake', ai: true }) });
    assert.equal(res.status, 502);
    assert.ok(Number(res.headers.get('x-tokens-charged')) > 0, 'AI usage is charged');
  } finally {
    Object.assign(provider, saved);
  }
});

test('P1-1 through the routes: photo, text and voice items are weighed by the rules; the AI\'s grams never log', async () => {
  const saved = { parseMeal: provider.parseMeal, recognizeMeal: provider.recognizeMeal };
  const items = [
    { food: 'dal', quantity: 1, unit: 'katori', grams: 999, confidence: 'high' },
    { food: 'milk', quantity: 1, unit: 'glass', grams: 999, confidence: 'high' },
    { food: 'biryani', quantity: 1, unit: 'plate', grams: 450, confidence: 'high' },
    { food: 'kheer', quantity: 1, unit: 'katori', grams: 240, confidence: 'high' },
    { food: 'dal', quantity: 100, unit: 'g', grams: 300, confidence: 'high' },
    { food: 'plonk stew', quantity: 1, unit: 'bowl', grams: 300, confidence: 'high' },
  ];
  provider.parseMeal = async () => ({ meal: null, notes: '', items, usage: { inputTokens: 1, outputTokens: 1 } });
  provider.recognizeMeal = async () => ({ meal: null, notes: '', items, usage: { inputTokens: 1, outputTokens: 1 } });
  try {
    const headers = { Authorization: `Bearer ${live}`, 'Content-Type': 'application/json' };
    const post = async (path, body) => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(res.status, 200, path);
      return res.json();
    };
    const results = {
      text: await post('/v1/log/text', { text: 'dal, milk, biryani, kheer, 100 g dal, plonk stew', ai: true }),
      voice: await post('/v1/log/voice', { transcript: 'dal milk biryani kheer and plonk stew', ai: true }),
      photo: await post('/v1/log/photo', { image: 'data:image/jpeg;base64,/9j/4AAQ' }),
    };
    for (const [origin, r] of Object.entries(results)) {
      assert.deepEqual(r.items.map((i) => [i.food.name, i.grams, i.portionMethod]), [
        ['Dal', 202.9, 'volume-conversion'], ['Milk, NFS', 257.8, 'assumed-glass'], ['Dal', 100, 'mass'],
      ], `${origin}: only what the rules can weigh is logged, at the rules' grams`);
      assert.ok(r.items.every((i) => i.portionMethod !== 'provided-grams'), origin);
      // Biryani (no plate), kheer (no density) and a bowl of the plonk stew estimate (a serving weight) are asked.
      assert.deepEqual(r.unmatched.map((u) => u.text), ['1 plate biryani', '1 katori kheer', '1 bowl plonk stew'], origin);
      assert.match(r.unmatched[2].note, /no cited density for Estimated plonk stew, so 1 bowl can't be weighed/, origin);
      const fromPhoto = r.items.every((i) => /^amount read from the photo by AI/.test(i.portionBasis));
      assert.equal(fromPhoto, origin === 'photo', `${origin}: only photo items say they were read from a photo`);
    }
  } finally {
    Object.assign(provider, saved);
  }
});

test('P1-1 follow-up through the routes: a stated weight beats the AI\'s reading, the same for text and voice', async () => {
  const saved = { parseMeal: provider.parseMeal, recognizeMeal: provider.recognizeMeal };
  // The AI misreads both stated weights as "1 serving" (and sends grams, which are ignored).
  const items = [
    { food: 'rice', quantity: 1, unit: 'serving', grams: 200, confidence: 'medium' },
    { food: 'kheer', quantity: 1, unit: 'serving', grams: 250, confidence: 'medium' },
    { food: 'dal', quantity: 2, unit: 'katori', grams: 480, confidence: 'high' },
  ];
  provider.parseMeal = async () => ({ meal: null, notes: '', items, usage: { inputTokens: 1, outputTokens: 1 } });
  provider.recognizeMeal = async () => ({ meal: null, notes: '', items: [{ food: 'rice', quantity: 1, unit: 'bowl', grams: 400, confidence: 'high' }], usage: { inputTokens: 1, outputTokens: 1 } });
  try {
    const headers = { Authorization: `Bearer ${live}`, 'Content-Type': 'application/json' };
    const post = async (path, body) => (await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })).json();
    const said = '0.5 kg rice, 100 grams kheer and 2 katori dal';
    const text = await post('/v1/log/text', { text: said, ai: true });
    const voice = await post('/v1/log/voice', { transcript: `um so ${said}`, ai: true });
    for (const r of [text, voice]) {
      assert.deepEqual(r.items.map((i) => [i.food.name, i.grams, i.portionMethod]), [
        ['Rice, cooked, NFS', 500, 'mass'], ['Kheer (rice pudding)', 100, 'mass'], ['Dal', 405.8, 'volume-conversion'],
      ]);
      assert.deepEqual(r.unmatched, []);
    }
    assert.equal(voice.transcript, `so ${said}`, 'voice reads the cleaned transcript ("um" removed)');
    const photo = await post('/v1/log/photo', { image: 'data:image/jpeg;base64,/9j/4AAQ' });
    assert.deepEqual(photo.items.map((i) => [i.food.name, i.grams, i.portionMethod]), [['Rice, cooked, NFS', 133.6, 'assumed-bowl']], 'photos are unchanged');
  } finally {
    Object.assign(provider, saved);
  }
});
