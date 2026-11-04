// Allowance reservation, settlement and failed-call charging (api-metering spec).
import { fakeProvider, seedUsage, sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { createKey } from '../src/domain/auth.ts';

const app = await buildApp();
let base;
before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const call = (key, path, body) => fetch(base + path, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const photo = (key) => call(key, '/v1/log/photo', { image: PNG, mediaType: 'image/png' });

/** An operator key with its own allowance, `used` tokens of it already spent this month. */
async function keyWith(limit, used = 0) {
  const k = await createKey(sql, { name: `limit ${limit}`, tokenLimit: limit });
  if (used) await seedUsage({ keyId: k.id, tokens: used });
  return k;
}
const counter = async (keyId) => (await sql`SELECT used FROM usage_periods WHERE subject = ${`key:${keyId}`}`)[0]?.used ?? 0;
const history = async (keyId) => (await sql`SELECT COALESCE(SUM(tokens), 0) AS t FROM usage WHERE key_id = ${keyId}`)[0].t;

test('concurrent calls near the limit: at most one runs, the rest are quota_exceeded', async () => {
  const provider = fakeProvider();
  setProvider(provider);
  const k = await keyWith(1000, 980); // 20 left; a photo costs 20 + AI tokens
  const results = await Promise.all(Array.from({ length: 10 }, () => photo(k.key)));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 1, `exactly one call ran: ${statuses}`);
  assert.equal(statuses.filter((s) => s === 429).length, 9);
  for (const r of results.filter((x) => x.status === 429)) assert.equal((await r.json()).error.code, 'quota_exceeded');
  assert.equal(provider.calls.length, 1, 'refused calls never reached the provider');
  // 1,900 model tokens -> 2 AI tokens: the overrun is at most one call's AI tokens.
  assert.equal(await counter(k.id), 1002);
  assert.equal((await photo(k.key)).status, 429);
});

test('a successful AI call settles to flat cost + AI tokens', async () => {
  setProvider(fakeProvider());
  const k = await keyWith(1000);
  const res = await photo(k.key);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-tokens-charged'), '22'); // 20 + ceil(1,900 / 1,000)
  assert.equal(res.headers.get('x-tokens-remaining'), '978');
  assert.equal(await counter(k.id), 22);
  assert.equal(await history(k.id), 22);
});

test('labels/parse with text reserves the image cost but settles to the text cost', async () => {
  const k = await keyWith(1000);
  const res = await call(k.key, '/v1/labels/parse', { text: 'Serving size 30g\nCalories 120\nTotal Fat 3g' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-tokens-charged'), '5');
  assert.equal(await counter(k.id), 5);
});

test('an AI refusal charges only the AI tokens used, and says so on the error', async () => {
  setProvider({
    name: 'refuser',
    async recognizeMeal() { throw Object.assign(new Error('the AI provider declined this request'), { status: 422, usage: { inputTokens: 1200, outputTokens: 300 } }); },
  });
  const k = await keyWith(1000);
  const res = await photo(k.key);
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('x-tokens-charged'), '2');
  assert.equal(res.headers.get('x-tokens-remaining'), '998');
  assert.equal(await counter(k.id), 2);
  assert.deepEqual((await sql`SELECT endpoint, tokens FROM usage WHERE key_id = ${k.id}`).map((r) => ({ ...r })), [{ endpoint: 'logPhoto', tokens: 2 }]);
});

test('a label photo that is not a label still charges the AI tokens it used', async () => {
  setProvider({
    name: 'reader',
    async readLabel() { return { isNutritionLabel: false, perServing: {}, usage: { inputTokens: 900, outputTokens: 200 } }; },
  });
  const k = await keyWith(1000);
  const res = await call(k.key, '/v1/labels/parse', { image: PNG, mediaType: 'image/png' });
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('x-tokens-charged'), '2');
  assert.equal(await counter(k.id), 2);
});

test('failures without AI usage cost nothing and release the reservation', async () => {
  setProvider({ name: 'slow', async recognizeMeal() { throw Object.assign(new Error('the AI provider did not answer in time; try again'), { status: 504, code: 'ai_timeout' }); } });
  const k = await keyWith(1000);

  const timeout = await photo(k.key);
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).error.code, 'ai_timeout');
  assert.equal(timeout.headers.get('x-tokens-charged'), null);

  const invalid = await call(k.key, '/v1/log/text', { text: '' }); // schema validation, after the reservation
  assert.equal(invalid.status, 400);
  const badImage = await call(k.key, '/v1/log/photo', { image: 'not base64!', mediaType: 'image/png' });
  assert.equal(badImage.status, 400);

  assert.equal(await counter(k.id), 0, 'every reservation was released');
  assert.equal(await history(k.id), 0);
});

test('GET /v1/usage `used` matches the allowance counter', async () => {
  setProvider(fakeProvider());
  const k = await keyWith(1000);
  await call(k.key, '/v1/foods/search?q=egg');
  await photo(k.key);
  await call(k.key, '/v1/log/text', { text: '' }); // failed, free
  const usage = await (await call(k.key, '/v1/usage')).json();
  assert.equal(usage.used, 23);
  assert.equal(usage.used, await counter(k.id));
  assert.equal(usage.used, await history(k.id));
  assert.equal(usage.remaining, 977);
  assert.deepEqual(usage.byEndpoint.map((e) => e.endpoint).sort(), ['logPhoto', 'search']);
});

test('the rate limit is checked before any allowance is reserved', async () => {
  const k = await keyWith(1000);
  await sql`INSERT INTO rate_windows (bucket, window_start, count) VALUES (${`key:${k.id}`}, clock_timestamp(), 1000)`;
  const res = await call(k.key, '/v1/foods/search?q=egg');
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, 'rate_limited');
  assert.ok(Number(res.headers.get('retry-after')) >= 1);
  assert.equal(await counter(k.id), 0);
});

test('usage:reconcile rebuilds a corrupted month from the usage history', async () => {
  const { reconcileUsage } = await import('../src/domain/auth.ts');
  setProvider(fakeProvider());
  const k = await keyWith(1000);
  await photo(k.key); // 22
  await call(k.key, '/v1/foods/search?q=egg'); // 1
  await sql`UPDATE usage_periods SET used = 999 WHERE subject = ${`key:${k.id}`}`;
  const month = new Date().toISOString().slice(0, 7);
  assert.ok(await reconcileUsage(sql, month) >= 1);
  assert.equal(await counter(k.id), 23);
  assert.equal((await call(k.key, '/v1/foods/search?q=egg')).headers.get('x-tokens-remaining'), '976');
  await assert.rejects(reconcileUsage(sql, '2026-13'), /YYYY-MM/);
});
