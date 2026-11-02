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
  requests.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
  const { status, body, headers } = reply(requests.length);
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
  delete process.env.NUTRIKIT_AI_PROVIDER;
  const { getProvider } = await import('../src/domain/providers/index.ts');
  provider = await getProvider();
});
after(() => stub.close());

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
