// Food-logging accuracy benchmark: runs every case in test/benchmark-cases.mjs through text logging and scores it.
//
//   npm run benchmark -w server            (reads data/foods.db; no database or API key needed)
//
// Statuses: correct (the expected food) · wrong (a different food logged, or a phrase that should not log, logged)
// · missed (unmatched though the catalog has the food) · unmatched-ok (rightly not logged) · gap (unmatched; the
// catalog lacks the food). `known` cases are Nutrikit's open bugs: scored, and `todo` in the tests.
import { fileURLToPath } from 'node:url';
import { logText } from '../src/domain/textlog.ts';
import { CASES } from '../test/benchmark-cases.mjs';

export interface BenchmarkCase {
  input: string;
  food?: RegExp;
  grams?: [number, number];
  unmatched?: boolean;
  didYouMean?: string;
  gap?: string;
  known?: string;
}

export type Status = 'correct' | 'wrong' | 'missed' | 'unmatched-ok' | 'gap';

export interface Outcome {
  c: BenchmarkCase;
  status: Status;
  /** The expected food is the logged one or among its alternatives or suggestions. */
  top3: boolean;
  /** Weight within the expected range; null when the case sets none or the food was not right. */
  gramsOk: boolean | null;
  logged: string | null;
  grams: number | null;
  /** The logged food's data source and how its weight was found (provenance). */
  source: string | null;
  portionMethod: string | null;
  why: string;
}

export function runCase(c: BenchmarkCase): Outcome {
  const r = logText(c.input);
  const item = r.items[0];
  const um = r.unmatched[0];
  const logged = item?.food.name ?? null;
  const names = [...(item ? [item.food.name, ...item.alternatives.map((a) => a.name)] : []), ...(um?.suggestions ?? []).map((s) => s.name)];
  const top3 = !!c.food && names.slice(0, 3).some((n) => c.food!.test(n));
  let status: Status;
  let why = '';
  if (c.unmatched) {
    status = item ? 'wrong' : 'unmatched-ok';
    if (item) why = `logged ${logged}`;
    else if (c.didYouMean && um?.didYouMean !== c.didYouMean) { status = 'wrong'; why = `didYouMean ${um?.didYouMean ?? 'none'}, expected ${c.didYouMean}`; }
  } else if (!item) {
    status = c.gap ? 'gap' : 'missed';
    why = c.gap ? `not in the catalog: ${c.gap}` : `unmatched (${um?.reason ?? 'no result'})`;
  } else if (c.food?.test(item.food.name)) {
    status = 'correct';
  } else {
    status = 'wrong';
    why = `logged ${logged}`;
  }
  const gramsOk = c.grams && status === 'correct' ? item.grams >= c.grams[0] && item.grams <= c.grams[1] : null;
  if (gramsOk === false) why = `${item.grams} g, expected ${c.grams![0]}–${c.grams![1]} g`;
  return { c, status, top3, gramsOk, logged, grams: item?.grams ?? null, source: item?.food.source ?? null, portionMethod: item?.portionMethod ?? null, why };
}

// Weights that rest on an assumption rather than the food's own data (water density, a 100 g serving, 1 oz).
const ESTIMATED_PORTIONS = new Set(['density-estimate', 'default-100g', 'estimate-1oz', 'add-on-cap']);

export interface Scores {
  cases: number;
  /** All cases: share handled correctly, the right food or rightly not logged (the headline score). */
  correctlyHandled: number;
  /** Cases where a food should be logged (not `unmatched`): share logged as the right food. */
  top1: number;
  top3: number;
  /** All cases: share where a wrong food was logged (the worst outcome). */
  wrongRate: number;
  /** Cases where a food should be logged: share left unmatched (gaps and misses). */
  unmatchedRate: number;
  /** Cases with a weight range and the right food: share within it. */
  portionAccuracy: number;
  /** Logged items: share that name their data source and how their weight was found. */
  provenance: number;
  /** Logged items: share whose weight rests on an assumption (see ESTIMATED_PORTIONS), right food or not. */
  estimatedPortions: number;
  counts: Record<Status, number>;
}

const share = (n: number, d: number) => (d ? n / d : 1);

export function score(outcomes: Outcome[]): Scores {
  const counts = { correct: 0, wrong: 0, missed: 0, 'unmatched-ok': 0, gap: 0 } as Record<Status, number>;
  for (const o of outcomes) counts[o.status]++;
  const wantFood = outcomes.filter((o) => !o.c.unmatched);
  const sized = outcomes.filter((o) => o.gramsOk !== null);
  const logged = outcomes.filter((o) => o.logged);
  const handled = outcomes.filter((o) => ['correct', 'unmatched-ok', 'gap'].includes(o.status) && o.gramsOk !== false);
  return {
    cases: outcomes.length,
    correctlyHandled: share(handled.length, outcomes.length),
    top1: share(wantFood.filter((o) => o.status === 'correct').length, wantFood.length),
    top3: share(wantFood.filter((o) => o.top3).length, wantFood.filter((o) => o.c.food).length),
    wrongRate: share(counts.wrong, outcomes.length),
    unmatchedRate: share(wantFood.filter((o) => o.status === 'gap' || o.status === 'missed').length, wantFood.length),
    portionAccuracy: share(sized.filter((o) => o.gramsOk).length, sized.length),
    provenance: share(logged.filter((o) => o.source && o.portionMethod).length, logged.length),
    estimatedPortions: share(logged.filter((o) => ESTIMATED_PORTIONS.has(o.portionMethod ?? '')).length, logged.length),
    counts,
  };
}

export const runBenchmark = (cases: BenchmarkCase[] = CASES as BenchmarkCase[]) => cases.map(runCase);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outcomes = runBenchmark();
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  for (const o of outcomes.filter((x) => x.status !== 'correct' && x.status !== 'unmatched-ok' || x.gramsOk === false)) {
    console.log(`${o.status.padEnd(12)} ${o.c.input.padEnd(26)} ${o.why}${o.c.known ? `  [known: ${o.c.known}]` : ''}`);
  }
  const s = score(outcomes);
  console.log(`\n${s.cases} cases · correct ${s.counts.correct} · rightly unmatched ${s.counts['unmatched-ok']} · gaps ${s.counts.gap} · missed ${s.counts.missed} · wrong ${s.counts.wrong}`);
  console.log(`correctly handled ${pct(s.correctlyHandled)} (right food, or rightly not logged)`);
  console.log(`top-1 ${pct(s.top1)} · top-3 ${pct(s.top3)} · wrong-food rate ${pct(s.wrongRate)} · unmatched rate ${pct(s.unmatchedRate)}`);
  console.log(`portion accuracy ${pct(s.portionAccuracy)} · provenance ${pct(s.provenance)} · estimated portions ${pct(s.estimatedPortions)}`);
  const estimated = outcomes.filter((o) => ESTIMATED_PORTIONS.has(o.portionMethod ?? ''));
  if (estimated.length) console.log(`weights resting on an assumption: ${estimated.map((o) => `${o.c.input} (${o.portionMethod})`).join(', ')}`);
}
