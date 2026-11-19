// The OpenAI provider against a stub Chat Completions server: request shape, outputs, usage and errors.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];
let reply = () => ({ status: 200, body: completion({ meal: 'lunch', notes: '', items: [{ food: 'rice, white, cooked', quantity: 1, unit: 'cup', grams: 158, confidence: 'high' }] }) });

function completion(json, extra = {}) {
  return {
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(json), refusal: null }, ...extra }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  };
}

const stub = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const sent = JSON.parse(raw);
  requests.push({ path: req.url, auth: req.headers.authorization, body: sent });
  const answer = reply(requests.length, sent);
  if (answer.hang) return; // never answers: the provider's deadline has to end the call
  if (answer.delay) await new Promise((r) => setTimeout(r, answer.delay));
  const { status, body, headers } = answer;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
});

let provider;
before(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${stub.address().port}/v1/`;
  process.env.NUTRIKIT_OPENAI_MODEL = 'gpt-test';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.NUTRIKIT_AI_PROVIDER;
  const { getProvider } = await import('../src/domain/providers/index.ts');
  provider = await getProvider();
});
after(() => { stub.closeAllConnections(); stub.close(); });

test('OPENAI_API_KEY alone selects the OpenAI provider', () => {
  assert.equal(provider.name, 'openai');
  assert.equal(provider.model, 'gpt-test');
});

test('parseMeal sends a strict JSON-schema request and returns items with usage', async () => {
  const out = await provider.parseMeal({ text: 'a cup of rice' });
  const req = requests.at(-1);
  assert.equal(req.path, '/v1/chat/completions');
  assert.equal(req.auth, 'Bearer sk-test');
  assert.equal(req.body.model, 'gpt-test');
  assert.equal(req.body.response_format.type, 'json_schema');
  assert.equal(req.body.response_format.json_schema.strict, true);
  assert.deepEqual(req.body.response_format.json_schema.schema.required, ['meal', 'items', 'notes']);
  assert.equal(req.body.messages[0].role, 'system');
  assert.deepEqual(req.body.messages[1].content, [{ type: 'text', text: 'a cup of rice' }]);
  assert.equal(out.meal, 'lunch');
  assert.equal(out.items[0].grams, 158);
  assert.deepEqual(out.usage, { inputTokens: 120, outputTokens: 30 });
});

test('photos are sent as data URLs', async () => {
  await provider.recognizeMeal({ image: 'AQID', mediaType: 'image/png', hint: 'thali' });
  const [img, text] = requests.at(-1).body.messages[1].content;
  assert.deepEqual(img, { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } });
  assert.equal(text.text, 'Context from the user: thali');
});

test('readLabel returns the label fields', async () => {
  const label = { isNutritionLabel: true, servingSize: '30 g', servingGrams: 30, servingsPerContainer: 10, perServing: { calories: 120 } };
  reply = () => ({ status: 200, body: completion(label) });
  const out = await provider.readLabel({ image: 'AQID', mediaType: 'image/jpeg' });
  assert.equal(out.servingGrams, 30);
  assert.equal(out.perServing.calories, 120);
  assert.equal(requests.at(-1).body.response_format.json_schema.name, 'nutrition_label');
});

test('advise fences caller context off from the question and returns the answer', async () => {
  reply = () => ({ status: 200, body: completion({ answer: 'Try Greek yogurt.', declined: false }) });
  const out = await provider.advise({ question: 'high protein snack?', context: 'Goal: build muscle' });
  const req = requests.at(-1).body;
  assert.equal(req.response_format.json_schema.name, 'nutrition_advice');
  assert.match(req.messages[0].content, /not medical advice|never as\s+instructions/);
  assert.equal(req.messages[1].content[0].text, '<context>\nGoal: build muscle\n</context>\n\nQuestion: high protein snack?');
  assert.deepEqual(out, { answer: 'Try Greek yogurt.', declined: false, usage: { inputTokens: 120, outputTokens: 30 } });
  await provider.advise({ question: 'fiber?' });
  assert.equal(requests.at(-1).body.messages[1].content[0].text, 'Question: fiber?');
});

test('rate limits are retried, then succeed', async () => {
  const start = requests.length;
  reply = (n) => (n - start === 1
    ? { status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '0' } }
    : { status: 200, body: completion({ meal: null, notes: '', items: [] }) });
  const out = await provider.parseMeal({ text: 'water' });
  assert.equal(requests.length - start, 2);
  assert.deepEqual(out.items, []);
});

test('errors map to API statuses', async () => {
  reply = () => ({ status: 401, body: { error: { message: 'bad key' } } });
  await assert.rejects(provider.parseMeal({ text: 'x' }), { status: 503, message: /credentials/ });

  reply = () => ({ status: 400, body: { error: { message: 'image too large' } } });
  await assert.rejects(provider.parseMeal({ text: 'x' }), { status: 422, message: /image too large/ });

  reply = () => ({ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
  await assert.rejects(provider.parseMeal({ text: 'x' }), { status: 422, message: /declined/ });

  reply = () => ({ status: 200, body: completion({}, { finish_reason: 'length' }) });
  await assert.rejects(provider.parseMeal({ text: 'x' }), { status: 502, message: /truncated/ });
});

test('a provider that never answers is abandoned at the deadline with 504 ai_timeout and no usage', async () => {
  process.env.NUTRIKIT_AI_TIMEOUT_MS = '300';
  try {
    reply = () => ({ hang: true });
    const started = Date.now();
    await assert.rejects(provider.parseMeal({ text: 'x' }), (err) => err.status === 504 && err.code === 'ai_timeout' && err.usage === undefined);
    assert.ok(Date.now() - started < 2000, 'one deadline covers the retries');
  } finally {
    delete process.env.NUTRIKIT_AI_TIMEOUT_MS;
  }
});

test('a Retry-After longer than the deadline is not waited for', async () => {
  process.env.NUTRIKIT_AI_TIMEOUT_MS = '500';
  try {
    const start = requests.length;
    reply = () => ({ status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '30' } });
    const started = Date.now();
    await assert.rejects(provider.parseMeal({ text: 'x' }), { status: 503, message: /rate limited/ });
    assert.ok(Date.now() - started < 400, `took ${Date.now() - started} ms`);
    assert.equal(requests.length - start, 1);
  } finally {
    delete process.env.NUTRIKIT_AI_TIMEOUT_MS;
  }
});

test('a wait between retries ends when the deadline does', async () => {
  // The caller's shared deadline (100 ms) ends during the 1 s wait the server asked for: the call ends then, as a timeout.
  reply = () => ({ status: 500, body: { error: { message: 'oops' } }, headers: { 'retry-after': '1' } });
  const started = Date.now();
  await assert.rejects(provider.estimateFoods({ foods: ['dal'], signal: AbortSignal.timeout(100) }), (err) => err.status === 504 && err.code === 'ai_timeout');
  assert.ok(Date.now() - started < 600, `took ${Date.now() - started} ms`);
});

test('a shared deadline with little time left is measured as such: a longer Retry-After is answered at once', async () => {
  // The second estimate attempt shares the first one's deadline; only 300 ms of the 60 s remain.
  const { aiDeadline } = await import('../src/domain/providers/index.ts');
  const signal = Object.assign(aiDeadline(), { endsAt: Date.now() + 300 });
  reply = () => ({ status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '1' } });
  const started = Date.now();
  await assert.rejects(provider.estimateFoods({ foods: ['dal'], signal }), { status: 503, message: /rate limited/ });
  assert.ok(Date.now() - started < 250, `took ${Date.now() - started} ms`);
});

test('an answer that is not JSON is a 502 that still carries its usage', async () => {
  reply = () => ({ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: 'Sure! Here is rice.', refusal: null } }], usage: { prompt_tokens: 9, completion_tokens: 4 } } });
  await assert.rejects(provider.parseMeal({ text: 'x' }), (err) => err.status === 502 && /malformed/.test(err.message) && err.usage?.inputTokens === 9);
});

// Models per task, tried in order: a second provider built with its own env, so the tests above keep one model.
const estimate = (query) => completion({ foods: [{ query, known: true, name: query, per100g: { calories: 100, protein: 1, fat: 1, carbs: 1, fiber: 1, sugar: 1, saturatedFat: 1, sodium: 1 }, serving: { label: '1 bowl', unit: 'bowl', grams: 200 }, confidence: 'high', sameAs: null }] });

async function routedProvider(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    const { createOpenAIProvider } = await import('../src/domain/providers/openai.ts');
    return await createOpenAIProvider();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('each task uses its own models, and the rest use NUTRIKIT_OPENAI_MODEL', async () => {
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_TEXT: 'light', NUTRIKIT_OPENAI_MODEL_ESTIMATE: ' big , small ' });
  assert.deepEqual(p.models.parseMeal, ['light']);
  assert.deepEqual(p.models.estimateFoods, ['big', 'small']);
  assert.deepEqual(p.models.advise, ['gpt-test']);
  assert.equal(p.model, 'gpt-test');
  reply = () => ({ status: 200, body: completion({ meal: null, notes: '', items: [] }) });
  await p.parseMeal({ text: 'tea' });
  assert.equal(requests.at(-1).body.model, 'light');
  reply = () => ({ status: 200, body: completion({ answer: 'ok', declined: false }) });
  await p.advise({ question: 'fiber?' });
  assert.equal(requests.at(-1).body.model, 'gpt-test');
});

test('a busy or rate-limited model hands the call to the next one at once, which is reported as the model', async () => {
  for (const status of [503, 429, 404]) {
    const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_ESTIMATE: 'big,small' });
    const start = requests.length;
    reply = (n, body) => (body.model === 'big'
      ? { status, body: { error: { message: 'busy' } }, headers: { 'retry-after': '5' } }
      : { status: 200, body: estimate('dal') });
    const out = await p.estimateFoods({ foods: ['dal'] });
    assert.deepEqual(requests.slice(start).map((r) => r.body.model), ['big', 'small'], `after ${status}`);
    assert.equal(out.model, 'small');
    assert.equal(out.foods[0].name, 'dal');
  }
});

test('a model that is too slow is left after NUTRIKIT_AI_FALLBACK_AFTER_MS for the next one', async () => {
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_ESTIMATE: 'big,small', NUTRIKIT_AI_FALLBACK_AFTER_MS: '200' });
  reply = (n, body) => (body.model === 'big' ? { hang: true } : { status: 200, body: estimate('poha') });
  const started = Date.now();
  const out = await p.estimateFoods({ foods: ['poha'] });
  assert.equal(out.model, 'small');
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});

test('errors another model would share are not handed on, and the last model still retries', async () => {
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_TEXT: 'big,small' });
  let start = requests.length;
  reply = () => ({ status: 401, body: { error: { message: 'bad key' } } });
  await assert.rejects(p.parseMeal({ text: 'x' }), { status: 503, message: /credentials/ });
  assert.equal(requests.length - start, 1);

  start = requests.length;
  let smallCalls = 0;
  reply = (n, body) => (body.model === 'big' || ++smallCalls === 1
    ? { status: 503, body: { error: { message: 'busy' } }, headers: { 'retry-after': '0' } }
    : { status: 200, body: completion({ meal: null, notes: '', items: [] }) });
  await p.parseMeal({ text: 'x' });
  assert.deepEqual(requests.slice(start).map((r) => r.body.model), ['big', 'small', 'small']);
});

test('on Gemini with no model set, heavy and light tasks get built-in models; variables still win', async () => {
  const gemini = { OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', NUTRIKIT_OPENAI_MODEL: '' };
  const p = await routedProvider(gemini);
  assert.deepEqual(p.models.parseMeal, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
  assert.deepEqual(p.models.advise, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
  for (const task of ['recognizeMeal', 'readLabel', 'estimateFoods']) {
    assert.deepEqual(p.models[task], ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], task);
  }
  assert.equal(p.model, 'gemini-3.1-flash-lite');
  const custom = await routedProvider({ ...gemini, NUTRIKIT_OPENAI_MODEL_PHOTO: 'my-model' });
  assert.deepEqual(custom.models.recognizeMeal, ['my-model']);
  assert.deepEqual(custom.models.readLabel, ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  const all = await routedProvider({ ...gemini, NUTRIKIT_OPENAI_MODEL: 'one' });
  assert.deepEqual(all.models.estimateFoods, ['one']);
  // Not Gemini: the OpenAI default, as before.
  const openai = await routedProvider({ OPENAI_BASE_URL: 'https://api.openai.com/v1', NUTRIKIT_OPENAI_MODEL: '' });
  assert.deepEqual(openai.models.estimateFoods, ['gpt-5-mini']);
});

// Gemini first, OpenAI as the fallback: both endpoints are the stub, told apart by path and key.
const both = () => ({ GEMINI_API_KEY: 'g-test', GEMINI_BASE_URL: `http://127.0.0.1:${stub.address().port}/gemini/`, NUTRIKIT_OPENAI_MODEL: 'gpt-test' });

test('with GEMINI_API_KEY and OPENAI_API_KEY, each task tries its Gemini models, then OpenAI', async () => {
  const p = await routedProvider(both());
  assert.deepEqual(p.models.parseMeal, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gpt-test']);
  assert.deepEqual(p.models.estimateFoods, ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gpt-test']);
  assert.equal(p.model, 'gemini-3.1-flash-lite');

  let start = requests.length;
  reply = () => ({ status: 200, body: completion({ meal: null, notes: '', items: [] }) });
  await p.parseMeal({ text: 'tea' });
  assert.deepEqual(requests.slice(start).map((r) => [r.path, r.auth, r.body.model]), [['/gemini/chat/completions', 'Bearer g-test', 'gemini-3.1-flash-lite']]);

  start = requests.length;
  reply = (n, body) => (body.model.startsWith('gemini')
    ? { status: 503, body: { error: { message: 'high demand' } } }
    : { status: 200, body: estimate('upma') });
  const out = await p.estimateFoods({ foods: ['upma'] });
  assert.equal(out.model, 'gpt-test');
  assert.deepEqual(requests.slice(start).map((r) => r.path), ['/gemini/chat/completions', '/gemini/chat/completions', '/gemini/chat/completions', '/v1/chat/completions']);
  assert.equal(requests.at(-1).auth, 'Bearer sk-test');
});

test('when Gemini refuses the key, OpenAI is asked next, skipping the other Gemini models', async () => {
  const p = await routedProvider(both());
  const start = requests.length;
  reply = (n, body) => (body.model.startsWith('gemini')
    ? { status: 403, body: { error: { message: 'permission denied' } } }
    : { status: 200, body: completion({ answer: 'ok', declined: false }) });
  const out = await p.advise({ question: 'fiber?' });
  assert.equal(out.answer, 'ok');
  // A refused key would be refused for Gemini's other models too: OpenAI is asked next.
  assert.deepEqual(requests.slice(start).map((r) => r.body.model), ['gemini-3.1-flash-lite', 'gpt-test']);
});

test('slow models share the deadline, so the OpenAI fallback still has time to answer', async () => {
  process.env.NUTRIKIT_AI_TIMEOUT_MS = '1200';
  try {
    const p = await routedProvider(both());
    reply = (n, body) => (body.model.startsWith('gemini') ? { hang: true } : { status: 200, body: estimate('poha') });
    const started = Date.now();
    const out = await p.estimateFoods({ foods: ['poha'] });
    assert.equal(out.model, 'gpt-test');
    assert.ok(Date.now() - started < 1200, `took ${Date.now() - started} ms`);
  } finally {
    delete process.env.NUTRIKIT_AI_TIMEOUT_MS;
  }
});

test('GEMINI_API_KEY alone uses Gemini with its built-in models', async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const p = await routedProvider({ ...both(), NUTRIKIT_OPENAI_MODEL: '' });
    assert.deepEqual(p.models.readLabel, ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    assert.deepEqual(p.models.advise, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
    const custom = await routedProvider({ ...both(), NUTRIKIT_GEMINI_MODEL_TEXT: 'gemini-x' });
    assert.deepEqual(custom.models.parseMeal, ['gemini-x']);
  } finally {
    process.env.OPENAI_API_KEY = saved;
  }
});

// Review fixes: config guard, fallback time, bad answers, 400s, resting models, logging.
test('GEMINI_API_KEY with OPENAI_BASE_URL on Gemini is refused: the OpenAI key would go to Google', async () => {
  const { aiConfigProblem } = await import('../src/domain/providers/openai.ts');
  const env = { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai' };
  assert.match(aiConfigProblem(env), /OPENAI_API_KEY would be sent to Google/);
  assert.equal(aiConfigProblem({ ...env, OPENAI_BASE_URL: undefined }), null);
  assert.equal(aiConfigProblem({ ...env, GEMINI_API_KEY: undefined }), null);
  const { configProblems } = await import('../src/app.ts');
  assert.equal(configProblems({ ...env, NODE_ENV: 'development' }).length, 1);
  await assert.rejects(routedProvider({ GEMINI_API_KEY: 'g', OPENAI_BASE_URL: env.OPENAI_BASE_URL }), /sent to Google/);
});

test('with a fallback endpoint, hanging Gemini models leave OpenAI half the deadline', async () => {
  process.env.NUTRIKIT_AI_TIMEOUT_MS = '1000';
  try {
    const p = await routedProvider(both());
    // OpenAI needs 400 ms: an even split of 1 s over four models (250 ms) would time it out.
    reply = (n, body) => (body.model.startsWith('gemini') ? { hang: true } : { status: 200, body: estimate('dal'), delay: 400 });
    const out = await p.estimateFoods({ foods: ['dal'] });
    assert.equal(out.model, 'gpt-test');
  } finally {
    delete process.env.NUTRIKIT_AI_TIMEOUT_MS;
  }
});

test('a truncated, empty or malformed answer goes to the next model, and its tokens are charged with the call', async () => {
  for (const bad of [
    completion({}, { finish_reason: 'length' }),
    { choices: [{ finish_reason: 'stop', message: { content: null } }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    { choices: [{ finish_reason: 'stop', message: { content: 'Sure! rice' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
  ]) {
    const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_TEXT: 'big,small' });
    reply = (n, body) => (body.model === 'big' ? { status: 200, body: bad } : { status: 200, body: completion({ meal: null, notes: '', items: [] }) });
    const out = await p.parseMeal({ text: 'rice' });
    assert.deepEqual(out.usage, { inputTokens: 240, outputTokens: 60 });
  }
  // The last model failing too: the error carries both answers' tokens.
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_TEXT: 'big,small' });
  reply = () => ({ status: 200, body: completion({}, { finish_reason: 'length' }) });
  await assert.rejects(p.parseMeal({ text: 'rice' }), (err) => err.status === 502 && err.usage.inputTokens === 240);
});

test('a refusal is the answer: no other model is asked', async () => {
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_ADVICE: 'big,small' });
  const start = requests.length;
  reply = () => ({ status: 200, body: { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
  await assert.rejects(p.advise({ question: 'dose?' }), { status: 422, message: /declined/ });
  assert.equal(requests.length - start, 1);
});

test('a 400 goes to the next model on the same endpoint (it may be that model\'s own limit)', async () => {
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_PHOTO: 'no-json,small' });
  reply = (n, body) => (body.model === 'no-json'
    ? { status: 400, body: { error: { message: 'JSON mode is not enabled for this model' } } }
    : { status: 200, body: completion({ meal: null, notes: '', items: [] }) });
  await p.recognizeMeal({ image: 'AQID', mediaType: 'image/png' });
  assert.equal(requests.at(-1).body.model, 'small');
  // Bad input fails on every model: the last one's error is the answer.
  reply = () => ({ status: 400, body: { error: { message: 'image too large' } } });
  await assert.rejects(p.recognizeMeal({ image: 'AQID', mediaType: 'image/png' }), { status: 422, message: /image too large/ });
});

test('a busy model rests for NUTRIKIT_AI_COOLDOWN_MS, so later calls skip it; 0 turns that off', async () => {
  const busyBig = (n, body) => (body.model === 'big' ? { status: 503, body: { error: { message: 'busy' } } } : { status: 200, body: estimate('dal') });
  let p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_ESTIMATE: 'big,small' });
  reply = busyBig;
  await p.estimateFoods({ foods: ['dal'] });
  let start = requests.length;
  await p.estimateFoods({ foods: ['dal'] });
  assert.deepEqual(requests.slice(start).map((r) => r.body.model), ['small']);

  p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_ESTIMATE: 'big,small', NUTRIKIT_AI_COOLDOWN_MS: '0' });
  await p.estimateFoods({ foods: ['dal'] });
  start = requests.length;
  await p.estimateFoods({ foods: ['dal'] });
  assert.deepEqual(requests.slice(start).map((r) => r.body.model), ['big', 'small']);
});

test('NUTRIKIT_AI_FALLBACK_AFTER_MS=0 moves on from a model that has not answered at once', async () => {
  const p = await routedProvider({ NUTRIKIT_OPENAI_MODEL_ESTIMATE: 'big,small', NUTRIKIT_AI_FALLBACK_AFTER_MS: '0' });
  reply = (n, body) => (body.model === 'big' ? { hang: true } : { status: 200, body: estimate('dal') });
  const started = Date.now();
  assert.equal((await p.estimateFoods({ foods: ['dal'] })).model, 'small');
  assert.ok(Date.now() - started < 150, `took ${Date.now() - started} ms`);
});

test('each fallback is logged, naming the endpoint it falls back to', async () => {
  const { setAILog } = await import('../src/domain/providers/index.ts');
  const logged = [];
  setAILog({ warn: (obj, msg) => logged.push({ obj, msg }) });
  try {
    const p = await routedProvider(both());
    reply = (n, body) => (body.model.startsWith('gemini') ? { status: 429, body: { error: { message: 'quota' } } } : { status: 200, body: completion({ answer: 'ok', declined: false }) });
    await p.advise({ question: 'fiber?' });
    assert.deepEqual(logged.map((l) => l.msg), ['AI model failed; trying the next model', 'AI model failed; falling back to openai']);
    assert.equal(logged[1].obj.model, 'gemini-3.5-flash-lite');
    assert.equal(logged[1].obj.next, 'gpt-test');
    assert.equal(logged[1].obj.status, 503);
  } finally {
    setAILog({ warn: () => {} });
  }
});
