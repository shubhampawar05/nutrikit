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
import type { AIProvider, AIUsage, FoodEstimate } from './providers/index.ts';
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
 * Asks the provider to estimate foods the catalog lacks and keeps the usable answers, keyed by requestKey(query).
 * scripts/eval-estimates.ts measures this same function against INDB's published values.
 */
export async function requestEstimates(provider: AIProvider, queries: string[]): Promise<{ estimates: Map<string, StoredEstimate>; usage: AIUsage }> {
  const keys = queries.map(requestKey);
  const out = await provider.estimateFoods!({ foods: queries });
  const estimates = new Map<string, StoredEstimate>();
  for (const e of out.foods) {
    const key = requestKey(e.query);
    if (!keys.includes(key) || !e.known || !(e.serving?.grams > 0) || !(e.per100g?.calories >= 0)) continue;
    estimates.set(key, { name: e.name, per100g: e.per100g, serving: e.serving, confidence: e.confidence, provider: provider.name, model: provider.model ?? null, at: new Date().toISOString() });
  }
  return { estimates, usage: out.usage };
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
    const out = await requestEstimates(provider!, ask);
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
