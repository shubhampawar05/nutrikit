// Foods people tried to log that the catalog could not match ("food requests"), so the catalog grows from real
// misses, and AI estimates that cover them in the meantime.
//
// - Every unmatched phrase from live text, voice, photo and demo logging is counted under its food words
//   ("2 bowls sabudana khichdi" -> "sabudana khichdi"). Only those words are stored: no account, key or IP.
// - With `ai: true` (and for photos), a food the catalog lacks is estimated by the AI provider and logged with
//   source "ai-estimate" and low confidence. The estimate is stored as pending and reused for the same food.
// - An operator reviews requests in /admin: approving an estimate makes it answer that food for every caller,
//   rules-based logging included, with no AI call; rejecting it stops it being used or asked for again; a request is resolved once
//   the catalog covers the food (an alias or a recipe) or ignored when it isn't a food.
import type { Sql } from 'postgres';
import { addUsage, aiDeadline, withUsage, type AIProvider, type AIUsage, type CatalogCandidate, type EstimatePrompt, type FoodEstimate } from './providers/index.ts';
import { ESTIMATE_PROMPT_VERSION, promptVersionOf } from './providers/prompts.ts';
import { getFood } from './db.ts';
import { ambiguousBare, searchFoods } from './search.ts';
import { logText, providedPortion, splitMealText, type EstimateBasis, type LoggedItem, type TextLog, type Unmatched } from './textlog.ts';
import { canonicalUnit, resolvePortion } from './units.ts';
import { scaleNutrients, sumNutrients } from './nutrients.ts';

export type RequestStatus = 'open' | 'resolved' | 'ignored';
export type EstimateStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface StoredEstimate {
  name: string;
  per100g: FoodEstimate['per100g'];
  serving: FoodEstimate['serving'];
  confidence: FoodEstimate['confidence'];
  provider: string;
  model: string | null;
  at: string;
  /**
   * Set when the model judged an existing catalog food to be this same dish: that food is logged instead. Catalog
   * ids are stable across rebuilds (USDA fdc_id, CoFID and INDB ids derived from their food codes, recipe ids fixed
   * in their files); a food later dropped from the catalog falls back to the estimate's own values.
   */
  sameAs?: { id: number; name: string } | null;
  // Provenance (estimates stored before 2026-11-19 lack these fields; readers treat a missing one as unknown).
  /** The estimate prompt's version (promptVersionOf in prompts.ts). */
  promptVersion?: string;
  /** How the estimate is validated and turned into logged values (ESTIMATE_CALC_VERSION). */
  calcVersion?: string;
  /** The exact model version the provider reported, when it differs from `model`. */
  modelVersion?: string;
  /** The catalog foods offered to the model as possibly the same dish (id, name, kcal per 100 g). */
  candidates?: CatalogCandidate[];
  /** Which attempt produced it (1, or 2 after a rejected first answer), and why earlier answers were rejected. */
  attempts?: number;
  previousProblems?: string[];
}

/** An AI answer for a food that was rejected and left the food without an estimate. */
export interface EstimateFailure { at: string; provider: string; model: string | null; promptVersion: string | null; problem: string }

/**
 * The version of the estimate checks and logging arithmetic, stored with each estimate. Bump it when estimateProblem,
 * the serving arithmetic or the catalog-match rule changes. v1 (implicit, never stored): before serving counts;
 * v2: serving counts (M3.0), nullable optional nutrients and provenance (M4).
 */
export const ESTIMATE_CALC_VERSION = 'v2';
const MAX_FAILURES_KEPT = 5;

export interface FoodRequest {
  id: number;
  phrase: string;
  example: string;
  reason: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  status: RequestStatus;
  note: string | null;
  estimate: StoredEstimate | null;
  estimateStatus: EstimateStatus;
  estimateUses: number;
  /** Rejected AI answers that left this food without an estimate, newest first (at most 5). */
  estimateFailures: EstimateFailure[];
  /** When an operator last approved or rejected the estimate; null if never. Their reason, if any, is `note`. */
  estimateReviewedAt: string | null;
  /** The estimates this one replaced, newest first (at most 5). */
  estimateHistory: EstimateHistoryEntry[];
}

/** A replaced estimate, kept whole with the provenance an operator needs at a glance and why it was replaced. */
export interface EstimateHistoryEntry {
  estimate: StoredEstimate;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  calcVersion: string | null;
  estimatedAt: string | null;
  replacedAt: string;
  reason: string;
}

/** Most new phrases kept; beyond it only existing ones are counted (NUTRIKIT_FOOD_REQUESTS_MAX). */
const maxRequests = () => Number(process.env.NUTRIKIT_FOOD_REQUESTS_MAX) || 5000;
/** Unknown foods estimated per request, so one long message can't run up AI usage. */
export const MAX_ESTIMATES_PER_CALL = 5;

/** A phrase split into its food words and amount: "2 bowls sabudana khichdi" -> { food: "sabudana khichdi", 2, "bowls" }. */
export function phraseParts(text: string): { food: string; quantity: number | null; unit: string | null } {
  const [item] = splitMealText(text).items;
  return item ? { food: item.food, quantity: item.quantity, unit: item.unit } : { food: text, quantity: null, unit: null };
}

/** The key a request is counted under: lowercase food words, no punctuation, at most 100 characters. */
export function requestKey(food: string): string {
  return food.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const ROW = (sql: Sql) => sql`id::int AS id, phrase, example, reason, count, first_seen AS "firstSeen", last_seen AS "lastSeen",
  status, note, estimate, estimate_status AS "estimateStatus", estimate_uses AS "estimateUses",
  estimate_failures AS "estimateFailures", estimate_reviewed_at AS "estimateReviewedAt", estimate_history AS "estimateHistory"`;

type Log = { error: (o: object, m: string) => void };

/** Counts unmatched phrases, under `food` when given (an AI's food name), else the phrase's food words. Never throws. */
export async function recordMisses(sql: Sql, unmatched: (Pick<Unmatched, 'text' | 'reason'> & { food?: string })[], log?: Log) {
  for (const u of unmatched) {
    const phrase = requestKey(u.food ?? phraseParts(u.text).food);
    if (phrase.length < 2) continue;
    try {
      await sql`INSERT INTO food_requests (phrase, example, reason)
        SELECT ${phrase}, ${u.text.slice(0, 200)}, ${u.reason}
        WHERE (SELECT count(*) FROM food_requests) < ${maxRequests()}
        ON CONFLICT (phrase) DO UPDATE SET count = food_requests.count + 1, last_seen = now(), reason = EXCLUDED.reason`;
    } catch (err) {
      log?.error({ err: (err as Error).message }, 'food request not recorded');
    }
  }
}

type Held = { estimate: StoredEstimate; status: EstimateBasis['status'] };

/** Stored estimates for these food keys, with their review status: approved ones always, pending ones only when `pending` is set. */
async function storedEstimates(sql: Sql, keys: string[], { pending = false } = {}): Promise<Map<string, Held>> {
  if (!keys.length) return new Map();
  const statuses = pending ? ['approved', 'pending'] : ['approved'];
  const rows = await sql<{ phrase: string; estimate: StoredEstimate; status: 'approved' | 'pending' }[]>`SELECT phrase, estimate, estimate_status AS status FROM food_requests
    WHERE phrase IN ${sql(keys)} AND estimate IS NOT NULL AND estimate_status IN ${sql(statuses)}`;
  return new Map(rows.map((r) => [r.phrase, { estimate: r.estimate, status: r.status }]));
}

/** Records rejected AI answers for a food left without an estimate: newest first, the last few kept. Never throws. */
async function saveFailures(sql: Sql, phrase: string, example: string, failures: EstimateFailure[], log?: Log) {
  if (!failures.length) return;
  try {
    await sql`INSERT INTO food_requests (phrase, example, reason, estimate_failures)
      SELECT ${phrase}, ${example.slice(0, 200)}, 'no matching food', ${sql.json(failures as never)}
      WHERE (SELECT count(*) FROM food_requests) < ${maxRequests()}
      ON CONFLICT (phrase) DO UPDATE SET estimate_failures = (
        SELECT coalesce(jsonb_agg(f), '[]'::jsonb) FROM (
          SELECT f FROM jsonb_array_elements(EXCLUDED.estimate_failures || food_requests.estimate_failures) f LIMIT ${MAX_FAILURES_KEPT}) kept)`;
  } catch (err) {
    log?.error({ err: (err as Error).message }, 'estimate failure not recorded');
  }
}

async function saveEstimate(sql: Sql, phrase: string, example: string, estimate: StoredEstimate) {
  // Only a food without an estimate gets one here: two requests estimating the same new food at once keep the first
  // (no silent overwrite). An existing pending estimate is only ever replaced by replaceEstimate, with history; an
  // approved or rejected one never is.
  await sql`INSERT INTO food_requests (phrase, example, reason, estimate, estimate_status)
    VALUES (${phrase}, ${example.slice(0, 200)}, 'no matching food', ${sql.json(estimate as never)}, 'pending')
    ON CONFLICT (phrase) DO UPDATE SET estimate = EXCLUDED.estimate, estimate_status = 'pending'
    WHERE food_requests.estimate IS NULL AND food_requests.estimate_status IN ('none', 'pending')`;
}

// --- Re-estimating stale pending estimates (M5) ---------------------------------------------------------------
const days = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** A pending estimate older than this many days is re-estimated (NUTRIKIT_ESTIMATE_MAX_AGE_DAYS, default 30). */
const maxAgeMs = () => days('NUTRIKIT_ESTIMATE_MAX_AGE_DAYS', 30) * 86_400_000;
/** After a failed re-estimate, wait this long before trying that food again (NUTRIKIT_REESTIMATE_RETRY_MINUTES, default 60). */
const retryAfterMs = () => days('NUTRIKIT_REESTIMATE_RETRY_MINUTES', 60) * 60_000;
/** A claim older than this is abandoned (its request died); another request may take it over. */
const claimTtlMs = () => Math.max(2 * (Number(process.env.NUTRIKIT_AI_TIMEOUT_MS) || 60_000), 120_000);
const MAX_HISTORY = 5;

/**
 * Why a stored pending estimate should be made again, or null when it is current: older than the maximum age, made
 * by another prompt or calculation version (an estimate stored before versions were recorded counts as another
 * version), or failing today's checks. Approved and rejected estimates are never passed here.
 */
export function staleReason(e: StoredEstimate, now = Date.now()): string | null {
  const at = Date.parse(e.at);
  if (!Number.isFinite(at)) return 'no valid estimate time';
  if (now - at > maxAgeMs()) return `older than ${Math.round(maxAgeMs() / 86_400_000)} days`;
  if (e.promptVersion !== ESTIMATE_PROMPT_VERSION) return e.promptVersion ? `prompt version ${e.promptVersion} is not the current ${ESTIMATE_PROMPT_VERSION}` : 'made before prompt versions were recorded';
  if (e.calcVersion !== ESTIMATE_CALC_VERSION) return e.calcVersion ? `calculation version ${e.calcVersion} is not the current ${ESTIMATE_CALC_VERSION}` : 'made before calculation versions were recorded';
  const problem = estimateProblem({ query: e.name, known: true, name: e.name, per100g: e.per100g, serving: e.serving, confidence: e.confidence });
  return problem ? `fails today's checks: ${problem}` : null;
}

/**
 * Claims a stale pending estimate for re-estimation. Atomic: of any number of concurrent requests exactly one gets
 * true; the rest keep serving the current estimate. Fails when the estimate changed (another request replaced it, or
 * an operator reviewed it), another live claim exists, or the food is backing off after a failed attempt.
 */
async function claimReestimate(sql: Sql, phrase: string, at: string): Promise<boolean> {
  const rows = await sql`UPDATE food_requests SET reestimate_claimed_at = now()
    WHERE phrase = ${phrase} AND estimate_status = 'pending' AND estimate->>'at' = ${at}
      AND (reestimate_claimed_at IS NULL OR reestimate_claimed_at < now() - ${claimTtlMs()} * interval '1 millisecond')
      AND (reestimate_after IS NULL OR reestimate_after <= now())
    RETURNING id`;
  return rows.length === 1;
}

/**
 * Replaces a claimed pending estimate with a validated new one, in one statement: the old estimate moves to the front
 * of the history (at most 5 kept) and the claim is released. Only when the row still holds the estimate that was read
 * and is still pending: otherwise nothing is written and false is returned (the new estimate is not used).
 */
async function replaceEstimate(sql: Sql, phrase: string, oldAt: string, estimate: StoredEstimate, reason: string): Promise<boolean> {
  const rows = await sql`UPDATE food_requests SET
      estimate_history = (SELECT coalesce(jsonb_agg(h), '[]'::jsonb) FROM (
        SELECT h FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object(
          'estimate', estimate, 'provider', estimate->'provider', 'model', estimate->'model',
          'promptVersion', estimate->'promptVersion', 'calcVersion', estimate->'calcVersion', 'estimatedAt', estimate->'at',
          'replacedAt', to_jsonb(now()), 'reason', to_jsonb(${reason}::text))) || estimate_history) h LIMIT ${MAX_HISTORY}) kept),
      estimate = ${sql.json(estimate as never)},
      reestimate_claimed_at = NULL, reestimate_after = NULL
    WHERE phrase = ${phrase} AND estimate_status = 'pending' AND estimate->>'at' = ${oldAt}
    RETURNING id`;
  return rows.length === 1;
}

/** Ends a claim that produced no replacement: keeps the current estimate, records why, and backs off. Never throws. */
async function releaseReestimate(sql: Sql, phrase: string, failures: EstimateFailure[], log?: Log) {
  try {
    await sql`UPDATE food_requests SET reestimate_claimed_at = NULL,
        reestimate_after = now() + ${retryAfterMs()} * interval '1 millisecond',
        estimate_failures = (SELECT coalesce(jsonb_agg(f), '[]'::jsonb) FROM (
          SELECT f FROM jsonb_array_elements(${sql.json(failures as never)}::jsonb || estimate_failures) f LIMIT ${MAX_FAILURES_KEPT}) kept)
      WHERE phrase = ${phrase}`;
  } catch (err) {
    log?.error({ err: (err as Error).message }, 're-estimate claim not released'); // it expires on its own
  }
}

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const singularUnit = (u: string) => u.trim().toLowerCase().replace(/(?<=[^s])s$/, '');
const sameUnit = (a: string, b: string) => {
  const ca = canonicalUnit(a);
  const cb = canonicalUnit(b);
  return ca && cb ? ca.unit === cb.unit : singularUnit(a) === singularUnit(b);
};

/**
 * How many units an AI serving holds: `quantity` when the estimate gives one; otherwise (estimates stored before
 * servings had a count) read from the label, only when that is unambiguous: "2 idlis" -> 2, "1 bowl" -> 1, "a glass"
 * -> 1, "100 g" -> 1. Ranges ("2-3 pieces"), vague amounts ("a few"), a second count ("1 plate (2 pieces)") or no
 * count at all give `count: null` with the reason in `unclear`: never an assumed 1.
 */
export function servingCount(serving: { label?: string; unit?: string; quantity?: number }): { count: number | null; unclear: string | null } {
  const q = serving.quantity;
  if (q !== undefined) {
    return typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= 50 ? { count: q, unclear: null } : { count: null, unclear: `quantity ${q}` };
  }
  // A weight or volume in brackets ("1 cup (240 ml)") describes the serving; it is not a count.
  const label = String(serving.label ?? '').toLowerCase().replace(/\(\s*~?\d+(\.\d+)?\s*(g|grams?|ml|oz|kcal)\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!label) return { count: null, unclear: 'no label' };
  if (/\d\s*(-|–|to|or)\s*\d/.test(label)) return { count: null, unclear: `a range in "${serving.label}"` };
  if (/\b(few|some|several|couple|handful|about|approx(imately)?|around|roughly)\b|~/.test(label)) return { count: null, unclear: `a vague amount in "${serving.label}"` };
  // "100 g", "250 ml": the serving is that amount, one of it.
  if (/^\d+(\.\d+)?\s*(g|grams?|ml|oz)$/.test(label)) return { count: 1, unclear: null };
  const m = /^(\d+(?:\.\d+)?|[a-z]+)\s+(.+)$/.exec(label);
  const n = m ? (/^\d/.test(m[1]) ? Number(m[1]) : COUNT_WORDS[m[1]]) : undefined;
  if (n == null || !(n > 0)) return { count: null, unclear: `no count in "${serving.label}"` };
  if (/\d/.test(m![2])) return { count: null, unclear: `more than one count in "${serving.label}"` };
  if (n < 1) return { count: null, unclear: `a fraction in "${serving.label}"` };
  return { count: n, unclear: null };
}

/** A logged item from an estimate, with the amount the person gave (or the AI's grams, or one typical serving). */
export function estimateItem(input: string, estimate: StoredEstimate, amount: { quantity: number | null; unit: string | null; grams?: number | null }, status: EstimateBasis['status'] = 'unstored'): LoggedItem {
  const catalog = estimate.sameAs ? getFood(estimate.sameAs.id) : undefined;
  const basis: EstimateBasis = {
    kind: catalog ? 'catalog-match' : 'ai-estimate',
    status,
    provider: estimate.provider,
    model: estimate.model ?? null,
    modelVersion: estimate.modelVersion ?? null,
    promptVersion: estimate.promptVersion ?? null,
    calcVersion: estimate.calcVersion ?? null,
    estimatedAt: estimate.at,
  };
  if (catalog) {
    // The model matched an existing food: log it from real data, with its own portions.
    const portion = amount.grams ? providedPortion(amount.grams, amount) : resolvePortion(catalog, amount.quantity, amount.unit);
    const grams = Math.round(portion.grams * 10) / 10;
    return {
      input,
      food: { id: catalog.id, name: catalog.name, source: catalog.source },
      quantity: portion.quantity,
      unit: portion.unit,
      grams,
      portionBasis: portion.portion,
      portionMethod: portion.method === 'provided-grams' ? 'provided-grams' : `ai-same-as-${portion.method}`,
      confidence: 'medium',
      nutrients: scaleNutrients(catalog.per100g, grams),
      alternatives: [],
      basis,
    };
  }
  const s = estimate.serving;
  const count = servingCount(s);
  // The whole serving as one portion: what every estimate used before servings carried a count, and still the
  // answer for a unit other than the serving's own ("1 plate" of a "2 idlis" serving is that serving).
  const whole = { label: s.label, amount: 1, unit: s.unit, grams: s.grams };
  let portions = [whole];
  if (count.count != null && count.count > 1) {
    // "2 idlis, 80 g": one idli is 40 g. A bare count ("1 idli", "3 idli") or the serving's own unit ("2 pieces")
    // counts single units; "1 serving" still finds the whole serving by its unit, and any other unit gets the whole
    // serving first, as before.
    const each = { label: `1 ${singularUnit(s.unit)}`, amount: 1, unit: s.unit, grams: s.grams / count.count };
    const servingWhole = { ...whole, unit: 'serving' };
    portions = !amount.unit ? [each] : sameUnit(amount.unit, s.unit) ? [each, servingWhole] : [servingWhole, each];
  }
  const food = { name: estimate.name, portions };
  const portion = amount.grams ? providedPortion(amount.grams, amount) : resolvePortion(food, amount.quantity, amount.unit);
  const grams = Math.round(portion.grams * 10) / 10;
  // A serving whose count can't be read is used whole, as before, and said to be unclear rather than taken as one.
  const unclear = !amount.grams && count.unclear != null;
  return {
    input,
    food: { id: 0, name: estimate.name, source: 'ai-estimate' },
    quantity: portion.quantity,
    unit: portion.unit,
    grams,
    portionBasis: unclear ? `${portion.portion ?? s.label}; the serving's count is unclear (${count.unclear}), so the whole ${s.grams} g serving was used` : portion.portion,
    portionMethod: portion.method === 'provided-grams' ? 'provided-grams' : unclear ? 'ai-estimate-unclear-serving-count' : `ai-estimate-${portion.method}`,
    confidence: 'low',
    // A nutrient the estimate left unknown (null) is left out of the item, never counted as 0.
    nutrients: scaleNutrients(Object.fromEntries(Object.entries(estimate.per100g).filter(([, v]) => v != null)) as Record<string, number>, grams),
    alternatives: [],
    basis,
  };
}

/** The values every estimate must give, each a number of at least 0. */
const REQUIRED_KEYS = ['calories', 'protein', 'fat', 'carbs'] as const;
/** Must be given, but may be null (unknown); a number given must still be valid. A reply that leaves one out is malformed. */
const OPTIONAL_KEYS = ['fiber', 'sugar', 'saturatedFat', 'sodium'] as const;
const validAmount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * Why an estimate can't be used, or null when it can. The same arithmetic the build applies to recipes
 * (scripts/recipes.mjs): calories must agree with protein, carbs and fat, and no part can outweigh its whole.
 */
export function estimateProblem(e: FoodEstimate): string | null {
  if (!e || typeof e !== 'object') return 'no estimate';
  if (!e.known) return 'not a food';
  if (typeof e.name !== 'string' || !e.name.trim()) return 'no name';
  const n = e.per100g;
  if (!n || REQUIRED_KEYS.some((k) => !validAmount(n[k])) || OPTIONAL_KEYS.some((k) => !(k in n) || (n[k] !== null && !validAmount(n[k])))) return 'missing or negative values';
  if (n.calories > 900) return `${n.calories} kcal per 100 g is more than pure fat`;
  if (n.protein + n.carbs + n.fat > 100) return 'protein, carbs and fat weigh more than 100 g per 100 g';
  if (n.sugar != null && n.sugar > n.carbs + 0.5) return 'sugar exceeds carbs';
  if (n.saturatedFat != null && n.saturatedFat > n.fat + 0.5) return 'saturated fat exceeds fat';
  const atwater = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  if (Math.abs(atwater - n.calories) > Math.max(30, 0.25 * n.calories)) return `${n.calories} kcal disagrees with its macros (${Math.round(atwater)} kcal)`;
  if (!(e.serving?.grams >= 5 && e.serving.grams <= 2000)) return `serving of ${e.serving?.grams} g`;
  if (e.serving.quantity !== undefined && !(Number.isFinite(e.serving.quantity) && e.serving.quantity > 0 && e.serving.quantity <= 50)) return `serving quantity ${e.serving.quantity}`;
  return null;
}

/** Two calorie figures within 30% of the larger (and within 25 kcal for very light foods). */
const agrees = (a: number, b: number) => Math.abs(a - b) <= Math.max(25, 0.3 * Math.max(a, b));

/**
 * Asks the provider to estimate foods the catalog lacks and keeps the answers that pass estimateProblem(), keyed by
 * requestKey(query). Foods whose answer fails, or that the reply leaves out, are asked once more; a second failure
 * leaves them out (unmatched) and lists them in `rejected`. Both attempts share one deadline. When the second attempt
 * fails outright, the first attempt's estimates are kept and the foods it retried are rejected; when the first fails,
 * the error is thrown.
 * scripts/eval-estimates.ts measures this same function against the benchmark sets in data/eval/sets.
 */
export async function requestEstimates(provider: AIProvider, queries: string[], candidates?: CatalogCandidate[][], opts: { prompt?: EstimatePrompt } = {}): Promise<{ estimates: Map<string, StoredEstimate>; usage: AIUsage; rejected: { query: string; problem: string; problems: string[] }[] }> {
  const estimates = new Map<string, StoredEstimate>();
  let rejected: { query: string; problem: string }[] = [];
  let usage: AIUsage = { inputTokens: 0, outputTokens: 0 };
  let ask = queries;
  const offered = new Map(queries.map((q, i) => [requestKey(q), candidates?.[i] ?? []]));
  const promptVersion = opts.prompt ? promptVersionOf(opts.prompt) : ESTIMATE_PROMPT_VERSION;
  const problemsSoFar = new Map<string, string[]>(); // per food key: why its earlier answers were rejected
  const signal = aiDeadline();
  for (let attempt = 0; attempt < 2 && ask.length; attempt++) {
    let out: Awaited<ReturnType<NonNullable<AIProvider['estimateFoods']>>>;
    try {
      if (attempt > 0 && signal.aborted) throw new Error('no time left to ask again');
      out = await provider.estimateFoods!({ foods: ask, ...(candidates ? { candidates: ask.map((q) => offered.get(requestKey(q)) ?? []) } : {}), signal, ...(opts.prompt ? { prompt: opts.prompt } : {}) });
    } catch (err) {
      if (attempt === 0) throw err;
      // The retry failed: what the first attempt estimated stands, and the foods asked again are left out.
      usage = addUsage(usage, (err as { usage?: AIUsage }).usage);
      rejected = ask.map((query) => ({ query, problem: `not answered: ${(err as Error).message}` }));
      break;
    }
    usage = addUsage(usage, out?.usage);
    const failed: { query: string; problem: string }[] = [];
    const answered = new Set<string>();
    const keys = ask.map(requestKey);
    for (const e of Array.isArray(out?.foods) ? out.foods : []) {
      if (typeof e?.query !== 'string') continue;
      const key = requestKey(e.query);
      const at = keys.indexOf(key);
      if (at < 0 || answered.has(key)) continue; // not asked, or answered twice: the first answer counts
      answered.add(key);
      // A catalog food the model judged the same dish is used as it is, when it is one we offered and the model's own
      // estimate agrees with it: words can name the same dish while the recipes differ (a yogurt dip made with sour
      // cream), and two independent figures within 30% is evidence they don't.
      const problem = estimateProblem(e);
      const offeredMatch = e.sameAs != null ? offered.get(key)?.find((c) => c.id === e.sameAs) : undefined;
      const same = !problem && offeredMatch?.calories != null && agrees(offeredMatch.calories, e.per100g.calories) ? offeredMatch : undefined;
      if (!problem) {
        const earlier = problemsSoFar.get(key);
        estimates.set(key, {
          name: same ? same.name : e.name, per100g: e.per100g, serving: e.serving, confidence: e.confidence,
          provider: provider.name, model: out?.model ?? provider.model ?? null, at: new Date().toISOString(), sameAs: same ? { id: same.id, name: same.name } : null,
          promptVersion, calcVersion: ESTIMATE_CALC_VERSION,
          ...(out?.modelVersion ? { modelVersion: out.modelVersion } : {}),
          candidates: (offered.get(key) ?? []).map((c) => ({ id: c.id, name: c.name, calories: c.calories })),
          attempts: attempt + 1,
          ...(earlier?.length ? { previousProblems: earlier } : {}),
        });
      }
      // "Not a food" is an answer, not a mistake: it is not asked again.
      else if (problem !== 'not a food') failed.push({ query: ask[at], problem });
    }
    // A food the reply left out (or renamed beyond recognition) is a failed answer too.
    keys.forEach((key, i) => { if (!answered.has(key)) failed.push({ query: ask[i], problem: 'no answer for this food' }); });
    rejected = failed;
    for (const f of failed) problemsSoFar.set(requestKey(f.query), [...(problemsSoFar.get(requestKey(f.query)) ?? []), f.problem]);
    ask = failed.map((f) => f.query);
  }
  // Every rejected answer's reason, oldest first, for the foods left without an estimate.
  const withHistory = rejected.map((r) => {
    const earlier = (problemsSoFar.get(requestKey(r.query)) ?? []).filter((p, k, all) => !(k === all.length - 1 && p === r.problem));
    return { ...r, problems: [...earlier, r.problem] };
  });
  return { estimates, usage, rejected: withHistory };
}

/** The catalog foods closest to a phrase by its words (at most 5), offered to the model as possibly the same dish. */
export function catalogCandidates(food: string, exclude: (id: number, name: string) => boolean = () => false): CatalogCandidate[] {
  return searchFoods(food, { limit: 8 }).results
    .filter((r) => !exclude(r.id, r.name))
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, calories: getFood(r.id)?.per100g.calories ?? null }));
}

export interface Unknown {
  /** The phrase as unmatched. */
  unmatched: Unmatched;
  /** The amount to log: from the AI's parse when there was one, otherwise parsed from the phrase. */
  amount: { quantity: number | null; unit: string | null; grams?: number | null };
  /** The food words. */
  food: string;
}

/**
 * Covers unmatched foods with estimates: stored ones first, then (with a provider) new ones from the AI, which are
 * stored as pending. A stored pending estimate that has gone stale (staleReason) is re-estimated by at most one
 * request at a time: the request that wins the claim asks the AI and swaps the estimate in only once the new one has
 * passed every check; until then, and if that fails, the current estimate is served. Approved and rejected estimates
 * are never re-estimated here. `items[i]` is the logged item for `unknowns[i]`, or null when it stays unmatched;
 * `usage` is the AI usage to charge.
 */
export async function coverUnknowns(sql: Sql, unknowns: Unknown[], provider: AIProvider | null, opts: { store: boolean; pending: boolean }): Promise<{ items: (LoggedItem | null)[]; usage: AIUsage | null }> {
  if (!unknowns.length) return { items: [], usage: null };
  const keyed = unknowns.map((u) => ({ ...u, key: requestKey(u.food) }));
  const keys = [...new Set(keyed.map((u) => u.key))];
  const stored = opts.store ? await storedEstimates(sql, keys, { pending: opts.pending }) : new Map<string, Held>();
  // A food whose estimate an operator rejected is not estimated again: it stays unmatched until the catalog has it.
  const rejected = opts.store && provider?.estimateFoods
    ? new Set((await sql<{ phrase: string }[]>`SELECT phrase FROM food_requests WHERE phrase IN ${sql(keys)} AND estimate_status = 'rejected'`).map((r) => r.phrase))
    : new Set<string>();
  // A bare word with no single defensible food ("chicken") is asked about, not estimated (audit P0-4).
  const fresh = provider?.estimateFoods
    ? keys.filter((k) => !stored.has(k) && !rejected.has(k) && k.length >= 2 && !ambiguousBare(k)).slice(0, MAX_ESTIMATES_PER_CALL)
    : [];
  // Stale pending estimates this request re-estimates: only the ones it claims, within the same per-call cap.
  const redo = new Map<string, { at: string; reason: string }>();
  if (provider?.estimateFoods && opts.store) {
    for (const k of keys) {
      if (fresh.length + redo.size >= MAX_ESTIMATES_PER_CALL) break;
      const held = stored.get(k);
      if (held?.status !== 'pending') continue;
      const reason = staleReason(held.estimate);
      if (reason && await claimReestimate(sql, k, held.estimate.at)) redo.set(k, { at: held.estimate.at, reason });
    }
  }
  const ask = [...fresh, ...redo.keys()];
  const failure = (problem: string): EstimateFailure => ({ at: new Date().toISOString(), provider: provider!.name, model: provider!.model ?? null, promptVersion: ESTIMATE_PROMPT_VERSION, problem });
  let usage: AIUsage | null = null;
  let made = new Map<string, StoredEstimate>();
  let rejectedAnswers: { query: string; problem: string; problems: string[] }[] = [];
  let providerFailed = false;
  if (ask.length) {
    try {
      const out = await requestEstimates(provider!, ask, ask.map((k) => catalogCandidates(keyed.find((u) => u.key === k)!.food)));
      usage = out.usage;
      made = out.estimates;
      rejectedAnswers = out.rejected;
    } catch (err) {
      // The provider failed (timeout, rate limit, outage): every re-estimate keeps its current estimate and backs off.
      providerFailed = true;
      for (const k of redo.keys()) await releaseReestimate(sql, k, [failure(`re-estimate failed: ${(err as Error).message}`)]);
      if (fresh.length) throw err; // as before: a call that needed new estimates fails with the provider
      usage = (err as { usage?: AIUsage }).usage ?? null; // tokens spent before the failure are still charged
    }
  }
  const failuresFor = (key: string) => rejectedAnswers.filter((r) => requestKey(r.query) === key).flatMap((r) => r.problems).reverse().map(failure);
  for (const k of fresh) {
    const e = made.get(k);
    if (e) stored.set(k, { estimate: e, status: opts.store ? 'pending' : 'unstored' });
  }
  try {
    if (opts.store) {
      for (const key of fresh) {
        const held = stored.get(key);
        const example = keyed.find((u) => u.key === key)!.unmatched.text;
        // No usable answer: keep why, so an operator can see what the AI said about this food.
        if (held) await saveEstimate(sql, key, example, held.estimate);
        else await saveFailures(sql, key, example, failuresFor(key));
      }
      for (const [key, { at, reason }] of redo) {
        const e = made.get(key);
        if (!e) {
          // The answer failed the checks: keep the current estimate, record why, back off. (A provider failure was
          // already released above.)
          if (!providerFailed) await releaseReestimate(sql, key, failuresFor(key).map((f) => ({ ...f, problem: `re-estimate rejected: ${f.problem}` })));
          continue;
        }
        // Swapped in only if the row still holds the estimate this request read; otherwise the current one stands.
        if (await replaceEstimate(sql, key, at, e, reason)) stored.set(key, { estimate: e, status: 'pending' });
      }
    }
    const used = new Set<string>();
    const items = keyed.map((u) => {
      const held = stored.get(u.key);
      if (!held) return null;
      used.add(u.key);
      return estimateItem(u.unmatched.text, held.estimate, u.amount, held.status);
    });
    if (opts.store && used.size) await sql`UPDATE food_requests SET estimate_uses = estimate_uses + 1 WHERE phrase IN ${sql([...used])}`;
    return { items, usage };
  } catch (err) {
    throw withUsage(err, usage); // the estimates were made: their tokens are charged
  }
}

/**
 * Rules-based text logging with food requests: counts what didn't match (when `live`) and logs any of it that has an
 * approved estimate. No AI call is made. Test-key calls pass `live: false` and get plain `logText`.
 */
export async function logTextWithRequests(sql: Sql, text: string, { live, log }: { live: boolean; log?: Log }): Promise<TextLog> {
  const r = logText(text);
  if (!live || !r.unmatched.length) return r;
  await recordMisses(sql, r.unmatched, log);
  const unknowns: Unknown[] = r.unmatched.map((u) => {
    const p = phraseParts(u.text);
    return { unmatched: u, food: p.food, amount: { quantity: p.quantity, unit: p.unit } };
  });
  let covered: (LoggedItem | null)[];
  try {
    covered = (await coverUnknowns(sql, unknowns, null, { store: true, pending: false })).items;
  } catch (err) {
    log?.error({ err: (err as Error).message }, 'stored estimates not read');
    return r;
  }
  if (!covered.some(Boolean)) return r;
  const items = [...r.items, ...covered.filter((i): i is LoggedItem => i !== null)];
  return { ...r, items, unmatched: r.unmatched.filter((_, k) => !covered[k]), totals: sumNutrients(items.map((i) => i.nutrients)) };
}

/** Operator list: open requests by default, most asked first. */
export async function listFoodRequests(sql: Sql, { status = 'open', q }: { status?: RequestStatus | 'all'; q?: string } = {}): Promise<FoodRequest[]> {
  const where = [
    status === 'all' ? sql`TRUE` : sql`status = ${status}`,
    q ? sql`phrase ILIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`}` : sql`TRUE`,
  ];
  return sql<FoodRequest[]>`SELECT ${ROW(sql)} FROM food_requests WHERE ${where[0]} AND ${where[1]}
    ORDER BY count DESC, last_seen DESC LIMIT 200`;
}

/** Operator update: status, note, and approving or rejecting the stored estimate. */
export async function updateFoodRequest(sql: Sql, id: number, change: { status?: RequestStatus; note?: string | null; estimateStatus?: 'approved' | 'rejected' }): Promise<FoodRequest | null> {
  const [row] = await sql<FoodRequest[]>`UPDATE food_requests SET
      status = COALESCE(${change.status ?? null}, status),
      note = CASE WHEN ${change.note !== undefined}::boolean THEN ${change.note ?? null} ELSE note END,
      estimate_status = CASE WHEN ${change.estimateStatus ?? null}::text IS NOT NULL AND estimate IS NOT NULL THEN ${change.estimateStatus ?? null} ELSE estimate_status END,
      estimate_reviewed_at = CASE WHEN ${change.estimateStatus ?? null}::text IS NOT NULL AND estimate IS NOT NULL THEN now() ELSE estimate_reviewed_at END
    WHERE id = ${id} RETURNING ${ROW(sql)}`;
  return row ?? null;
}

/** Counts for the admin overview. */
export async function foodRequestCounts(sql: Sql) {
  const [r] = await sql<{ open: number; pendingEstimates: number; approvedEstimates: number }[]>`SELECT
    count(*) FILTER (WHERE status = 'open')::int AS open,
    count(*) FILTER (WHERE estimate_status = 'pending')::int AS "pendingEstimates",
    count(*) FILTER (WHERE estimate_status = 'approved')::int AS "approvedEstimates"
    FROM food_requests`;
  return r;
}
