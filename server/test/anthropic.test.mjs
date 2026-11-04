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
