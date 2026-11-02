import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Nutrikit } from '@nutrikit/sdk';
import { createServer } from '../src/server.ts';

// A fake API: records each request and answers by path.
const requests: { method: string; path: string; query: Record<string, string>; body: any }[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  requests.push({ method: init?.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body });
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/v1/barcodes/0000000000000') return json(404, { error: { code: 'not_found', message: 'product not found' } });
  if (url.pathname === '/v1/usage') return json(429, { error: { code: 'quota_exceeded', message: 'monthly allowance used' } });
  if (url.pathname === '/v1/nutrients') return json(200, { nutrients: [{ key: 'protein', name: 'Protein', unit: 'g', dailyValue: 50, group: 'macro' }] });
  return json(200, { ok: true, path: url.pathname });
};

const client = new Client({ name: 'test', version: '0' });
let dir: string;

before(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(new Nutrikit({ apiKey: 'nk_test', baseUrl: 'http://api.test', fetch: fakeFetch, maxRetries: 0 })).connect(serverSide);
  await client.connect(clientSide);
  dir = await mkdtemp(join(tmpdir(), 'nutrikit-mcp-'));
});
after(async () => { await client.close(); await rm(dir, { recursive: true, force: true }); });

const callTool = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<any>;
const last = () => requests.at(-1)!;

test('lists every tool with read-only annotations', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'create_meal_plan', 'get_food_nutrients', 'get_usage', 'log_meal_photo', 'log_meal_text',
    'lookup_barcode', 'parse_nutrition_label', 'search_foods',
  ]);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint));
});

test('tools map onto the API', async () => {
  const r = await callTool('search_foods', { query: 'greek yogurt' });
  assert.equal(r.isError, undefined);
  assert.deepEqual(r.structuredContent, { ok: true, path: '/v1/foods/search' });
  assert.deepEqual(last().query, { q: 'greek yogurt', limit: '10' });

  await callTool('get_food_nutrients', { foodId: 42, quantity: 2, unit: 'cup' });
  assert.equal(last().path, '/v1/foods/42/nutrients');
  assert.deepEqual(last().query, { quantity: '2', unit: 'cup' });

  await callTool('log_meal_text', { text: '2 eggs and toast', ai: true });
  assert.deepEqual(last().body, { text: '2 eggs and toast', ai: true });

  await callTool('create_meal_plan', { calories: 1800, diet: 'vegetarian', exclude: ['peanut'] });
  assert.deepEqual(last().body, { calories: 1800, diet: 'vegetarian', exclude: ['peanut'] });

  await callTool('parse_nutrition_label', { text: 'Serving size 30g Calories 100' });
  assert.deepEqual(last().body, { text: 'Serving size 30g Calories 100' });
});

test('photo tools read local images', async () => {
  const photo = join(dir, 'lunch.PNG');
  await writeFile(photo, Buffer.from([1, 2, 3]));
  await callTool('log_meal_photo', { imagePath: photo, hint: 'thali' });
  assert.deepEqual(last().body, { image: 'AQID', mediaType: 'image/png', hint: 'thali' });

  await callTool('parse_nutrition_label', { imagePath: photo });
  assert.deepEqual(last().body, { image: 'AQID', mediaType: 'image/png' });

  const bad = await callTool('log_meal_photo', { imagePath: join(dir, 'notes.txt') });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /unsupported image type/);
});

test('API and input errors come back as tool errors', async () => {
  const notFound = await callTool('lookup_barcode', { barcode: '0000000000000' });
  assert.equal(notFound.isError, true);
  assert.match(notFound.content[0].text, /not_found.*product not found/);

  const quota = await callTool('get_usage');
  assert.match(quota.content[0].text, /quota_exceeded.*allowance is used up/);

  const empty = await callTool('parse_nutrition_label', {});
  assert.match(empty.content[0].text, /either text or imagePath/);

  const invalid = await callTool('lookup_barcode', { barcode: 'abc' });
  assert.equal(invalid.isError, true);
});

test('nutrient reference is a resource', async () => {
  const { contents } = await client.readResource({ uri: 'nutrikit://nutrients' });
  assert.equal(JSON.parse(String(contents[0].text)).nutrients[0].key, 'protein');
});
