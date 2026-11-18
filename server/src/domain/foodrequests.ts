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
import type { AIProvider, AIUsage, CatalogCandidate, FoodEstimate } from './providers/index.ts';
import { getFood } from './db.ts';
import { searchFoods } from './search.ts';
import { logText, splitMealText, type LoggedItem, type TextLog, type Unmatched } from './textlog.ts';
import { resolvePortion } from './units.ts';
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
  /** Set when the model judged an existing catalog food to be this same dish: that food is logged instead. */
  sameAs?: { id: number; name: string } | null;
}

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
  status, note, estimate, estimate_status AS "estimateStatus", estimate_uses AS "estimateUses"`;

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

/** Stored estimates for these food keys: approved ones always, pending ones only when `pending` is set. */
export async function storedEstimates(sql: Sql, keys: string[], { pending = false } = {}): Promise<Map<string, StoredEstimate>> {
  if (!keys.length) return new Map();
  const statuses = pending ? ['approved', 'pending'] : ['approved'];
  const rows = await sql<{ phrase: string; estimate: StoredEstimate }[]>`SELECT phrase, estimate FROM food_requests
    WHERE phrase IN ${sql(keys)} AND estimate IS NOT NULL AND estimate_status IN ${sql(statuses)}`;
  return new Map(rows.map((r) => [r.phrase, r.estimate]));
}

async function saveEstimate(sql: Sql, phrase: string, example: string, estimate: StoredEstimate) {
  // A new estimate never replaces one an operator has already approved or rejected.
  await sql`INSERT INTO food_requests (phrase, example, reason, estimate, estimate_status)
    VALUES (${phrase}, ${example.slice(0, 200)}, 'no matching food', ${sql.json(estimate as never)}, 'pending')
    ON CONFLICT (phrase) DO UPDATE SET estimate = EXCLUDED.estimate, estimate_status = 'pending'
    WHERE food_requests.estimate_status IN ('none', 'pending')`;
}

/** A logged item from an estimate, with the amount the person gave (or the AI's grams, or one typical serving). */
export function estimateItem(input: string, estimate: StoredEstimate, amount: { quantity: number | null; unit: string | null; grams?: number | null }): LoggedItem {
  const catalog = estimate.sameAs ? getFood(estimate.sameAs.id) : undefined;
  if (catalog) {
    // The model matched an existing food: log it from real data, with its own portions.
    const portion = amount.grams
      ? { grams: amount.grams, quantity: amount.quantity ?? 1, unit: amount.unit || 'serving', portion: null, method: 'provided-grams' }
      : resolvePortion(catalog, amount.quantity, amount.unit);
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
    };
  }
  const s = estimate.serving;
  const food = { name: estimate.name, portions: [{ label: s.label, amount: 1, unit: s.unit, grams: s.grams }] };
  const portion = amount.grams
    ? { grams: amount.grams, quantity: amount.quantity ?? 1, unit: amount.unit || 'serving', portion: null, method: 'provided-grams' }
    : resolvePortion(food, amount.quantity, amount.unit);
  const grams = Math.round(portion.grams * 10) / 10;
  return {
    input,
    food: { id: 0, name: estimate.name, source: 'ai-estimate' },
    quantity: portion.quantity,
    unit: portion.unit,
    grams,
    portionBasis: portion.portion,
    portionMethod: portion.method === 'provided-grams' ? 'provided-grams' : `ai-estimate-${portion.method}`,
    confidence: 'low',
    nutrients: scaleNutrients(estimate.per100g as Record<string, number>, grams),
    alternatives: [],
  };
}

/**
 * Why an estimate can't be used, or null when it can. The same arithmetic the build applies to recipes
 * (scripts/recipes.mjs): calories must agree with protein, carbs and fat, and no part can outweigh its whole.
 */
export function estimateProblem(e: FoodEstimate): string | null {
  if (!e.known) return 'not a food';
  if (!e.name?.trim()) return 'no name';
  const n = e.per100g;
  if (!n || Object.values(n).some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return 'missing or negative values';
  if (n.calories > 900) return `${n.calories} kcal per 100 g is more than pure fat`;
  if (n.protein + n.carbs + n.fat > 100) return 'protein, carbs and fat weigh more than 100 g per 100 g';
  if (n.sugar > n.carbs + 0.5) return 'sugar exceeds carbs';
  if (n.saturatedFat > n.fat + 0.5) return 'saturated fat exceeds fat';
  const atwater = 4 * n.protein + 4 * n.carbs + 9 * n.fat;
  if (Math.abs(atwater - n.calories) > Math.max(30, 0.25 * n.calories)) return `${n.calories} kcal disagrees with its macros (${Math.round(atwater)} kcal)`;
  if (!(e.serving?.grams >= 5 && e.serving.grams <= 2000)) return `serving of ${e.serving?.grams} g`;
  return null;
}

/** Two calorie figures within 30% of the larger (and within 25 kcal for very light foods). */
const agrees = (a: number, b: number) => Math.abs(a - b) <= Math.max(25, 0.3 * Math.max(a, b));

const addUsage = (a: AIUsage, b: AIUsage): AIUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

/**
 * Asks the provider to estimate foods the catalog lacks and keeps the answers that pass estimateProblem(), keyed by
 * requestKey(query). Foods whose answer fails are asked once more; a second failure leaves them out (unmatched).
 * scripts/eval-estimates.ts measures this same function against INDB's published values.
 */
export async function requestEstimates(provider: AIProvider, queries: string[], candidates?: CatalogCandidate[][]): Promise<{ estimates: Map<string, StoredEstimate>; usage: AIUsage; rejected: { query: string; problem: string }[] }> {
  const estimates = new Map<string, StoredEstimate>();
  let rejected: { query: string; problem: string }[] = [];
  let usage: AIUsage = { inputTokens: 0, outputTokens: 0 };
  let ask = queries;
  const offered = new Map(queries.map((q, i) => [requestKey(q), candidates?.[i] ?? []]));
  for (let attempt = 0; attempt < 2 && ask.length; attempt++) {
    const keys = ask.map(requestKey);
    const out = await provider.estimateFoods!({ foods: ask, ...(candidates ? { candidates: ask.map((q) => offered.get(requestKey(q)) ?? []) } : {}) });
    usage = addUsage(usage, out.usage);
    const failed: { query: string; problem: string }[] = [];
    for (const e of out.foods) {
      const key = requestKey(e.query);
      const at = keys.indexOf(key);
      if (at < 0 || estimates.has(key)) continue;
      // A catalog food the model judged the same dish is used as it is, when it is one we offered and the model's own
      // estimate agrees with it: words can name the same dish while the recipes differ (a yogurt dip made with sour
      // cream), and two independent figures within 30% is evidence they don't.
      const offeredMatch = e.sameAs != null ? offered.get(key)?.find((c) => c.id === e.sameAs) : undefined;
      const same = offeredMatch && offeredMatch.calories != null && !estimateProblem(e) && agrees(offeredMatch.calories, e.per100g.calories) ? offeredMatch : undefined;
      const problem = same && e.known ? null : estimateProblem(e);
      if (!problem) {
        estimates.set(key, {
          name: same ? same.name : e.name, per100g: e.per100g, serving: e.serving, confidence: e.confidence,
          provider: provider.name, model: provider.model ?? null, at: new Date().toISOString(), sameAs: same ? { id: same.id, name: same.name } : null,
        });
      }
      // "Not a food" is an answer, not a mistake: it is not asked again.
      else if (problem !== 'not a food') failed.push({ query: ask[at], problem });
    }
    rejected = failed;
    ask = failed.map((f) => f.query);
  }
  return { estimates, usage, rejected };
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
 * stored as pending. `items[i]` is the logged item for `unknowns[i]`, or null when it stays unmatched; `usage` is
 * the AI usage to charge.
 */
export async function coverUnknowns(sql: Sql, unknowns: Unknown[], provider: AIProvider | null, opts: { store: boolean; pending: boolean }): Promise<{ items: (LoggedItem | null)[]; usage: AIUsage | null }> {
  if (!unknowns.length) return { items: [], usage: null };
  const keyed = unknowns.map((u) => ({ ...u, key: requestKey(u.food) }));
  const keys = [...new Set(keyed.map((u) => u.key))];
  const stored = opts.store ? await storedEstimates(sql, keys, { pending: opts.pending }) : new Map<string, StoredEstimate>();
  // A food whose estimate an operator rejected is not estimated again: it stays unmatched until the catalog has it.
  const rejected = opts.store && provider?.estimateFoods
    ? new Set((await sql<{ phrase: string }[]>`SELECT phrase FROM food_requests WHERE phrase IN ${sql(keys)} AND estimate_status = 'rejected'`).map((r) => r.phrase))
    : new Set<string>();
  const ask = provider?.estimateFoods
    ? keys.filter((k) => !stored.has(k) && !rejected.has(k) && k.length >= 2).slice(0, MAX_ESTIMATES_PER_CALL)
    : [];
  let usage: AIUsage | null = null;
  if (ask.length) {
    const out = await requestEstimates(provider!, ask, ask.map((k) => catalogCandidates(keyed.find((u) => u.key === k)!.food)));
    usage = out.usage;
    for (const [key, estimate] of out.estimates) {
      stored.set(key, estimate);
      if (opts.store) await saveEstimate(sql, key, keyed.find((u) => u.key === key)!.unmatched.text, estimate);
    }
  }
  const used = new Set<string>();
  const items = keyed.map((u) => {
    const estimate = stored.get(u.key);
    if (!estimate) return null;
    used.add(u.key);
    return estimateItem(u.unmatched.text, estimate, u.amount);
  });
  if (opts.store && used.size) await sql`UPDATE food_requests SET estimate_uses = estimate_uses + 1 WHERE phrase IN ${sql([...used])}`;
  return { items, usage };
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
      estimate_status = CASE WHEN ${change.estimateStatus ?? null}::text IS NOT NULL AND estimate IS NOT NULL THEN ${change.estimateStatus ?? null} ELSE estimate_status END
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
