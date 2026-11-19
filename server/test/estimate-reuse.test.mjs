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
// The dish named bare: its estimate's whole serving. (A bowl of an estimated dish is asked about: see the last tests.)
const cover = (phrase, p) => coverUnknowns(sql, [{ unmatched: { text: phrase, reason: 'no matching food' }, food: phrase, amount: { quantity: null, unit: null } }], p, { store: true, pending: true });

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
  // Deterministic, not timed: the AI answer is held until the five requests that didn't claim the re-estimate have
  // answered, which also proves they never wait on the AI. (A fixed 50 ms wait let a slow request start after the
  // swap under full-suite load and, correctly, see the new estimate, failing the count below.)
  let settled = 0;
  const runs = Array.from({ length: 6 }, () => cover('busy biryani', p).then((r) => { settled++; return r; }));
  for (const deadline = Date.now() + 10_000; settled < 5 && Date.now() < deadline;) await new Promise((r) => setTimeout(r, 5));
  assert.equal(settled, 5, 'the five other requests answered without waiting for the AI');
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
  const { items } = await coverUnknowns(sql, [{ unmatched: { text: 'quiet korma', reason: 'no matching food' }, food: 'quiet korma', amount: { quantity: null, unit: null } }], null, { store: true, pending: false });
  assert.equal(items[0].food.name, 'Old dish');
  assert.equal((await row('quiet korma')).reestimate_claimed_at, null);
});

test('a phrase whose amount is unsupported, or an AI amount in an unsized katori, is never estimated or logged', async () => {
  await put('loud korma', estimate(), 'approved');
  const p = provider();
  const flagged = { unmatched: { text: '1 small katori loud korma', reason: 'no confident match', amountUnsupported: true }, food: 'loud korma', amount: { quantity: 1, unit: 'small katori' } };
  const unsized = { unmatched: { text: 'a bowl of loud korma', reason: 'no matching food' }, food: 'loud korma', amount: { quantity: 1, unit: 'large katori' } };
  const plain = { unmatched: { text: 'loud korma', reason: 'no matching food' }, food: 'loud korma', amount: { quantity: null, unit: null } };
  const { items } = await coverUnknowns(sql, [flagged, unsized, plain], p, { store: true, pending: true });
  assert.equal(items[0], null, 'a flagged amount stays asked about');
  assert.equal(items[1], null, 'an unsized katori is not logged at 0 g or a guess');
  assert.ok(items[2], 'the rest is still covered');
  assert.equal(p.calls, 0, 'the stored estimate is reused; nothing new is estimated');
});

test('a volume of an estimated or estimate-matched food is never weighed: no item, the phrase kept with the reason', async () => {
  // A stored estimate whose serving is the AI's own "1 cup = 240 g": a serving weight, not a cited density.
  await put('quiet halwa', estimate({ name: 'Quiet halwa', serving: { label: '1 cup', unit: 'cup', quantity: 1, grams: 240 } }), 'approved');
  // A stored estimate the AI matched to the kheer recipe (no cited density).
  await put('quiet kheer', estimate({ sameAs: { id: 900000019, name: 'Kheer (rice pudding)' } }), 'approved');
  const p = provider();
  const text = { unmatched: { text: '1 katori quiet halwa', reason: 'no matching food' }, food: 'quiet halwa', amount: { quantity: 1, unit: 'katori' } };
  const aiParsed = { unmatched: { text: 'a cup of quiet halwa', reason: 'no matching food' }, food: 'quiet halwa', amount: { quantity: 1, unit: 'cup' } };
  const matched = { unmatched: { text: '2 katori quiet kheer', reason: 'no matching food' }, food: 'quiet kheer', amount: { quantity: 2, unit: 'katori' } };
  const grams = { unmatched: { text: '150 g quiet kheer', reason: 'no matching food' }, food: 'quiet kheer', amount: { quantity: 150, unit: 'g', grams: 150 } };
  const { items } = await coverUnknowns(sql, [text, aiParsed, matched, grams], p, { store: true, pending: true });
  assert.deepEqual(items.slice(0, 3), [null, null, null], 'no volume of these is weighed');
  assert.match(text.unmatched.note, /no cited density for Quiet halwa, so 1 katori can't be weighed/);
  assert.match(aiParsed.unmatched.note, /so 1 cup can't be weighed/);
  assert.match(matched.unmatched.note, /no cited density for Kheer \(rice pudding\), so 2 katori can't be weighed/);
  assert.equal(text.unmatched.text, '1 katori quiet halwa', 'the phrase is kept as given');
  assert.equal(items[3].grams, 150, 'given grams are still logged');
  assert.equal(p.calls, 0, 'nothing is estimated');
  assert.equal((await row('quiet halwa')).estimate_uses, 0, 'an estimate that logged nothing is not counted as used');
});

test('a bowl of an estimated dish is asked about, from text or an AI parse; a bowl of an estimate matched to USDA dal is weighed', async () => {
  // The estimate's own "1 bowl = 250 g" serving is a serving weight, never a bowl size.
  await put('still stew', estimate({ name: 'Still stew' }), 'approved');
  // An estimate the AI matched to USDA "Dal": weighed through dal's density at the provisional 200 ml bowl.
  await put('still dal', estimate({ sameAs: { id: 2707427, name: 'Dal' } }), 'approved');
  const text = { unmatched: { text: '1 bowl still stew', reason: 'no matching food' }, food: 'still stew', amount: { quantity: 1, unit: 'bowl' } };
  const aiParsed = { unmatched: { text: 'two bowls of still stew', reason: 'no matching food' }, food: 'still stew', amount: { quantity: 2, unit: 'bowls' } };
  const dal = { unmatched: { text: '1 bowl still dal', reason: 'no matching food' }, food: 'still dal', amount: { quantity: 1, unit: 'bowl' } };
  const { items } = await coverUnknowns(sql, [text, aiParsed, dal], null, { store: true, pending: false });
  assert.equal(items[0], null);
  assert.equal(items[1], null);
  assert.match(text.unmatched.note, /no cited density for Still stew, so 1 bowl can't be weighed/);
  assert.match(aiParsed.unmatched.note, /so 2 bowl can't be weighed/);
  assert.equal(items[2].food.name, 'Dal');
  assert.equal(items[2].grams, 202.9);
  assert.equal(items[2].portionMethod, 'ai-same-as-assumed-bowl', 'the provisional bowl stays labelled');
});

test('a glass or mug of an estimated dish is asked about, even when the estimate\'s own serving is a glass; an AI match to USDA milk is weighed', async () => {
  // The estimate's "1 glass = 300 g" is its own serving weight, never the measure.
  await put('calm sherbet', estimate({ name: 'Calm sherbet', serving: { label: '1 glass', unit: 'glass', quantity: 1, grams: 300 } }), 'approved');
  await put('calm milk', estimate({ sameAs: { id: 2705384, name: 'Milk, NFS' } }), 'approved');
  const text = { unmatched: { text: '1 glass calm sherbet', reason: 'no matching food' }, food: 'calm sherbet', amount: { quantity: 1, unit: 'glass' } };
  const aiParsed = { unmatched: { text: 'two mugs of calm sherbet', reason: 'no matching food' }, food: 'calm sherbet', amount: { quantity: 2, unit: 'mugs' } };
  const milk = { unmatched: { text: '1 glass calm milk', reason: 'no matching food' }, food: 'calm milk', amount: { quantity: 1, unit: 'glass' } };
  const bare = { unmatched: { text: 'calm sherbet', reason: 'no matching food' }, food: 'calm sherbet', amount: { quantity: null, unit: null } };
  const { items } = await coverUnknowns(sql, [text, aiParsed, milk, bare], null, { store: true, pending: false });
  assert.equal(items[0], null);
  assert.equal(items[1], null);
  assert.match(text.unmatched.note, /no cited density for Calm sherbet, so 1 glass can't be weighed/);
  assert.match(aiParsed.unmatched.note, /so 2 mug can't be weighed/);
  assert.equal(text.unmatched.text, '1 glass calm sherbet', 'kept as given');
  assert.equal(items[2].food.name, 'Milk, NFS');
  assert.equal(items[2].grams, 257.8);
  assert.equal(items[2].portionMethod, 'ai-same-as-assumed-glass', 'the provisional glass stays labelled');
  assert.equal(items[3].grams, 300, 'the dish named bare is its whole serving');
});

test('a plate of an estimated dish is asked about, even when the estimate\'s serving is a plate; an AI match to plain rice is the assumed 200 ml', async () => {
  // The estimate's own "1 plate = 350 g" is its serving weight; no source defines a plate.
  await put('fair pulao', estimate({ name: 'Fair pulao', serving: { label: '1 plate', unit: 'plate', quantity: 1, grams: 350 } }), 'approved');
  await put('fair rice', estimate({ sameAs: { id: 2708402, name: 'Rice, cooked, NFS' } }), 'approved');
  const text = { unmatched: { text: '1 plate fair pulao', reason: 'no matching food' }, food: 'fair pulao', amount: { quantity: 1, unit: 'plate' } };
  const aiParsed = { unmatched: { text: 'half a plate of fair pulao', reason: 'no matching food' }, food: 'fair pulao', amount: { quantity: 0.5, unit: 'plates' } };
  const rice = { unmatched: { text: '1 plate fair rice', reason: 'no matching food' }, food: 'fair rice', amount: { quantity: 1, unit: 'plate' } };
  const bare = { unmatched: { text: 'fair pulao', reason: 'no matching food' }, food: 'fair pulao', amount: { quantity: null, unit: null } };
  const { items } = await coverUnknowns(sql, [text, aiParsed, rice, bare], null, { store: true, pending: false });
  assert.equal(items[0], null);
  assert.equal(items[1], null);
  assert.match(text.unmatched.note, /a plate has no standard size, so 1 plate of Fair pulao can't be weighed/);
  assert.match(aiParsed.unmatched.note, /so 0\.5 plate of Fair pulao/);
  assert.equal(text.unmatched.text, '1 plate fair pulao', 'kept as given');
  assert.equal(items[2].food.name, 'Rice, cooked, NFS');
  assert.equal(items[2].grams, 133.6);
  assert.equal(items[2].portionMethod, 'ai-same-as-assumed-plate', 'the plate assumption stays labelled');
  assert.equal(items[3].grams, 350, 'the dish named bare is its whole serving');
});

test('a reviewed ambiguity is never covered by an estimate, stored or new', async () => {
  await put('fish and chips', estimate({ name: 'Fish and chips (estimated)' }), 'approved');
  const p = provider();
  const dish = { unmatched: { text: 'fish and chips', reason: 'no confident match', askOnly: true }, food: 'fish and chips', amount: { quantity: null, unit: null } };
  const { items } = await coverUnknowns(sql, [dish], p, { store: true, pending: true });
  assert.deepEqual(items, [null], 'the stored estimate is not used');
  assert.equal(p.calls, 0, 'and nothing new is estimated');
});
