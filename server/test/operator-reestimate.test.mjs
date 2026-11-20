// Operator re-estimate (task M5.5): an operator can ask the AI again for one food, whatever its status. A new estimate
// that passes the checks replaces the current one (kept in the history) and goes back to pending review; a failed or
// rejected answer changes nothing but the failure list. Providers are mocked: no AI call is made.
import { sql } from './helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { setProvider } from '../src/domain/providers/index.ts';
import { ESTIMATE_PROMPT_VERSION } from '../src/domain/providers/prompts.ts';
import { ESTIMATE_CALC_VERSION, reestimateFoodRequest } from '../src/domain/foodrequests.ts';

const GOOD = { calories: 120, protein: 6, fat: 4, carbs: 15, fiber: 3, sugar: 2, saturatedFat: 1, sodium: 250 };
const estimate = (over = {}) => ({
  name: 'Old dish', per100g: GOOD, serving: { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 250 }, confidence: 'medium',
  provider: 'fake', model: 'fake-1', at: new Date(Date.now() - 86_400_000).toISOString(), sameAs: null,
  promptVersion: ESTIMATE_PROMPT_VERSION, calcVersion: ESTIMATE_CALC_VERSION, ...over,
});

function provider({ fail, per100g = { ...GOOD, calories: 150, carbs: 23 }, gate } = {}) {
  const p = { name: 'fake', model: 'fake-2', calls: 0 };
  p.estimateFoods = async ({ foods }) => {
    p.calls++;
    if (gate) await gate();
    if (fail) throw fail;
    return { foods: foods.map((q) => ({ query: q, known: true, name: `New ${q}`, per100g, serving: { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 300 }, confidence: 'medium', sameAs: null })), usage: { inputTokens: 5, outputTokens: 5 } };
  };
  return p;
}

async function put(phrase, e, status = 'pending') {
  const [r] = await sql`INSERT INTO food_requests (phrase, example, reason, estimate, estimate_status, estimate_reviewed_at)
    VALUES (${phrase}, ${phrase}, 'no matching food', ${e ? sql.json(e) : null}, ${status}, ${status === 'approved' || status === 'rejected' ? new Date() : null}) RETURNING id::int AS id`;
  return r.id;
}
const row = async (id) => (await sql`SELECT * FROM food_requests WHERE id = ${id}`)[0];

const app = await buildApp();
let base;
before(async () => { base = await app.listen({ port: 0, host: '127.0.0.1' }); });
after(() => app.close());
const ADMIN = { Authorization: 'Bearer test-admin-token' };

for (const status of ['pending', 'approved', 'rejected']) {
  test(`a ${status} estimate is replaced, kept in the history, and goes back to pending review`, async () => {
    const id = await put(`zubbly ${status} stew`, estimate(), status);
    const p = provider();
    const out = await reestimateFoodRequest(sql, id, p);
    assert.equal(out.ok, true);
    assert.equal(p.calls, 1);
    const r = await row(id);
    assert.equal(r.estimate_status, 'pending');
    assert.equal(r.estimate_reviewed_at, null);
    assert.equal(r.estimate.per100g.calories, 150);
    assert.equal(r.estimate_history.length, 1);
    assert.equal(r.estimate_history[0].estimate.name, 'Old dish');
    assert.equal(r.estimate_history[0].reason, `operator re-estimate (was ${status})`);
  });
}

test('a request with no estimate yet gets its first one, with no history entry', async () => {
  const id = await put('zubbly fresh stew', null, 'none');
  const out = await reestimateFoodRequest(sql, id, provider());
  assert.equal(out.ok, true);
  const r = await row(id);
  assert.equal(r.estimate_status, 'pending');
  assert.deepEqual(r.estimate_history, []);
});

test('an answer that fails the checks keeps the current estimate and records why', async () => {
  const id = await put('zubbly bad stew', estimate(), 'approved');
  const out = await reestimateFoodRequest(sql, id, provider({ per100g: { ...GOOD, calories: 999 } }));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'estimate_rejected');
  const r = await row(id);
  assert.equal(r.estimate_status, 'approved', 'an approved estimate stays approved');
  assert.equal(r.estimate.name, 'Old dish');
  assert.match(r.estimate_failures[0].problem, /^operator re-estimate rejected:/);
});

test('a provider failure keeps the current estimate', async () => {
  const id = await put('zubbly down stew', estimate());
  const out = await reestimateFoodRequest(sql, id, provider({ fail: new Error('rate limited') }));
  assert.equal(out.code, 'ai_failed');
  const r = await row(id);
  assert.equal(r.estimate.name, 'Old dish');
  assert.match(r.estimate_failures[0].problem, /rate limited/);
});

test('a review that lands while the AI is answering wins: the new estimate is not written', async () => {
  const id = await put('zubbly race stew', estimate());
  const gate = async () => { await sql`UPDATE food_requests SET estimate = ${sql.json(estimate({ name: 'Changed', at: new Date().toISOString() }))} WHERE id = ${id}`; };
  const out = await reestimateFoodRequest(sql, id, provider({ gate }));
  assert.equal(out.code, 'estimate_changed');
  assert.equal((await row(id)).estimate.name, 'Changed');
});

test('a bare ambiguous word is never estimated, and an unknown id is not found', async () => {
  const id = await put('chicken', null, 'none');
  const p = provider();
  assert.equal((await reestimateFoodRequest(sql, id, p)).code, 'not_estimable');
  assert.equal((await reestimateFoodRequest(sql, 999999, p)).code, 'not_found');
  assert.equal(p.calls, 0);
});

test('POST /v1/admin/food-requests/:id/reestimate needs the admin token and maps outcomes to statuses', async () => {
  const id = await put('zubbly route stew', estimate(), 'approved');
  const url = `${base}/v1/admin/food-requests/${id}/reestimate`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  setProvider({ name: 'none' });
  assert.equal((await fetch(url, { method: 'POST', headers: ADMIN })).status, 503);
  setProvider(provider());
  const ok = await fetch(url, { method: 'POST', headers: ADMIN });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.estimateStatus, 'pending');
  assert.equal(body.estimateHistory.length, 1);
  assert.equal((await fetch(`${base}/v1/admin/food-requests/999999/reestimate`, { method: 'POST', headers: ADMIN })).status, 404);
  setProvider(provider({ per100g: { ...GOOD, calories: 999 } }));
  const bad = await fetch(url, { method: 'POST', headers: ADMIN });
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).error.code, 'estimate_rejected');
});
