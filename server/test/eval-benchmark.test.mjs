// The estimate benchmark (scripts/eval): how references are formed and scored, and the integrity of the built sets
// in data/eval/sets, so a set can't silently lose its sources, its versioning or its exclusions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acrossRuns, calorieError, consensus, densitySummary, median, medianValues, portionSummary } from '../scripts/eval/metrics.ts';
import { requestEstimates } from '../src/domain/foodrequests.ts';

const SETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/eval/sets');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SETS, `${name}.json`), 'utf8'));

test('consensus: a point when every family is within 15% of the highest, with mean values', () => {
  const r = consensus([{ calories: 100, protein: 4, carbs: 10, fat: 5 }, { calories: 90, protein: 6, carbs: 12, fat: 3 }]);
  assert.equal(r.kind, 'point');
  assert.equal(r.calories, 95);
  assert.deepEqual(r.macros, { protein: 5, carbs: 11, fat: 4 });
});

test('consensus: a range between 15% and 1.5x apart; excluded beyond 1.5x', () => {
  assert.equal(consensus([{ calories: 100 }, { calories: 84 }]).kind, 'range');
  assert.deepEqual(consensus([{ calories: 100 }, { calories: 150 }, { calories: 120 }]), { kind: 'range', low: 100, high: 150, macros: {} });
  const ex = consensus([{ calories: 100 }, { calories: 151 }]);
  assert.equal(ex.kind, 'excluded');
  assert.match(ex.reason, /1\.51x/);
});

test('consensus: a macro is only averaged when every family gives it', () => {
  const r = consensus([{ calories: 100, protein: 4, fat: null }, { calories: 100, protein: 6 }]);
  assert.deepEqual(r.macros, { protein: 5 });
});

test('consensus: needs two families and positive calories', () => {
  assert.throws(() => consensus([{ calories: 100 }]), /two independent/);
  assert.throws(() => consensus([{ calories: 0 }, { calories: 10 }]), /positive/);
});

test('calorieError: relative to a point; zero inside a range, distance to the nearer end outside; null if excluded', () => {
  assert.equal(calorieError(120, { kind: 'point', calories: 100, macros: {}, low: 100, high: 100 }), 0.2);
  const range = { kind: 'range', low: 100, high: 140, macros: {} };
  assert.equal(calorieError(120, range), 0);
  assert.equal(calorieError(80, range), 0.2);
  assert.equal(calorieError(175, range), 0.25);
  assert.equal(calorieError(100, { kind: 'excluded', low: 1, high: 9, reason: '' }), null);
});

test('densitySummary: coverage counts unanswered dishes; excluded references are not eligible', () => {
  const point = (c) => ({ kind: 'point', calories: c, macros: { protein: 10 }, low: c, high: c });
  const s = densitySummary([
    { estimate: { calories: 110, protein: 12 }, ref: point(100) }, // 10%
    { estimate: { calories: 160 }, ref: point(100) }, // 60%
    { estimate: null, ref: point(100) }, // not answered
    { estimate: { calories: 999 }, ref: { kind: 'excluded', low: 1, high: 9, reason: '' } },
  ]);
  assert.equal(s.eligible, 3);
  assert.equal(s.scored, 2);
  assert.equal(s.coverage, 2 / 3);
  assert.ok(Math.abs(s.calorieMedianError - 0.35) < 1e-9);
  assert.equal(s.within10, 0.5);
  assert.equal(s.within20, 0.5);
  assert.equal(s.over50, 1);
  assert.equal(s.calorieMaeKcal, 35);
  assert.equal(s.macroMaeGrams.protein, 2);
  assert.equal(s.macroMaeGrams.fat, null);
});

test('portionSummary and helpers', () => {
  const s = portionSummary([{ grams: 50, ref: 40 }, { grams: 100, ref: 40 }, { grams: null, ref: 30 }]);
  assert.equal(s.coverage, 2 / 3);
  assert.equal(s.maeGrams, 35);
  assert.equal(s.over2x, 1);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual(acrossRuns([0.2, null, 0.4]), { mean: 0.30000000000000004, min: 0.2, max: 0.4, runs: 2 });
  assert.deepEqual(medianValues([{ calories: 100, fat: 2 }, { calories: 300, fat: 4 }, { calories: 200, fat: null }]), { calories: 200, fat: 3 });
});

test('built sets: versioned, hashed, and every scored reference is traceable to two independent families', () => {
  for (const name of ['A', 'B', 'C', 'P', 'D']) {
    const set = load(name);
    assert.ok(set.version, `${name} has a version`);
    const { sha256, ...body } = set;
    assert.equal(sha256, crypto.createHash('sha256').update(JSON.stringify(body, null, 2)).digest('hex'), `${name}.json matches its hash (rebuild with npm run eval:sets)`);
  }
  const A = load('A');
  const keys = new Set();
  for (const d of A.dishes) {
    assert.ok(!keys.has(d.key), `${d.key} once`);
    keys.add(d.key);
    const families = d.refs.map((r) => r.family);
    assert.ok(families.length >= 2 && new Set(families).size === families.length, `${d.key}: two or more distinct families`);
    for (const r of d.refs) assert.ok(r.name && r.values?.calories > 0 && (r.id || r.code), `${d.key}: ref has id, name and values`);
    assert.deepEqual(d.reference, consensus(d.refs.map((r) => r.values)), `${d.key}: reference follows the rule`);
  }
  for (const r of load('B').dishes) assert.ok(r.noCooking && r.source?.name, `${r.key}: reason and source`);
  for (const p of load('C').phrases) for (const k of p.items ?? [p.dish]) if (k) assert.ok(keys.has(k), `${p.text} -> ${k}`);
  for (const p of load('P').portions) assert.ok(p.grams > 0 && p.label && p.food.id && p.hide, `${p.phrase}`);
});

test('requestEstimates passes an evaluation prompt through to the provider, and passes none by default', async () => {
  const seen = [];
  const provider = {
    name: 'fake', model: 'fake-1',
    async estimateFoods(args) {
      seen.push(args.prompt ?? null);
      return { foods: args.foods.map((q) => ({ query: q, known: true, name: q, per100g: { calories: 100, protein: 5, fat: 4, carbs: 11, fiber: 1, sugar: 2, saturatedFat: 1, sodium: 100 }, serving: { label: '1 bowl', unit: 'bowl', grams: 200 }, confidence: 'medium', sameAs: null })), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const prompt = { system: 'x', message: () => 'y' };
  await requestEstimates(provider, ['dal'], undefined, { prompt });
  await requestEstimates(provider, ['dal']);
  assert.deepEqual(seen, [prompt, null]);
});
