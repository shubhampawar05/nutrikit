// Stale estimates and history (M5): a pending estimate that is too old, from another prompt or calculation version,
// or failing today's checks is made again by one request at a time; the current estimate is served until a
// replacement passes every check, and the replaced one is kept in a history of five. Approved and rejected estimates
// are never re-estimated automatically. Providers are mocked: no AI call is made.
import { sql } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESTIMATE_PROMPT_VERSION } from '../src/domain/providers/prompts.ts';
import { ESTIMATE_CALC_VERSION, coverUnknowns, staleReason } from '../src/domain/foodrequests.ts';

const GOOD = { calories: 120, protein: 6, fat: 4, carbs: 15, fiber: 3, sugar: 2, saturatedFat: 1, sodium: 250 };
const DAY = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const estimate = (over = {}) => ({
  name: 'Old dish', per100g: GOOD, serving: { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 250 }, confidence: 'medium',
  provider: 'fake', model: 'fake-1', at: iso(DAY), sameAs: null, promptVersion: ESTIMATE_PROMPT_VERSION, calcVersion: ESTIMATE_CALC_VERSION, ...over,
});

/** A mocked provider: counts calls, answers with `per100g` (calories 150 by default), optionally after `gate`. */
function provider({ fail, per100g = { ...GOOD, calories: 150, carbs: 23 }, gate } = {}) {
  const p = { name: 'fake', model: 'fake-2', calls: 0 };
  p.estimateFoods = async ({ foods }) => {
    p.calls++;
    if (gate) await gate;
    if (fail) throw fail;
    return { foods: foods.map((q) => ({ query: q, known: true, name: `New ${q}`, per100g, serving: { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 300 }, confidence: 'medium', sameAs: null })), usage: { inputTokens: 5, outputTokens: 5 } };
  };
  return p;
}

async function put(phrase, e, status = 'pending') {
  await sql`INSERT INTO food_requests (phrase, example, reason, estimate, estimate_status) VALUES (${phrase}, ${`1 bowl ${phrase}`}, 'no matching food', ${sql.json(e)}, ${status})`;
}
const row = async (phrase) => (await sql`SELECT * FROM food_requests WHERE phrase = ${phrase}`)[0];
const cover = (phrase, p) => coverUnknowns(sql, [{ unmatched: { text: `1 bowl ${phrase}`, reason: 'no matching food' }, food: phrase, amount: { quantity: 1, unit: 'bowl' } }], p, { store: true, pending: true });

test('staleReason: age, prompt version, calculation version, today\'s checks; legacy estimates count as other versions', () => {
  assert.equal(staleReason(estimate()), null);
  assert.match(staleReason(estimate({ at: iso(31 * DAY) })), /older than 30 days/);
  assert.match(staleReason(estimate({ promptVersion: 'aaaaaaaaaaaa' })), /prompt version aaaaaaaaaaaa/);
  assert.match(staleReason(estimate({ calcVersion: 'v1' })), /calculation version v1/);
  assert.match(staleReason(estimate({ per100g: { ...GOOD, calories: 999 } })), /today's checks/);
  const { promptVersion, calcVersion, ...legacy } = estimate();
  assert.match(staleReason(legacy), /before prompt versions were recorded/);
  assert.match(staleReason(estimate({ at: 'not a date' })), /no valid estimate time/);
});

test('a pending estimate younger than 30 days with current versions is reused, with no AI call', async () => {
  await put('fresh dal', estimate());
  const p = provider();
  const { items } = await cover('fresh dal', p);
  assert.equal(p.calls, 0);
  assert.equal(items[0].food.name, 'Old dish');
  assert.deepEqual((await row('fresh dal')).estimate_history, []);
});

for (const [name, over, reason] of [
  ['older than 30 days', { at: iso(31 * DAY) }, /older than 30 days/],
  ['another prompt version', { promptVersion: 'aaaaaaaaaaaa' }, /prompt version/],
  ['another calculation version', { calcVersion: 'v1' }, /calculation version/],
  ['failing today\'s checks', { per100g: { ...GOOD, calories: 999 } }, /today's checks/],
]) {
  test(`a pending estimate ${name} is made again; the old one goes to history whole`, async () => {
    const phrase = `stale ${name}`.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
    const old = estimate(over);
    await put(phrase, old);
    const p = provider();
    const { items } = await cover(phrase, p);
    assert.equal(p.calls, 1);
    assert.equal(items[0].food.name, `New ${phrase}`, 'the new estimate is served once it passed the checks');
    const r = await row(phrase);
    assert.equal(r.estimate.name, `New ${phrase}`);
    assert.equal(r.estimate.promptVersion, ESTIMATE_PROMPT_VERSION);
    assert.equal(r.estimate_status, 'pending', 'a new estimate still needs review');
    assert.equal(r.estimate_history.length, 1);
    const [h] = r.estimate_history;
    assert.deepEqual(h.estimate, old, 'the previous estimate JSON is kept as it was');
    assert.equal(h.provider, 'fake');
    assert.equal(h.model, 'fake-1');
    assert.equal(h.promptVersion, old.promptVersion);
    assert.equal(h.calcVersion, old.calcVersion);
    assert.equal(h.estimatedAt, old.at);
    assert.ok(Date.parse(h.replacedAt) > Date.parse(old.at));
    assert.match(h.reason, reason);
    assert.equal(r.reestimate_claimed_at, null, 'the claim is released');
  });
}

test('an approved estimate is never re-estimated automatically, however stale', async () => {
  const old = estimate({ at: iso(400 * DAY), promptVersion: 'aaaaaaaaaaaa', calcVersion: 'v1' });
  await put('approved stew', old, 'approved');
  const p = provider();
  const { items } = await cover('approved stew', p);
  assert.equal(p.calls, 0);
  assert.equal(items[0].basis.status, 'approved');
  assert.equal(items[0].food.source, 'ai-estimate');
  const r = await row('approved stew');
  assert.deepEqual(r.estimate, old);
  assert.deepEqual(r.estimate_history, []);
});

test('a rejected estimate is never regenerated automatically', async () => {
  const old = estimate({ at: iso(400 * DAY) });
  await put('rejected curry', old, 'rejected');
  const p = provider();
  const { items } = await cover('rejected curry', p);
  assert.equal(p.calls, 0);
  assert.equal(items[0], null, 'stays unmatched');
  assert.deepEqual((await row('rejected curry')).estimate, old);
});

test('a failed re-estimate (rate limit or timeout) keeps the current estimate, records why, and backs off', async () => {
  const old = estimate({ at: iso(31 * DAY) });
  await put('flaky soup', old);
  const limited = Object.assign(new Error('AI provider is rate limited; retry later'), { status: 429, usage: { inputTokens: 3, outputTokens: 0 } });
  const p = provider({ fail: limited });
  const first = await cover('flaky soup', p);
  assert.equal(p.calls, 1);
  assert.equal(first.items[0].food.name, 'Old dish', 'the request still gets the current estimate');
  assert.deepEqual(first.usage, { inputTokens: 3, outputTokens: 0 }, 'tokens spent before the failure are charged');
  const r = await row('flaky soup');
  assert.deepEqual(r.estimate, old);
  assert.deepEqual(r.estimate_history, []);
  assert.match(r.estimate_failures[0].problem, /re-estimate failed: AI provider is rate limited/);
  assert.ok(r.reestimate_after > new Date(), 'backing off');
  assert.equal(r.reestimate_claimed_at, null);

  const again = await cover('flaky soup', p);
  assert.equal(p.calls, 1, 'no new AI call while backing off');
  assert.equal(again.items[0].food.name, 'Old dish');

  const timeout = Object.assign(new Error('the AI provider did not answer in time; try again'), { status: 504 });
  await put('slow soup', old);
  const t = await cover('slow soup', provider({ fail: timeout }));
  assert.equal(t.items[0].food.name, 'Old dish');
  assert.match((await row('slow soup')).estimate_failures[0].problem, /did not answer in time/);
});

test('a re-estimate that fails the checks keeps the current estimate', async () => {
  const old = estimate({ at: iso(31 * DAY) });
  await put('bad answer bake', old);
  const p = provider({ per100g: { ...GOOD, calories: 999 } });
  const { items } = await cover('bad answer bake', p);
  assert.equal(p.calls, 2, 'asked, then asked once more, as for any estimate');
  assert.equal(items[0].food.name, 'Old dish');
  const r = await row('bad answer bake');
  assert.deepEqual(r.estimate, old);
  assert.equal(r.estimate_failures.length, 2);
  assert.match(r.estimate_failures[0].problem, /^re-estimate rejected: .*pure fat/);
  assert.ok(r.reestimate_after > new Date());
});

test('concurrent requests: one re-estimate, one history entry; the others serve the current estimate', async () => {
  const old = estimate({ at: iso(31 * DAY) });
  await put('busy biryani', old);
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const p = provider({ gate });
  const runs = Array.from({ length: 6 }, () => cover('busy biryani', p));
  await new Promise((r) => setTimeout(r, 50));
  open();
  const results = await Promise.all(runs);
  assert.equal(p.calls, 1, 'exactly one request asked the AI');
  const names = results.map((r) => r.items[0].food.name);
  assert.equal(names.filter((n) => n === 'New busy biryani').length, 1);
  assert.equal(names.filter((n) => n === 'Old dish').length, 5, 'no request saw a half-made estimate');
  const r = await row('busy biryani');
  assert.equal(r.estimate_history.length, 1);
  assert.equal(r.estimate.name, 'New busy biryani');
});

test('a review that lands during a re-estimate wins: the new estimate is discarded', async () => {
  const old = estimate({ at: iso(31 * DAY) });
  await put('reviewed rasam', old);
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const run = cover('reviewed rasam', provider({ gate }));
  await new Promise((r) => setTimeout(r, 30));
  await sql`UPDATE food_requests SET estimate_status = 'approved' WHERE phrase = 'reviewed rasam'`;
  open();
  const { items } = await run;
  assert.equal(items[0].food.name, 'Old dish');
  const r = await row('reviewed rasam');
  assert.deepEqual(r.estimate, old, 'an approved estimate is never replaced');
  assert.deepEqual(r.estimate_history, []);
});

test('history keeps the last five, newest first', async () => {
  await put('often kheer', estimate({ at: iso(31 * DAY), name: 'v0' }));
  for (let i = 1; i <= 7; i++) {
    await cover('often kheer', provider());
    // Make the current estimate stale again (another prompt version) and label it, for the next round.
    await sql`UPDATE food_requests SET estimate = estimate || ${sql.json({ promptVersion: 'aaaaaaaaaaaa', name: `v${i}` })} WHERE phrase = 'often kheer'`;
  }
  const h = (await row('often kheer')).estimate_history;
  assert.equal(h.length, 5);
  assert.deepEqual(h.map((e) => e.estimate.name), ['v6', 'v5', 'v4', 'v3', 'v2']);
  assert.match(h[4].reason, /prompt version/);
});

test('legacy estimates without provenance: pending ones are made again once, safely; approved ones are left alone', async () => {
  const { promptVersion, calcVersion, ...legacy } = estimate({ serving: { label: '1 bowl', unit: 'bowl', grams: 250 } });
  await put('legacy pending', legacy);
  await put('legacy approved', legacy, 'approved');
  const p = provider();
  await cover('legacy pending', p);
  const r = await row('legacy pending');
  assert.equal(r.estimate.promptVersion, ESTIMATE_PROMPT_VERSION);
  assert.equal(r.estimate_history[0].promptVersion, null);
  assert.equal(r.estimate_history[0].calcVersion, null);
  assert.match(r.estimate_history[0].reason, /before prompt versions were recorded/);
  await cover('legacy pending', p);
  assert.equal(p.calls, 1, 'now current: not made again');

  const a = await cover('legacy approved', p);
  assert.equal(p.calls, 1);
  assert.equal(a.items[0].grams, 250);
  assert.equal(a.items[0].basis.promptVersion, null);
});

test('rules logging (no provider) never re-estimates', async () => {
  await put('quiet korma', estimate({ at: iso(31 * DAY) }), 'approved');
  const { items } = await coverUnknowns(sql, [{ unmatched: { text: '1 bowl quiet korma', reason: 'no matching food' }, food: 'quiet korma', amount: { quantity: 1, unit: 'bowl' } }], null, { store: true, pending: false });
  assert.equal(items[0].food.name, 'Old dish');
  assert.equal((await row('quiet korma')).reestimate_claimed_at, null);
});
