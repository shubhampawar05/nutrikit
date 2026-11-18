// How accurate are AI nutrition estimates? Asks the configured AI provider to estimate INDB dishes as if the catalog
// lacked them (by their full INDB name, "Lassi (salted)"), through the same requestEstimates() that logging uses, and scores
// the answers against INDB's published per-100 g values.
//
//   npm run eval:estimates -w server -- [--n 100] [--label baseline]
//
// Needs an AI provider key (OPENAI_API_KEY or ANTHROPIC_API_KEY) and data/foods.db; costs one AI call per 5 dishes.
// Writes data/eval/<label>.json (every dish, its estimate and errors) and prints a summary. INDB values are themselves
// one recipe per dish, so a perfect score is impossible: the point is to compare prompts, models and methods.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foods, getFood } from '../src/domain/db.ts';
import { getProvider } from '../src/domain/providers/index.ts';
import { MAX_ESTIMATES_PER_CALL, catalogCandidates, requestEstimates, requestKey, type StoredEstimate } from '../src/domain/foodrequests.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const N = Number(arg('n', '100'));
const LABEL = arg('label', 'run');
// indb: INDB's published dishes; recipe: our cited recipes (data/recipes/), an independent check from real recipe pages.
const SOURCE = arg('source', 'indb');
if (!['indb', 'recipe'].includes(SOURCE)) throw new Error('--source is indb or recipe');
const CONCURRENCY = 3;

interface Dish { id: number; name: string; query: string; truth: Record<string, number> }

// Every k-th INDB dish by id, so runs compare the same sample. The query is the full name: its brackets often carry
// the variant ("Lassi (salted)"), and without them the model rightly answers for a different dish.
const all = (foods().prepare('SELECT id, name, nutrients FROM foods WHERE source = ? ORDER BY id').all(SOURCE) as { id: number; name: string; nutrients: string }[])
  .map((r) => ({ id: r.id, name: r.name, query: r.name.slice(0, 100), truth: JSON.parse(r.nutrients) as Record<string, number> }))
  .filter((d) => d.query.length >= 3 && d.truth.calories > 0);
const step = Math.max(1, Math.floor(all.length / N));
const sample: Dish[] = all.filter((_, i) => i % step === 0).slice(0, N);

const provider = await getProvider();
if (!provider.estimateFoods) throw new Error(`AI provider "${provider.name}" can't estimate foods; set OPENAI_API_KEY or ANTHROPIC_API_KEY`);

const batches: Dish[][] = [];
for (let i = 0; i < sample.length; i += MAX_ESTIMATES_PER_CALL) batches.push(sample.slice(i, i + MAX_ESTIMATES_PER_CALL));
const got = new Map<number, StoredEstimate | null>();
let inputTokens = 0;
const rejected: { query: string; problem: string }[] = [];
let outputTokens = 0;
let next = 0;
async function worker() {
  while (next < batches.length) {
    const batch = batches[next++];
    try {
      // The dish itself (and any food with exactly its name) is hidden from its candidates, as if it were missing.
      const candidates = batch.map((d) => catalogCandidates(d.query, (id, name) => id === d.id || name.toLowerCase() === d.name.toLowerCase()));
      const { estimates, usage, rejected: failed } = await requestEstimates(provider, batch.map((d) => d.query), candidates);
      rejected.push(...failed);
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      for (const d of batch) got.set(d.id, estimates.get(requestKey(d.query)) ?? null);
    } catch (err) {
      console.error(`batch failed: ${(err as Error).message}`);
      for (const d of batch) got.set(d.id, null);
    }
    process.stderr.write('.');
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write('\n');

const MACROS = ['protein', 'carbs', 'fat'] as const;
const rows = sample.map((d) => {
  const e = got.get(d.id);
  if (!e) return { id: d.id, query: d.query, truth: d.truth.calories, estimate: null };
  // A catalog food the model judged the same dish is logged with that food's values, so those are what count.
  const values = (e.sameAs ? getFood(e.sameAs.id)?.per100g : null) ?? e.per100g;
  const kcal = values.calories!;
  return {
    id: d.id, query: d.query, name: e.name, confidence: e.confidence, sameAs: e.sameAs ?? null, method: e.method,
    modelCalories: (e.modelPer100g ?? e.per100g).calories,
    modelError: Math.abs((e.modelPer100g ?? e.per100g).calories - d.truth.calories) / d.truth.calories,
    ingredients: e.ingredients,
    truth: { calories: d.truth.calories, ...Object.fromEntries(MACROS.map((m) => [m, d.truth[m] ?? null])) },
    estimate: { calories: kcal, ...Object.fromEntries(MACROS.map((m) => [m, values[m] ?? null])) },
    calorieError: Math.abs(kcal - d.truth.calories) / d.truth.calories,
    macroError: Object.fromEntries(MACROS.map((m) => [m, d.truth[m] == null || values[m] == null ? null : Math.abs(values[m]! - d.truth[m])])),
  };
});

const scored = rows.filter((r): r is Extract<typeof r, { calorieError: number }> => 'calorieError' in r);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const summary = {
  label: LABEL,
  provider: provider.name,
  model: provider.model ?? null,
  at: new Date().toISOString(),
  source: SOURCE,
  dishes: sample.length,
  estimated: scored.length,
  notEstimated: sample.length - scored.length,
  rejectedAfterRetry: rejected,
  matchedCatalog: scored.filter((r) => r.sameAs).length,
  matchedCatalogMedianError: pct(median(scored.filter((r) => r.sameAs).map((r) => r.calorieError))),
  estimatedMedianError: pct(median(scored.filter((r) => !r.sameAs).map((r) => r.calorieError))),
  // Same answers, two methods: the recipe composed from USDA values vs the model's own figures, on dishes with both.
  recipeComposed: scored.filter((r) => r.method === 'recipe').length,
  recipeVsModelOnSameDishes: {
    recipeMedianError: pct(median(scored.filter((r) => r.method === 'recipe').map((r) => r.calorieError))),
    modelMedianError: pct(median(scored.filter((r) => r.method === 'recipe').map((r) => r.modelError))),
    recipeBetter: scored.filter((r) => r.method === 'recipe' && r.calorieError < r.modelError).length,
    modelBetter: scored.filter((r) => r.method === 'recipe' && r.modelError < r.calorieError).length,
  },
  calories: {
    medianError: pct(median(scored.map((r) => r.calorieError))),
    meanError: pct(mean(scored.map((r) => r.calorieError))),
    within20: pct(scored.filter((r) => r.calorieError <= 0.2).length / (scored.length || 1)),
    over50: scored.filter((r) => r.calorieError > 0.5).length,
  },
  macroMeanErrorGrams: Object.fromEntries(MACROS.map((m) => [m, Math.round(mean(scored.map((r) => r.macroError[m]).filter((x): x is number => x != null)) * 10) / 10])),
  usage: { inputTokens, outputTokens },
};

fs.mkdirSync(path.join(ROOT, 'data/eval'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/eval', `${LABEL}.json`), `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
const worst = [...scored].sort((a, b) => b.calorieError - a.calorieError).slice(0, 8);
console.log('\nLargest calorie errors:');
for (const r of worst) console.log(`  ${r.query}: ${r.sameAs ? `matched "${r.sameAs.name}"` : 'estimated'} ${Math.round(r.estimate.calories)} kcal, INDB ${Math.round(r.truth.calories)} (${pct(r.calorieError)})`);
console.log('\nMatched to a catalog food:');
for (const r of scored.filter((x) => x.sameAs)) console.log(`  ${r.query} -> ${r.sameAs!.name} (${pct(r.calorieError)})`);
