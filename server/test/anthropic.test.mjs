// The Claude provider's deadline, against a stub Messages API that never answers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let requests = 0;
const stub = http.createServer((req) => { requests++; req.resume(); }); // accepts the request, never answers

let provider;
before(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  const { createAnthropicProvider } = await import('../src/domain/providers/anthropic.ts');
  provider = await createAnthropicProvider();
});
after(() => { stub.closeAllConnections(); stub.close(); });

test('a hung Messages API call answers 504 ai_timeout within the deadline, retries included', async () => {
  process.env.NUTRIKIT_AI_TIMEOUT_MS = '300';
  const started = Date.now();
  await assert.rejects(provider.parseMeal({ text: 'a cup of rice' }), (err) => err.status === 504 && err.code === 'ai_timeout' && err.usage === undefined);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.ok(requests >= 1);
});

test('an answer that is not JSON is a 502 that still carries its usage', async () => {
  const answering = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: 'Here is your meal: rice.' }], usage: { input_tokens: 11, output_tokens: 6 },
    }));
  });
  await new Promise((r) => answering.listen(0, '127.0.0.1', r));
  const hung = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${answering.address().port}`;
  try {
    const { createAnthropicProvider } = await import('../src/domain/providers/anthropic.ts');
    const p = await createAnthropicProvider();
    await assert.rejects(p.parseMeal({ text: 'rice' }), (err) => err.status === 502 && /malformed/.test(err.message) && err.usage?.inputTokens === 11 && err.usage?.outputTokens === 6);
  } finally {
    process.env.ANTHROPIC_BASE_URL = hung;
    answering.closeAllConnections();
    answering.close();
  }
});
