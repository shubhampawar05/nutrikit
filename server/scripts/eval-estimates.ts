// How accurate are AI nutrition estimates? Runs the benchmark sets (data/eval/sets, built by `npm run eval:sets`)
// through the same requestEstimates()/estimateItem() that logging uses, with each dish hidden from the catalog as if
// it were missing, and scores the answers.
//
//   npm run eval:estimates -w server -- --provider gemini|openai [--model m] [--set A|B|C|P] [--runs 3]
//                                        [--variant baseline|anchored|median3|detailed] [--label name]
//
// - provider/model are pinned: only that endpoint's key is kept and the estimate task gets exactly one model, so a
//   run never falls back silently. The model that answered is recorded per call and checked.
// - Variants: baseline = logging's own prompt; anchored = catalog candidates with macros and an instruction to
//   reason from them; median3 = three independent answers, per-nutrient median; detailed = the query states the
//   preparation (what asking the person for the variant would give).
// - Sets: A (consensus references; dishes whose sources disagree >1.5x are not scored), B (no-cook cited recipes),
//   C (real-world spellings: rules-based matching, and estimates for the phrase's food words), P (portion grams).
// Writes data/eval/results/<label>.json: the configuration (set version and hash, prompt version, models, git
// commit, catalog build), every run's rows and summary, and mean/min/max across runs, with latency, tokens and cost.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PROVIDER = arg('provider');
if (PROVIDER !== 'gemini' && PROVIDER !== 'openai') throw new Error('--provider gemini|openai is required');
// Paid OpenAI calls need the same explicit opt-in as the app: never implied by --provider or by a key alone.
if (PROVIDER === 'openai' && process.env.NUTRIKIT_OPENAI_FALLBACK !== '1') throw new Error('--provider openai spends OpenAI credit: set NUTRIKIT_OPENAI_FALLBACK=1 to allow it');
const MODEL = arg('model', PROVIDER === 'gemini' ? 'gemini-3.5-flash' : 'gpt-5-mini')!;
const SET = arg('set', 'A')!;
const RUNS = Number(arg('runs', '3'));
const VARIANT = arg('variant', 'baseline')!;
const LABEL = arg('label', `${SET}-${PROVIDER}-${VARIANT}`)!;
const CONCURRENCY = Number(arg('concurrency', '2'));
// Milliseconds to wait before each batch, to stay under a provider's per-minute limit on a shared key.
const PACE_MS = Number(arg('pace', '0'));

// Pin the provider before it is created: one endpoint, one model for estimates.
delete process.env.ANTHROPIC_API_KEY;
process.env.NUTRIKIT_AI_PROVIDER = 'openai';
if (PROVIDER === 'gemini') {
  delete process.env.OPENAI_API_KEY;
  process.env.NUTRIKIT_GEMINI_MODEL_ESTIMATE = MODEL;
} else {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  process.env.NUTRIKIT_OPENAI_MODEL_ESTIMATE = MODEL;
}

const { foods, getFood } = await import('../src/domain/db.ts');
const { getProvider } = await import('../src/domain/providers/index.ts');
const { promptVersionOf } = await import('../src/domain/providers/prompts.ts');
const { MAX_ESTIMATES_PER_CALL, catalogCandidates, estimateItem, phraseParts, requestEstimates, requestKey } = await import('../src/domain/foodrequests.ts');
const { logText } = await import('../src/domain/textlog.ts');
const { ANCHORED, BASELINE_PROMPT, VARIANTS } = await import('./eval/variants.ts');
const M = await import('./eval/metrics.ts');
type StoredEstimate = import('../src/domain/foodrequests.ts').StoredEstimate;
type CatalogCandidate = import('../src/domain/providers/index.ts').CatalogCandidate;

if (!(VARIANTS as readonly string[]).includes(VARIANT)) throw new Error(`--variant is one of ${VARIANTS.join(', ')}`);
if (!['A', 'B', 'C', 'P'].includes(SET)) throw new Error('--set is A, B, C or P');
const setFile = path.join(ROOT, 'data/eval/sets', `${SET}.json`);
if (!fs.existsSync(setFile)) throw new Error(`${setFile} missing: run npm run eval:sets -w server`);
const set = JSON.parse(fs.readFileSync(setFile, 'utf8'));
const A = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eval/sets/A.json'), 'utf8'));
const dishByKey = new Map<string, any>(A.dishes.map((d: any) => [d.key, d]));

const prompt = VARIANT === 'anchored' ? ANCHORED : BASELINE_PROMPT;
const promptVersion = promptVersionOf(prompt); // the same id stored with estimates in production
const prices = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/prices.json'), 'utf8')).models;

// --- What to estimate: one item per food, with its reference and the catalog names hidden from the model.
interface Item { key: string; query: string; hide: RegExp; refIds: Set<number>; reference?: any; refGrams?: number; amount?: { quantity: number | null; unit: string | null } }
const refIdsOf = (d: any) => new Set<number>((d.refs ?? []).filter((r: any) => r.id).map((r: any) => r.id).concat(d.id ? [d.id] : []));
let items: Item[] = [];
if (SET === 'A' || SET === 'B') {
  items = set.dishes.filter((d: any) => d.reference.kind !== 'excluded').map((d: any) => ({
    key: d.key, query: VARIANT === 'detailed' ? d.detailed : d.query, hide: new RegExp(d.hide, 'i'), refIds: refIdsOf(d), reference: d.reference,
  }));
} else if (SET === 'C') {
  items = set.phrases.filter((p: any) => !p.items && p.dish && dishByKey.get(p.dish).reference.kind !== 'excluded').map((p: any) => {
    const d = dishByKey.get(p.dish);
    return { key: p.text, query: phraseParts(p.text).food, hide: new RegExp(d.hide, 'i'), refIds: refIdsOf(d), reference: d.reference };
  });
} else {
  items = set.portions.map((p: any) => {
    const parts = phraseParts(p.phrase);
    return { key: p.phrase, query: parts.food, hide: new RegExp(p.hide, 'i'), refIds: new Set([p.food.id]), refGrams: p.grams, amount: { quantity: parts.quantity, unit: parts.unit } };
  });
}
if (VARIANT === 'detailed' && SET !== 'A' && SET !== 'B') throw new Error('--variant detailed applies to sets A and B');

function candidates(it: Item): CatalogCandidate[] {
  const list = catalogCandidates(it.query, (id, name) => it.refIds.has(id) || it.hide.test(name));
  if (VARIANT !== 'anchored') return list;
  return list.map((c) => {
    const f = getFood(c.id);
    return { ...c, protein: f?.per100g.protein ?? null, carbs: f?.per100g.carbs ?? null, fat: f?.per100g.fat ?? null };
  });
}

// --- The provider, timed per call.
const provider = await getProvider();
if (!provider.estimateFoods) throw new Error(`AI provider "${provider.name}" can't estimate foods`);
const calls: { ms: number; model: string | null; foods: number; error?: string; inputTokens: number; outputTokens: number }[] = [];
const inner = provider.estimateFoods.bind(provider);
provider.estimateFoods = async (args) => {
  const t = Date.now();
  try {
    const out = await inner(args);
    calls.push({ ms: Date.now() - t, model: out.model ?? provider.model ?? null, foods: args.foods.length, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens });
    return out;
  } catch (err) {
    const u = (err as { usage?: { inputTokens: number; outputTokens: number } }).usage;
    calls.push({ ms: Date.now() - t, model: null, foods: args.foods.length, error: (err as Error).message, inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0 });
    throw err;
  }
};

async function estimateOnce(batch: Item[]): Promise<Map<string, StoredEstimate | null>> {
  const out = new Map<string, StoredEstimate | null>();
  try {
    const { estimates } = await requestEstimates(provider, batch.map((i) => i.query), batch.map(candidates), { prompt: VARIANT === 'anchored' ? ANCHORED : undefined });
    for (const i of batch) out.set(i.key, estimates.get(requestKey(i.query)) ?? null);
  } catch (err) {
    console.error(`\nbatch failed: ${(err as Error).message}`);
    for (const i of batch) out.set(i.key, null);
  }
  return out;
}

/** Combines three answers for one food: per-nutrient median, median serving grams; sameAs only if two agree. */
function combine(samples: (StoredEstimate | null)[]): StoredEstimate | null {
  const ok = samples.filter((s): s is StoredEstimate => s != null);
  if (ok.length < 2) return ok[0] ?? null;
  const ids = ok.map((s) => s.sameAs?.id).filter((x): x is number => x != null);
  const sameId = ids.find((id) => ids.filter((x) => x === id).length >= 2);
  const per100g = M.medianValues(ok.map((s) => s.per100g as Record<string, number>)) as StoredEstimate['per100g'];
  const grams = M.median(ok.map((s) => s.serving.grams))!;
  return { ...ok[0], per100g, serving: { ...ok[0].serving, grams }, sameAs: sameId != null ? ok.find((s) => s.sameAs?.id === sameId)!.sameAs : null };
}

async function estimateAll(): Promise<Map<string, StoredEstimate | null>> {
  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += MAX_ESTIMATES_PER_CALL) batches.push(items.slice(i, i + MAX_ESTIMATES_PER_CALL));
  const result = new Map<string, StoredEstimate | null>();
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      if (PACE_MS) await new Promise((r) => setTimeout(r, PACE_MS));
      if (VARIANT === 'median3') {
        const s = [await estimateOnce(batch), await estimateOnce(batch), await estimateOnce(batch)];
        for (const i of batch) result.set(i.key, combine(s.map((m) => m.get(i.key) ?? null)));
      } else {
        for (const [k, v] of await estimateOnce(batch)) result.set(k, v);
      }
      process.stderr.write('.');
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stderr.write('\n');
  return result;
}

/** The values logging would use: a matched catalog food's own, else the estimate's. */
function logged(e: StoredEstimate): { calories: number; protein: number | null; carbs: number | null; fat: number | null } {
  const v = ((e.sameAs ? getFood(e.sameAs.id)?.per100g : null) ?? e.per100g) as Record<string, number | undefined>;
  return { calories: v.calories!, protein: v.protein ?? null, carbs: v.carbs ?? null, fat: v.fat ?? null };
}

// --- Set C matching: rules-based logging, no AI, deterministic, so it is measured once.
function matching() {
  if (SET !== 'C') return null;
  const sameDish = (key: string, food: { id: number; name: string }) => {
    const d = dishByKey.get(key);
    return refIdsOf(d).has(food.id) || new RegExp(d.hide, 'i').test(food.name);
  };
  const rows = set.phrases.filter((p: any) => p.items || p.dish).flatMap((p: any) => {
    const r = logText(p.text);
    const expected: (string | null)[] = p.items ?? [p.dish];
    return expected.filter((k): k is string => k != null).map((k) => {
      const hit = r.items.find((i: any) => sameDish(k, i.food));
      return { phrase: p.text, kind: p.kind, dish: k, matched: !!hit, food: hit?.food.name ?? r.items[0]?.food.name ?? null, unmatched: r.unmatched.map((u: any) => u.text) };
    });
  });
  const byKind = Object.fromEntries([...new Set(rows.map((r: any) => r.kind))].map((k) => {
    const rs = rows.filter((r: any) => r.kind === k);
    return [k, `${rs.filter((r: any) => r.matched).length}/${rs.length}`];
  }));
  return { matchedRate: rows.filter((r: any) => r.matched).length / rows.length, byKind, rows };
}

// --- Runs
const runs = [];
for (let run = 1; run <= RUNS; run++) {
  const from = calls.length;
  process.stderr.write(`run ${run}/${RUNS} `);
  const got = await estimateAll();
  const runCalls = calls.slice(from);
  let rows: any[];
  let summary: any;
  if (SET === 'P') {
    rows = items.map((it) => {
      const e = got.get(it.key) ?? null;
      const item = e ? estimateItem(it.key, e, it.amount!) : null;
      return { phrase: it.key, ref: it.refGrams!, grams: item?.grams ?? null, serving: e?.serving ?? null, sameAs: e?.sameAs?.name ?? null };
    });
    summary = M.portionSummary(rows);
  } else {
    rows = items.map((it) => {
      const e = got.get(it.key) ?? null;
      const est = e ? logged(e) : null;
      return {
        key: it.key, query: it.query, ref: it.reference, name: e?.name ?? null, sameAs: e?.sameAs?.name ?? null, confidence: e?.confidence ?? null,
        estimate: est, modelCalories: e?.per100g.calories ?? null, servingGrams: e?.serving.grams ?? null,
        calorieError: est ? M.calorieError(est.calories, it.reference) : null,
      };
    });
    summary = M.densitySummary(rows.map((r) => ({ estimate: r.estimate, ref: r.ref })));
    summary.matchedCatalog = rows.filter((r) => r.sameAs).length;
  }
  const inputTokens = runCalls.reduce((s, c) => s + c.inputTokens, 0);
  const outputTokens = runCalls.reduce((s, c) => s + c.outputTokens, 0);
  const price = prices[MODEL];
  const ms = runCalls.filter((c) => !c.error).map((c) => c.ms).sort((a, b) => a - b);
  summary.calls = { total: runCalls.length, failed: runCalls.filter((c) => c.error).length, models: [...new Set(runCalls.map((c) => c.model).filter(Boolean))] };
  summary.latencyMs = { median: M.median(ms), p90: ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.9))] : null, max: ms.at(-1) ?? null };
  summary.tokens = { input: inputTokens, output: outputTokens };
  summary.costUsd = price?.input != null ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;
  const strays = summary.calls.models.filter((m: string) => m !== MODEL);
  if (strays.length) throw new Error(`run ${run} was answered by ${strays.join(', ')}, not the pinned ${MODEL}`);
  runs.push({ run, summary, rows, errors: runCalls.filter((c) => c.error).map((c) => c.error) });
}

const pick = (path: string) => (s: any) => path.split('.').reduce((o, k) => (o == null ? null : o[k]), s);
const metricPaths = SET === 'P'
  ? ['coverage', 'maeGrams', 'medianRelativeError', 'within25', 'over2x', 'latencyMs.median', 'tokens.input', 'tokens.output', 'costUsd']
  : ['coverage', 'calorieMaeKcal', 'calorieMape', 'calorieMedianError', 'within10', 'within20', 'over50', 'macroMaeGrams.protein', 'macroMaeGrams.carbs', 'macroMaeGrams.fat', 'matchedCatalog', 'latencyMs.median', 'latencyMs.p90', 'tokens.input', 'tokens.output', 'costUsd'];
const across = Object.fromEntries(metricPaths.map((p) => [p, M.acrossRuns(runs.map((r) => pick(p)(r.summary)))]));

const git = (cmd: string) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const config = {
  label: LABEL, at: new Date().toISOString(),
  set: { name: SET, version: set.version, sha256: set.sha256, items: items.length },
  provider: PROVIDER, model: MODEL, variant: VARIANT, promptVersion, runs: RUNS, concurrency: CONCURRENCY, paceMs: PACE_MS,
  aiTimeoutMs: Number(process.env.NUTRIKIT_AI_TIMEOUT_MS) || 60_000,
  gitCommit: git('git rev-parse --short HEAD'), gitDirty: !!git('git status --porcelain'),
  catalogBuild: (foods().prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as { value: string }).value,
  price: prices[MODEL] ?? null,
};
const result = { config, across, matching: matching(), runs };
fs.mkdirSync(path.join(ROOT, 'data/eval/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/eval/results', `${LABEL}.json`), `${JSON.stringify(result, null, 2)}\n`);

const fmt = (p: string, v: number | null) => (v == null ? '-' : /coverage|Error|Mape|within/.test(p) ? `${(v * 100).toFixed(1)}%` : p === 'costUsd' ? `$${v.toFixed(4)}` : `${Math.round(v * 10) / 10}`);
console.log(`\n${LABEL}: set ${SET} v${set.version}, ${PROVIDER}/${MODEL}, ${VARIANT}, prompt ${promptVersion}, ${RUNS} runs, ${items.length} items`);
for (const p of metricPaths) {
  const a = across[p];
  console.log(`  ${p.padEnd(22)} ${fmt(p, a.mean).padStart(9)}   (${fmt(p, a.min)} - ${fmt(p, a.max)})`);
}
if (result.matching) console.log(`  matching (rules, no AI): ${(result.matching.matchedRate * 100).toFixed(1)}% ${JSON.stringify(result.matching.byKind)}`);
for (const r of runs) if (r.errors.length) console.log(`  run ${r.run} errors: ${[...new Set(r.errors)].join(' | ')}`);
