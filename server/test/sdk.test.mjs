import { fakeProvider, sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { createKey } from '../src/domain/auth.ts';
import { Nutrikit, NutrikitError } from '../../sdk/js/nutrikit.mjs';

const app = await buildApp();

let nk;
const provider = fakeProvider();

before(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  setProvider(provider);
  nk = new Nutrikit({ apiKey: (await createKey(sql, { name: 'sdk' })).key, baseUrl: `http://127.0.0.1:${app.server.address().port}/` });
});
after(() => app.close());

test('SDK covers the API surface end to end', async () => {
  const s = await nk.searchFoods('greek yogurt', { limit: 2 });
  assert.equal(s.results.length, 2);
  assert.deepEqual(nk.lastUsage, { charged: 1, remaining: null });
  const food = await nk.getFood(s.results[0].id);
  const n = await nk.getNutrients(food.id, { grams: 170 });
  assert.equal(n.grams, 170);
  assert.ok((await nk.listNutrients()).nutrients.length > 30);
  const log = await nk.logText('2 eggs and toast');
  assert.equal(log.items.length, 2);
  const voice = await nk.logVoice('uh a banana');
  assert.equal(voice.transcript, 'a banana');
  const photo = await nk.logPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { mediaType: 'image/jpeg' });
  assert.equal(photo.items.length, 3);
  assert.equal(provider.calls.at(-1)[1].image, Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'));
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const label = await nk.parseLabel({ image: blob });
  assert.equal(label.source, 'image');
  assert.equal(provider.calls.at(-1)[1].mediaType, 'image/png');
  assert.equal((await nk.parseLabel({ text: 'Serving size 30g Calories 100' })).perServing.calories.amount, 100);
  const plan = await nk.createMealPlan({ calories: 2000, seed: 1 });
  assert.equal(plan.seed, 1);
  const usage = await nk.getUsage();
  assert.ok(usage.used > 0);
});

test('SDK raises typed errors', async () => {
  await assert.rejects(nk.getFood(999999999), (e) => e instanceof NutrikitError && e.status === 404 && e.code === 'not_found');
  await assert.rejects(nk.lookupBarcode('3017624010702'), (e) => e.code === 'invalid_barcode');
  await assert.rejects(new Nutrikit({ apiKey: 'nk_bad', baseUrl: nk.baseUrl }).searchFoods('x'), (e) => e.status === 401);
  assert.throws(() => new Nutrikit({}), TypeError);
  await assert.rejects(nk.logPhoto(42), TypeError);
});

test('SDK retries 503/429 with Retry-After but not quota errors', async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 'ai_unavailable', message: 'busy' } }), { status: 503, headers: { 'Retry-After': '0' } });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Tokens-Charged': '1' } });
  };
  const c = new Nutrikit({ apiKey: 'k', fetch: flaky });
  assert.deepEqual(await c.getUsage(), { ok: true });
  assert.equal(calls, 2);

  let quotaCalls = 0;
  const quota = async () => { quotaCalls++; return new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'no' } }), { status: 429 }); };
  await assert.rejects(new Nutrikit({ apiKey: 'k', fetch: quota }).getUsage(), (e) => e.code === 'quota_exceeded');
  assert.equal(quotaCalls, 1);

  let always = 0;
  const down = async () => { always++; return new Response('{}', { status: 502, headers: { 'Retry-After': '0' } }); };
  await assert.rejects(new Nutrikit({ apiKey: 'k', fetch: down, maxRetries: 2 }).getUsage(), (e) => e.status === 502);
  assert.equal(always, 3);
});

test('browser-only helpers fail clearly in Node', async () => {
  await assert.rejects(Nutrikit.listen(), (e) => e.code === 'unsupported');
  await assert.rejects(Nutrikit.scanBarcode({}), (e) => e.code === 'unsupported');
});
