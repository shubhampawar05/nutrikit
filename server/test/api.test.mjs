import { fakeProvider, sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { createKey } from '../src/domain/auth.ts';
import { isValidGtin, fromOpenFoodFacts, lookupBarcode } from '../src/domain/barcode.ts';
import { LABEL_WARNINGS } from '../src/domain/label.ts';

// Barcode tests use a fake Open Food Facts API, not a locally built packaged-foods store (test/packaged.test.mjs).
process.env.NUTRIKIT_PACKAGED_DB = 'data/no-packaged-store-in-tests.db';
const app = await buildApp();

let base;
let key;
const provider = fakeProvider();

before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  key = (await createKey(sql, { name: 'tests' })).key;
});
after(() => app.close());

const call = (path, { method = 'GET', body, headers = {}, auth = key } = {}) =>
  fetch(base + path, {
    method,
    headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body && typeof body !== 'string' && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body == null ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
  });

test('health is public; everything else needs a key', async () => {
  setProvider({ name: 'none' });
  const h = await call('/v1/health', { auth: null });
  assert.equal(h.status, 200);
  assert.deepEqual(await h.json(), { status: 'ok', provider: 'none' });
  const r = await call('/v1/foods/search?q=egg', { auth: null });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error.code, 'unauthorized');
  assert.equal((await call('/v1/foods/search?q=egg', { auth: 'nk_wrong' })).status, 401);
  assert.equal((await call('/v1/foods/search?q=egg', { auth: null, headers: { 'X-Api-Key': key } })).status, 200);
});

test('search, food detail and portion nutrients', async () => {
  const s = await call('/v1/foods/search?q=banana&limit=3');
  assert.equal(s.status, 200);
  assert.equal(s.headers.get('x-tokens-charged'), '1');
  const body = await s.json();
  assert.equal(body.results.length, 3);
  const id = body.results[0].id;
  const food = await (await call(`/v1/foods/${id}`)).json();
  assert.equal(food.name, 'Banana, raw');
  assert.ok(food.portions.some((p) => p.label === '1 banana'));
  const n = await (await call(`/v1/foods/${id}/nutrients?quantity=2&unit=banana`)).json();
  assert.equal(n.grams, 252);
  const g = await (await call(`/v1/foods/${id}/nutrients?grams=100`)).json();
  assert.equal(g.nutrients.calories.amount, food.per100g.calories);
  assert.equal((await call('/v1/foods/999999999')).status, 404);
  assert.equal((await call(`/v1/foods/${id}/nutrients?grams=-5`)).status, 400);
  assert.equal((await call('/v1/foods/search')).status, 400);
  assert.equal((await call('/v1/foods/search?q=egg&limit=500')).status, 400);
});

test('text and voice logging (rules), errors and method checks', async () => {
  const t = await (await call('/v1/log/text', { method: 'POST', body: { text: 'a banana and 2 tbsp peanut butter' } })).json();
  assert.equal(t.provider, 'rules');
  assert.deepEqual(t.items.map((i) => i.food.name), ['Banana, raw', 'Peanut butter']);
  const v = await (await call('/v1/log/voice', { method: 'POST', body: { transcript: 'um so I had like a bowl of oatmeal' } })).json();
  assert.equal(v.transcript, 'so I had a bowl of oatmeal');
  assert.equal(v.items[0].food.name, 'Oatmeal, NFS');
  assert.equal((await call('/v1/log/text', { method: 'POST', body: {} })).status, 400);
  assert.equal((await call('/v1/log/text', { method: 'POST', body: '{bad json' })).status, 400);
  assert.equal((await call('/v1/log/text', { method: 'POST', body: { text: 'x'.repeat(2001) } })).status, 400);
  assert.equal((await call('/v1/log/text')).status, 405);
  assert.equal((await call('/v1/nope')).status, 404);
});

test('AI endpoints return 501 without a provider', async () => {
  setProvider({ name: 'none' });
  const r = await call('/v1/log/photo', { method: 'POST', body: { image: 'aGVsbG8=', mediaType: 'image/png' } });
  assert.equal(r.status, 501);
  assert.equal((await r.json()).error.code, 'ai_provider_unavailable');
  assert.equal((await call('/v1/log/text', { method: 'POST', body: { text: 'oatmeal', ai: true } })).status, 501);
});

test('photo logging with a provider: validation, matching and AI metering', async () => {
  setProvider(provider);
  assert.equal((await call('/v1/log/photo', { method: 'POST', body: { image: 'aGVsbG8=', mediaType: 'image/bmp' } })).status, 400);
  assert.equal((await call('/v1/log/photo', { method: 'POST', body: { image: 'not base64!!', mediaType: 'image/png' } })).status, 400);
  const r = await call('/v1/log/photo', { method: 'POST', body: { image: 'data:image/jpeg;base64,/9j/4AAQ', hint: 'dinner plate' } });
  assert.equal(r.status, 200);
  // 20 flat + ceil((1500 + 400) / 1000) = 22
  assert.equal(r.headers.get('x-tokens-charged'), '22');
  const body = await r.json();
  assert.equal(body.provider, 'fake');
  assert.equal(body.meal, 'lunch');
  assert.equal(body.items.length, 3);
  assert.equal(body.items[0].grams, 150);
  assert.equal(body.items[0].portionMethod, 'provided-grams');
  assert.match(body.items[1].food.name, /^Rice, white, cooked/);
  assert.equal(body.items[0].recognition.confidence, 'high');
  assert.equal(body.usage, undefined, 'provider token usage is not leaked to clients');
  const [, args] = provider.calls.find(([m]) => m === 'recognizeMeal');
  assert.deepEqual(args, { image: '/9j/4AAQ', mediaType: 'image/jpeg', hint: 'dinner plate' });
  // Raw image body
  const raw = await call('/v1/log/photo', { method: 'POST', body: new Uint8Array([0xff, 0xd8, 0xff]), headers: { 'Content-Type': 'image/jpeg' } });
  assert.equal(raw.status, 200);
});

test('label parsing from text and image', async () => {
  setProvider(provider);
  const t = await call('/v1/labels/parse', { method: 'POST', body: { text: 'Serving size 1 cup (240g) Calories 120 Protein 8g' } });
  assert.equal(t.headers.get('x-tokens-charged'), '5');
  const tb = await t.json();
  assert.equal(tb.source, 'text');
  assert.equal(tb.perServing.protein.amount, 8);
  const i = await call('/v1/labels/parse', { method: 'POST', body: { image: 'aGVsbG8=', mediaType: 'image/png' } });
  assert.equal(i.headers.get('x-tokens-charged'), '22');
  const ib = await i.json();
  assert.equal(ib.source, 'image');
  assert.equal(ib.perServing.calories.amount, 190);
  assert.equal(ib.perServing.cholesterol, undefined);
  assert.equal(ib.per100g.calories, 475);
  assert.equal((await call('/v1/labels/parse', { method: 'POST', body: {} })).status, 400);
});

test('advisor: answers, declines out-of-scope questions, passes context, meters AI usage', async () => {
  setProvider({ name: 'none' });
  assert.equal((await call('/v1/advisor', { method: 'POST', body: { question: 'high protein snacks?' } })).status, 501);

  setProvider(provider);
  const r = await call('/v1/advisor', { method: 'POST', body: { question: '  high protein snacks?  ', context: 'Goal: build muscle. Avoids: peanuts.' } });
  assert.equal(r.status, 200);
  // 5 flat + ceil((800 + 250) / 1000) = 7
  assert.equal(r.headers.get('x-tokens-charged'), '7');
  assert.deepEqual(await r.json(), { answer: '- **Greek yogurt**: about 10 g protein per 100 g', declined: false, provider: 'fake' });
  const [, args] = provider.calls.findLast(([m]) => m === 'advise');
  assert.deepEqual(args, { question: 'high protein snacks?', context: 'Goal: build muscle. Avoids: peanuts.' });

  const declined = await (await call('/v1/advisor', { method: 'POST', body: { question: 'Should I change my insulin dose?' } })).json();
  assert.equal(declined.declined, true);
  assert.equal(provider.calls.findLast(([m]) => m === 'advise')[1].context, null);

  assert.equal((await call('/v1/advisor', { method: 'POST', body: { question: '   ' } })).status, 400);
  assert.equal((await call('/v1/advisor', { method: 'POST', body: { question: 'x'.repeat(1001) } })).status, 400);
});

test('AI text parsing goes through the provider', async () => {
  setProvider(provider);
  const r = await (await call('/v1/log/text', { method: 'POST', body: { text: 'a cup of oatmeal', ai: true } })).json();
  assert.equal(r.provider, 'fake');
  assert.equal(r.meal, 'breakfast');
  assert.equal(r.items[0].grams, 234);
});

test('barcode endpoint validates codes', async () => {
  assert.equal((await call('/v1/barcodes/1234567')).status, 400, 'wrong length');
  const bad = await call('/v1/barcodes/3017624010702');
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'invalid_barcode');
});

test('GTIN check digits', () => {
  for (const ok of ['3017624010701', '012000161155', '96385074', '00012000161155']) assert.ok(isValidGtin(ok), ok);
  for (const no of ['3017624010702', '12345', 'abcdefghijklm', '123456789012345']) assert.ok(!isValidGtin(no), no);
});

test('Open Food Facts mapping converts grams to mg/mcg', () => {
  const p = fromOpenFoodFacts({ code: '1', product_name: 'Bar', brands: 'B', serving_quantity: 40, nutriments: { 'energy-kcal_100g': 400, proteins_100g: 20, sodium_100g: 0.5, 'vitamin-d_100g': 0.000005, iron_100g: 0.002 } });
  assert.deepEqual(p.per100g, { calories: 400, protein: 20, sodium: 500, iron: 2, vitaminD: 5 });
  assert.equal(p.perServing.calories.amount, 160);
  assert.equal(fromOpenFoodFacts({ code: '2', nutriments: { energy_100g: 418.4 } }).per100g.calories, 100);
});

test('Open Food Facts null or non-numeric values stay missing, never 0', () => {
  const p = fromOpenFoodFacts({ code: '3', nutriments: { 'energy-kcal_100g': null, energy_100g: null, proteins_100g: 5, fat_100g: null, sugars_100g: 'n/a', 'saturated-fat_100g': '' } });
  assert.deepEqual(p.per100g, { protein: 5 });
  assert.equal(fromOpenFoodFacts({ code: '4', nutriments: { 'energy-kcal_100g': null, energy_100g: 418.4 } }).per100g.calories, 100);
});

test('photo logging keeps each AI recognition with its own item when an earlier one is unmatched', async () => {
  setProvider({
    name: 'fake',
    async recognizeMeal() {
      return {
        meal: null, notes: '',
        items: [
          { food: 'zzqxunknownfood', quantity: 1, unit: 'piece', grams: 50, confidence: 'low' },
          { food: 'banana', quantity: 1, unit: 'piece', grams: 118, confidence: 'high' },
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  });
  const body = await (await call('/v1/log/photo', { method: 'POST', body: { image: 'aGVsbG8=', mediaType: 'image/png' } })).json();
  assert.equal(body.unmatched.length, 1);
  assert.equal(body.items.length, 1);
  assert.match(body.items[0].food.name, /^Banana/);
  assert.deepEqual(body.items[0].recognition, { label: 'banana', confidence: 'high' });
});

test('label from an image reports the same warnings as the text parser', async () => {
  setProvider({
    name: 'fake',
    async readLabel() {
      return { isNutritionLabel: true, servingSize: '1 bottle (500 ml)', servingGrams: 500, servingsPerContainer: 1, perServing: { calories: 210, sugar: 52 }, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  });
  const ml = await (await call('/v1/labels/parse', { method: 'POST', body: { image: 'aGVsbG8=', mediaType: 'image/png' } })).json();
  assert.deepEqual(ml.warnings, [LABEL_WARNINGS.mlServing]);
  setProvider({
    name: 'fake',
    async readLabel() {
      return { isNutritionLabel: true, servingSize: null, servingGrams: null, servingsPerContainer: null, perServing: { protein: 3 }, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  });
  const none = await (await call('/v1/labels/parse', { method: 'POST', body: { image: 'aGVsbG8=', mediaType: 'image/png' } })).json();
  assert.deepEqual(none.warnings, [LABEL_WARNINGS.noServing, LABEL_WARNINGS.noCalories]);
});

test('barcode lookup caches hits and misses', async () => {
  let hits = 0;
  const fakeFetch = async (url) => {
    hits++;
    if (url.includes('/4006381333931.')) return new Response(JSON.stringify({ status: 1, product: { product_name: 'Pen', nutriments: { 'energy-kcal_100g': 1 } } }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const a = await lookupBarcode(sql, '4006381333931', { fetch: fakeFetch });
  assert.equal(a.found, true);
  assert.equal(a.product.name, 'Pen');
  const b = await lookupBarcode(sql, '4006381333931', { fetch: fakeFetch });
  assert.equal(b.cached, true);
  const miss = await lookupBarcode(sql, '96385074', { fetch: fakeFetch });
  assert.equal(miss.found, false);
  assert.equal((await lookupBarcode(sql, '96385074', { fetch: fakeFetch })).cached, true);
  assert.equal(hits, 2);
  const offline = await lookupBarcode(sql, '73513537', { fetch: fakeFetch, offline: true });
  assert.deepEqual(offline, { found: false, cached: false, offline: true });
  // A product cached before the label checks existed (no `issues`) is fetched again.
  await sql`UPDATE barcode_cache SET payload = payload - 'issues' WHERE code = '4006381333931'`;
  assert.equal((await lookupBarcode(sql, '4006381333931', { fetch: fakeFetch })).cached, false);
  assert.equal(hits, 3);
});

test('meal plan endpoint validates input', async () => {
  const r = await (await call('/v1/meal-plans', { method: 'POST', body: { calories: 1800, diet: 'pescatarian', days: 2, seed: 5 } })).json();
  assert.equal(r.days.length, 2);
  assert.equal(r.seed, 5);
  for (const bad of [{ diet: 'keto' }, { calories: 99999 }, { days: 30 }, { meals: ['brunch'] }, { exclude: 'nuts' }]) {
    assert.equal((await call('/v1/meal-plans', { method: 'POST', body: bad })).status, 400, JSON.stringify(bad));
  }
});

test('monthly token allowance is enforced', async () => {
  const small = (await createKey(sql, { name: 'small', tokenLimit: 3 })).key;
  const s = (q) => call(`/v1/foods/search?q=${q}`, { auth: small });
  assert.equal((await s('egg')).headers.get('x-tokens-remaining'), '2');
  await s('egg');
  await s('egg');
  const r = await s('egg');
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error.code, 'quota_exceeded');
  const u = await (await call('/v1/usage', { auth: small })).json();
  assert.deepEqual([u.used, u.remaining, u.tokenLimit], [3, 0, 3]);
});

test('admin key management', async () => {
  const admin = 'test-admin-token';
  assert.equal((await call('/v1/admin/keys', { auth: key })).status, 401);
  const created = await call('/v1/admin/keys', { method: 'POST', auth: admin, body: { name: 'partner', tokenLimit: 1000 } });
  assert.equal(created.status, 201);
  const k = await created.json();
  assert.match(k.key, /^nk_/);
  assert.equal((await call('/v1/usage', { auth: k.key })).status, 200);
  const list = await (await call('/v1/admin/keys', { auth: admin })).json();
  assert.ok(list.keys.some((x) => x.id === k.id && x.key === undefined), 'plaintext keys are never listed');
  assert.equal((await call(`/v1/admin/keys/${k.id}`, { method: 'DELETE', auth: admin })).status, 200);
  assert.equal((await call('/v1/usage', { auth: k.key })).status, 401);
  const [stored] = await sql`SELECT key_hash FROM api_keys WHERE id = ${k.id}`;
  assert.notEqual(stored.key_hash, k.key);
});

test('CORS preflight, static demo and SDK', async () => {
  const pre = await fetch(`${base}/v1/foods/search`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(await (await fetch(`${base}/`)).text(), /Nutrikit/);
  assert.match((await fetch(`${base}/sdk/nutrikit.mjs`)).headers.get('content-type'), /javascript/);
});

test('OpenAPI spec documents every API route', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.1.0');
  const documented = new Set(Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));
  const api = app.routeTable.filter((r) => r.url.startsWith('/v1/') && r.method !== 'HEAD' && !r.hidden);
  assert.equal(api.length, 24, 'all /v1 routes are registered');
  for (const r of api) {
    const p = r.url.replace(/:(\w+)(\([^/]*\))?/g, '{$1}');
    assert.ok(documented.has(`${r.method} ${p}`), `${r.method} ${p} missing from openapi.json`);
  }
  for (const name of ['SearchResult', 'Food', 'LogResult', 'Error']) assert.ok(spec.components.schemas[name], `${name} schema`);
});

test('packaged-food search is a 503 when the server has no export, and is not charged', async () => {
  const r = await call('/v1/barcodes/search?q=parle');
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, 'packaged_foods_unavailable');
  assert.equal(r.headers.get('x-tokens-charged'), null);
  assert.equal((await call('/v1/barcodes/search?q=x&country=uk')).status, 400);
});

test('an Open Food Facts timeout is a 502, not a hung or 500 response', async () => {
  const timeout = async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  await sql`DELETE FROM barcode_cache WHERE code = '1234567890128'`;
  await assert.rejects(lookupBarcode(sql, '1234567890128', { fetch: timeout }), (e) => e.status === 502 && /did not respond/.test(e.message));
});
