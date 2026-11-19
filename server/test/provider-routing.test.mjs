// Provider routing safety: nutrition estimates use Gemini Flash-Lite only, and paid OpenAI is never called unless
// NUTRIKIT_OPENAI_FALLBACK is exactly "1", whatever keys are set and whichever route asks. Both endpoints are a local
// stub (told apart by path), so no real API is ever called.
import './helpers.mjs'; // a throwaway database for the API test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];
const completion = (json) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(json), refusal: null } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
const ESTIMATE = (q) => ({ query: q, known: true, name: q, per100g: { calories: 100, protein: 5, fat: 3, carbs: 13, fiber: 1, sugar: 1, saturatedFat: 1, sodium: 100 }, serving: { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 200 }, confidence: 'medium', sameAs: null });
// Gemini answers every task except estimates, which it fails (503), so any fallback would show up as a /v1/ request.
let geminiEstimates = 'fail';
const stub = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const task = body.response_format?.json_schema?.name;
  requests.push({ path: req.url, model: body.model, task });
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
  if (task === 'food_estimates') {
    if (req.url.startsWith('/gemini/') && geminiEstimates === 'fail') return send(503, { error: { message: 'high demand' } });
    const text = body.messages.at(-1).content.map((c) => c.text).join('');
    const names = [...text.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    return send(200, completion({ foods: names.map(ESTIMATE) }));
  }
  if (task === 'meal_items') return send(200, completion({ meal: null, notes: '', items: [{ food: 'zarblot stew', quantity: 1, unit: 'bowl', grams: 250, confidence: 'medium' }] }));
  if (task === 'nutrition_label') return send(200, completion({ isNutritionLabel: true, servingSize: '100 g', servingGrams: 100, servingsPerContainer: null, perServing: { calories: 100 } }));
  if (task === 'nutrition_advice') return send(200, completion({ answer: 'ok', declined: false }));
  return send(400, { error: { message: `unexpected task ${task}` } });
});
const openaiCalls = () => requests.filter((r) => r.path.startsWith('/v1/'));

const KEYS = ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'NUTRIKIT_OPENAI_FALLBACK', 'NUTRIKIT_GEMINI_MODEL', 'NUTRIKIT_OPENAI_MODEL', 'NUTRIKIT_AI_PROVIDER', 'ANTHROPIC_API_KEY'];
const base = () => `http://127.0.0.1:${stub.address().port}`;
const both = () => ({ GEMINI_API_KEY: 'g-test', GEMINI_BASE_URL: `${base()}/gemini/`, OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${base()}/v1/`, NUTRIKIT_OPENAI_MODEL: 'gpt-test' });

/** A provider built under exactly `env` (the routing keys not in it are unset). */
async function providerWith(env) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const { createOpenAIProvider } = await import('../src/domain/providers/openai.ts');
    return await createOpenAIProvider();
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

before(() => new Promise((r) => stub.listen(0, '127.0.0.1', r)));
after(() => stub.close());

test('default: nutrition estimates use Gemini Flash-Lite only', async () => {
  const p = await providerWith({ GEMINI_API_KEY: 'g-test', GEMINI_BASE_URL: `${base()}/gemini/` });
  assert.deepEqual(p.models.estimateFoods, ['gemini-3.5-flash-lite']);
  geminiEstimates = 'ok';
  const start = requests.length;
  await p.estimateFoods({ foods: ['upma'] });
  assert.deepEqual(requests.slice(start).map((r) => [r.path, r.model]), [['/gemini/chat/completions', 'gemini-3.5-flash-lite']]);
  geminiEstimates = 'fail';
});

test('OPENAI_API_KEY without the opt-in: OpenAI is not in any route, and a Gemini failure fails safely', async () => {
  process.env.NUTRIKIT_AI_TIMEOUT_MS = '600'; // a failing Gemini is retried until the deadline: keep it short
  for (const flag of [undefined, '0', 'true', 'yes', '', ' 1']) {
    const env = both();
    if (flag !== undefined) env.NUTRIKIT_OPENAI_FALLBACK = flag;
    const p = await providerWith(env);
    for (const [task, models] of Object.entries(p.models)) assert.ok(!models.includes('gpt-test'), `${task} with NUTRIKIT_OPENAI_FALLBACK=${JSON.stringify(flag)}`);
    const start = requests.length;
    await assert.rejects(p.estimateFoods({ foods: ['upma'] }));
    assert.equal(requests.slice(start).filter((r) => r.path.startsWith('/v1/')).length, 0, `no OpenAI request (flag ${JSON.stringify(flag)})`);
  }
  delete process.env.NUTRIKIT_AI_TIMEOUT_MS;
});

test('NUTRIKIT_OPENAI_FALLBACK=1: OpenAI is the fallback after Gemini', async () => {
  const p = await providerWith({ ...both(), NUTRIKIT_OPENAI_FALLBACK: '1' });
  assert.deepEqual(p.models.estimateFoods, ['gemini-3.5-flash-lite', 'gpt-test']);
  const start = requests.length;
  const out = await p.estimateFoods({ foods: ['upma'] });
  assert.equal(out.model, 'gpt-test');
  assert.deepEqual(requests.slice(start).map((r) => r.path), ['/gemini/chat/completions', '/v1/chat/completions']);
});

test('OPENAI_API_KEY alone: AI stays off rather than spending on OpenAI; opted in, OpenAI is used', async () => {
  const only = { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${base()}/v1/` };
  await assert.rejects(providerWith({ ...only, NUTRIKIT_AI_PROVIDER: 'openai' }), /NUTRIKIT_OPENAI_FALLBACK=1/);
  const { openaiKeyUsable, openaiAllowed } = await import('../src/domain/providers/openai.ts');
  assert.equal(openaiKeyUsable(only), false);
  assert.equal(openaiAllowed({ NUTRIKIT_OPENAI_FALLBACK: '0' }), false);
  assert.equal(openaiAllowed({ NUTRIKIT_OPENAI_FALLBACK: '1' }), true);
  assert.equal(openaiKeyUsable({ ...only, NUTRIKIT_OPENAI_FALLBACK: '1' }), true);
  // A Gemini key given through OPENAI_BASE_URL is not OpenAI and needs no opt-in.
  assert.equal(openaiKeyUsable({ OPENAI_API_KEY: 'g', OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai' }), true);
  const p = await providerWith({ ...only, NUTRIKIT_OPENAI_FALLBACK: '1', NUTRIKIT_OPENAI_MODEL: 'gpt-test' });
  assert.deepEqual(p.models.estimateFoods, ['gpt-test'], 'opted in, OpenAI alone serves estimates');
});

test('no route reaches OpenAI without the opt-in: text, voice, photo, label and advisor', async () => {
  // The app's own provider, built from the environment the way production builds it.
  Object.assign(process.env, both());
  delete process.env.NUTRIKIT_OPENAI_FALLBACK;
  delete process.env.NUTRIKIT_AI_PROVIDER;
  const { buildApp } = await import('../src/app.ts');
  const { getProvider } = await import('../src/domain/providers/index.ts');
  const provider = await getProvider();
  assert.equal(provider.name, 'openai');
  for (const models of Object.values(provider.models)) assert.ok(!models.includes('gpt-test'));
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const res = await fetch(`${url}/portal/api/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nutrikit-Portal': '1' }, body: JSON.stringify({ name: 'Routing Co', email: 'routing@example.test', password: 'correct horse battery' }) });
    const key = (await res.json()).firstKey.key;
    const call = (path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const start = requests.length;
    const statuses = [
      (await call('/v1/log/text', { text: '1 bowl zarblot stew', ai: true })).status, // parse on Gemini, estimate fails
      (await call('/v1/log/voice', { transcript: 'one bowl zarblot stew', ai: true })).status,
      (await call('/v1/log/photo', { image: 'aGVsbG8=', mediaType: 'image/png' })).status,
      (await call('/v1/labels/parse', { image: 'aGVsbG8=', mediaType: 'image/png' })).status,
      (await call('/v1/advisor', { question: 'Is dal a good source of protein?' })).status,
    ];
    const seen = requests.slice(start);
    assert.ok(seen.some((r) => r.task === 'food_estimates'), 'an estimate was attempted');
    assert.deepEqual(seen.filter((r) => r.path.startsWith('/v1/')), [], `no OpenAI request (statuses ${statuses})`);
    assert.ok(seen.filter((r) => r.task === 'food_estimates').every((r) => r.model === 'gemini-3.5-flash-lite'));
    assert.ok(statuses[0] >= 500, 'a failed estimate fails the call safely (no fallback)');
  } finally {
    await app.close();
  }
});

