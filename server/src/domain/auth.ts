// API keys, short-lived access tokens, token-based usage metering and rate limiting.
//
// Credentials accepted by the API (Authorization: Bearer ...):
//   nk_live_... / nk_test_...  secret API key, created in the developer portal; stored only as a SHA-256 hash.
//             Keys made before test mode existed are plain nk_... and are live.
//   nkat_...  access token from POST /v1/auth/token; HMAC-signed, expires after 1 hour.
//             Lets a backend keep the secret key and hand mobile/web clients a short-lived token.
//
// Data functions take the Postgres pool (`sql`) as their first argument.
//
// Calls are charged in "tokens": a flat cost per endpoint, plus 1 token per 1,000 model tokens on
// AI-assisted calls. Accounts get a monthly allowance and per-minute rate from their plan; keys made
// by an operator (admin API / CLI) may carry their own allowance instead.
//
// Test keys count against a separate monthly test allowance and rate (NUTRIKIT_TEST_TOKENS, NUTRIKIT_TEST_RATE_LIMIT),
// never against the plan, and never reach the AI provider (routes use the sample provider).
import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Fragment, Sql } from 'postgres';
import { PLANS, effectivePlan } from './accounts.ts';
import type { AIUsage } from './types.ts';

/** The authenticated caller: an API key (directly or via an access token), or the auth-off dev key. */
export interface KeyContext {
  id: string;
  name: string;
  accountId: string | null;
  via: 'api_key' | 'access_token' | 'none';
  mode: KeyMode;
  tokenLimit: number | null; // null = unlimited
  ratePerMinute: number;
}

export type KeyMode = 'live' | 'test';
export const KEY_MODES: readonly KeyMode[] = ['live', 'test'];

export interface NewKey {
  id: string;
  key: string; // the secret; shown once
  name: string | null | undefined;
  mode: KeyMode;
  tokenLimit: number | null;
  prefix: string;
}

export interface KeySummary {
  id: string;
  name: string;
  mode: KeyMode;
  createdBy: string | null; // the creator's name; null for operator keys or when they deleted their login
  tokenLimit?: number | null; // operator listing only
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  accountId?: string | null; // operator listing only
  usedThisMonth: number;
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  expires_at: string;
}

export interface EndpointUsage {
  endpoint: string;
  calls: number;
  tokens: number;
}

export interface UsageSummary {
  keyId: string;
  mode: KeyMode;
  accountId: string | null;
  periodStart: string;
  tokenLimit: number | null;
  used: number;
  remaining: number | null;
  byEndpoint: EndpointUsage[];
}

export interface UsageDay {
  day: string; // YYYY-MM-DD (UTC)
  tokens: number;
  calls: number;
}

interface KeyRow {
  id: string;
  name: string;
  mode: KeyMode;
  token_limit: number | null;
  account_id: string | null;
  plan: string | null;
}

type TokenCheck = { expired: true; kid?: undefined } | { kid: string; expired?: undefined };

export const COSTS = {
  nutrients: 0,
  usage: 0,
  token: 0,
  search: 1,
  food: 1,
  foodNutrients: 1,
  barcode: 5,
  logText: 5,
  logVoice: 5,
  labelText: 5,
  logPhoto: 20,
  labelImage: 20,
  mealPlan: 20,
  advisor: 5,
};

export type CostKey = keyof typeof COSTS;

export const ACCESS_TOKEN_TTL = 3600;
const DEFAULT_RATE = Number(process.env.NUTRIKIT_RATE_LIMIT || 120);
const TEST_TOKENS = () => Number(process.env.NUTRIKIT_TEST_TOKENS) || 5_000;
const TEST_RATE = () => Number(process.env.NUTRIKIT_TEST_RATE_LIMIT) || 30;
/** The test allowance per team (or per operator test key), per month. */
export const testAllowance = () => TEST_TOKENS();
const hash = (key: string) => crypto.createHash('sha256').update(key).digest('hex');
export const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

// ---------------------------------------------------------------- keys

export async function createKey(sql: Sql, { name, tokenLimit = null, accountId = null, mode = 'live', createdBy = null }: { name?: string | null; tokenLimit?: number | null; accountId?: string | null; mode?: KeyMode; createdBy?: string | null }): Promise<NewKey> {
  if (!KEY_MODES.includes(mode)) throw Object.assign(new Error('mode must be live or test'), { status: 400, code: 'invalid_request' });
  const id = `key_${crypto.randomBytes(6).toString('hex')}`;
  const key = `nk_${mode}_${crypto.randomBytes(32).toString('base64url')}`;
  await sql`INSERT INTO api_keys (id, key_hash, name, token_limit, account_id, mode, created_by)
    VALUES (${id}, ${hash(key)}, ${String(name || 'unnamed').slice(0, 100)}, ${tokenLimit == null ? null : Number(tokenLimit)}, ${accountId}, ${mode}, ${createdBy})`;
  return { id, key, name, mode, tokenLimit, prefix: key.slice(0, 12) };
}

export async function listKeys(sql: Sql, accountId?: string): Promise<KeySummary[]> {
  const used = sql`(SELECT COALESCE(SUM(u.tokens), 0) FROM usage u WHERE u.key_id = k.id AND u.at >= ${monthStart()}) AS "usedThisMonth"`;
  const rows = accountId === undefined
    ? await sql<KeySummary[]>`SELECT k.id, k.name, k.mode, c.name AS "createdBy", k.token_limit AS "tokenLimit", k.created_at AS "createdAt", k.revoked_at AS "revokedAt", k.last_used_at AS "lastUsedAt", k.account_id AS "accountId", ${used}
        FROM api_keys k LEFT JOIN users c ON c.id = k.created_by ORDER BY k.created_at`
    : await sql<KeySummary[]>`SELECT k.id, k.name, k.mode, c.name AS "createdBy", k.created_at AS "createdAt", k.revoked_at AS "revokedAt", k.last_used_at AS "lastUsedAt", ${used}
        FROM api_keys k LEFT JOIN users c ON c.id = k.created_by WHERE k.account_id = ${accountId} ORDER BY k.created_at DESC`;
  return rows.map((k) => ({ ...k }));
}

export async function newestActiveKey(sql: Sql, accountId: string, mode?: KeyMode): Promise<{ id: string; name: string; mode: KeyMode } | null> {
  const [row] = await sql<{ id: string; name: string; mode: KeyMode }[]>`SELECT id, name, mode FROM api_keys
    WHERE account_id = ${accountId} AND revoked_at IS NULL AND (${mode ?? null}::text IS NULL OR mode = ${mode ?? null})
    ORDER BY created_at DESC LIMIT 1`;
  return row ? { ...row } : null;
}

export async function activeKeyCount(sql: Sql, accountId: string, mode: KeyMode = 'live'): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ${accountId} AND mode = ${mode} AND revoked_at IS NULL`;
  return n;
}

/** The mode of one of the account's active keys, or null when it isn't theirs or is revoked. */
export async function keyMode(sql: Sql, id: string, accountId: string): Promise<KeyMode | null> {
  const [row] = await sql<{ mode: KeyMode }[]>`SELECT mode FROM api_keys WHERE id = ${id} AND account_id = ${accountId} AND revoked_at IS NULL`;
  return row?.mode ?? null;
}

export async function revokeKey(sql: Sql, id: string, accountId?: string): Promise<boolean> {
  const r = accountId === undefined
    ? await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`
    : await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND account_id = ${accountId} AND revoked_at IS NULL`;
  return r.count > 0;
}

/**
 * Replaces an active key with a fresh one under the same name, mode and token limit, in one transaction: the old key
 * stops working as the new one is issued, so this works even when the account is at its plan's key limit.
 * Returns null when the key is not this account's or is already revoked.
 */
export async function regenerateKey(sql: Sql, id: string, accountId: string, createdBy: string | null = null): Promise<NewKey | null> {
  return sql.begin(async (tx) => {
    const [old] = await tx<{ name: string; tokenLimit: number | null; mode: KeyMode }[]>`UPDATE api_keys SET revoked_at = now()
      WHERE id = ${id} AND account_id = ${accountId} AND revoked_at IS NULL
      RETURNING name, token_limit AS "tokenLimit", mode`;
    if (!old) return null;
    return createKey(tx as unknown as Sql, { name: old.name, tokenLimit: old.tokenLimit, accountId, mode: old.mode, createdBy });
  });
}

// ---------------------------------------------------------------- access tokens

// The signing secret never changes once created, so it is read from the database once per pool.
const secrets = new WeakMap<Sql, Promise<string>>();
async function tokenSecret(sql: Sql): Promise<string> {
  if (process.env.NUTRIKIT_TOKEN_SECRET) return process.env.NUTRIKIT_TOKEN_SECRET;
  if (!secrets.has(sql)) {
    secrets.set(sql, (async () => {
      await sql`INSERT INTO meta (key, value) VALUES ('token_secret', ${crypto.randomBytes(32).toString('hex')}) ON CONFLICT (key) DO NOTHING`;
      const [row] = await sql<{ value: string }[]>`SELECT value FROM meta WHERE key = 'token_secret'`;
      return row.value;
    })());
  }
  return secrets.get(sql)!;
}

const sign = async (sql: Sql, payload: string) => crypto.createHmac('sha256', await tokenSecret(sql)).update(payload).digest('base64url');

export async function issueAccessToken(sql: Sql, key: { id: string }): Promise<AccessToken> {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL;
  const payload = Buffer.from(JSON.stringify({ kid: key.id, exp })).toString('base64url');
  return {
    access_token: `nkat_${payload}.${await sign(sql, payload)}`,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

async function verifyAccessToken(sql: Sql, token: string): Promise<TokenCheck | null> {
  const [payload, sig] = token.slice(5).split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(await sign(sql, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const { kid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { kid: string; exp: unknown };
    if (typeof exp !== 'number' || exp * 1000 < Date.now()) return { expired: true };
    return { kid };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- authentication

function keyContext(row: KeyRow, via: 'api_key' | 'access_token'): KeyContext {
  const base = { id: row.id, name: row.name, accountId: row.account_id || null, via, mode: row.mode };
  if (row.mode === 'test') return { ...base, tokenLimit: row.token_limit ?? TEST_TOKENS(), ratePerMinute: TEST_RATE() };
  const plan = row.account_id ? PLANS[row.plan as string] || PLANS.free : null;
  return {
    ...base,
    tokenLimit: row.token_limit ?? (plan ? plan.monthlyTokens : null),
    ratePerMinute: plan ? plan.ratePerMinute : DEFAULT_RATE,
  };
}

const activeKeys = (sql: Sql, where: Fragment) => sql<KeyRow[]>`
  SELECT k.id, k.name, k.mode, k.token_limit, k.account_id, ${effectivePlan(sql, 'a')} AS plan
  FROM api_keys k LEFT JOIN accounts a ON a.id = k.account_id
  WHERE k.revoked_at IS NULL AND ${where}`;

/**
 * Resolve the caller from Authorization: Bearer <key|access token> or X-Api-Key.
 * Returns the key context, null when no/unknown credentials, or throws 401 for an expired token.
 */
export async function authenticate(sql: Sql, headers: IncomingHttpHeaders): Promise<KeyContext | null> {
  if (process.env.NUTRIKIT_AUTH === 'off') return { id: 'dev', name: 'auth disabled', accountId: null, via: 'none', mode: 'live', tokenLimit: null, ratePerMinute: DEFAULT_RATE };
  const auth = headers.authorization || '';
  const credential = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(headers['x-api-key'] || '').trim();
  if (!credential) return null;
  if (credential.startsWith('nkat_')) {
    const t = await verifyAccessToken(sql, credential);
    if (t?.expired) throw Object.assign(new Error('access token expired; request a new one from POST /v1/auth/token'), { status: 401, code: 'token_expired' });
    if (!t) return null;
    const [row] = await activeKeys(sql, sql`k.id = ${t.kid}`);
    return row ? keyContext(row, 'access_token') : null;
  }
  const [row] = await activeKeys(sql, sql`k.key_hash = ${hash(credential)}`);
  return row ? keyContext(row, 'api_key') : null;
}

export function isAdmin(headers: IncomingHttpHeaders): boolean {
  const token = process.env.NUTRIKIT_ADMIN_TOKEN;
  if (!token) return false;
  const given = Buffer.from(String(headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// ---------------------------------------------------------------- metering
//
// Allowances are counted in usage_periods (one row per subject and UTC month). A call reserves its flat cost
// with one conditional upsert before the handler runs, so concurrent calls can't overspend; afterwards it is
// settled to what it actually cost (or released, on failure), in the same transaction as its `usage` row.

/**
 * The allowance a call counts against: the whole account (all of its live keys), or an operator key on its own.
 * Test keys count against the account's test allowance (`test:`), or their own (`test-key:`) for operator keys.
 */
const subjectOf = (key: Pick<KeyContext, 'id' | 'accountId'> & { mode?: KeyMode }) => key.mode === 'test'
  ? (key.accountId ? `test:${key.accountId}` : `test-key:${key.id}`)
  : (key.accountId ? `acct:${key.accountId}` : `key:${key.id}`);

/** Usage rows of one mode (test rows are told apart by their key's mode). */
const usageMode = (sql: Sql, mode: KeyMode) => mode === 'test'
  ? sql`key_id IN (SELECT id FROM api_keys WHERE mode = 'test')`
  : sql`key_id NOT IN (SELECT id FROM api_keys WHERE mode = 'test')`;
const periodOf = (iso = monthStart()) => iso.slice(0, 10);

/** Tokens reserved for one in-flight call. */
export interface Reservation {
  subject: string;
  period: string; // YYYY-MM-DD, the month the reservation was made in
  reserved: number;
  used: number | null; // the counter after reserving; null when nothing was reserved
}

async function counterValue(sql: Sql, subject: string, period = periodOf()): Promise<number> {
  const [row] = await sql<{ used: number }[]>`SELECT used FROM usage_periods WHERE subject = ${subject} AND period_start = ${period}`;
  return row?.used ?? 0;
}

export async function accountUsedThisMonth(sql: Sql, accountId: string, mode: KeyMode = 'live'): Promise<number> {
  return counterValue(sql, mode === 'test' ? `test:${accountId}` : `acct:${accountId}`);
}

/**
 * Reserves `cost` tokens against the caller's allowance, atomically. Throws 429 quota_exceeded when they don't
 * fit (the handler then never runs). Unlimited allowances are counted but never refused.
 */
export async function reserve(sql: Sql, key: KeyContext, cost: number): Promise<Reservation> {
  const subject = subjectOf(key);
  const period = periodOf();
  const exhausted = () => Object.assign(new Error(key.mode === 'test'
    ? `monthly test allowance exhausted (${key.tokenLimit} tokens); it resets next month and live keys are unaffected`
    : `monthly token allowance exhausted (${key.tokenLimit} tokens); upgrade your plan or wait for the next month`), { status: 429, code: 'quota_exceeded' });
  if (cost <= 0) return { subject, period, reserved: 0, used: null };
  if (key.tokenLimit != null && cost > key.tokenLimit) throw exhausted();
  const [row] = await sql<{ used: number }[]>`
    INSERT INTO usage_periods AS p (subject, period_start, used) VALUES (${subject}, ${period}, ${cost})
    ON CONFLICT (subject, period_start) DO UPDATE SET used = p.used + EXCLUDED.used
      WHERE ${key.tokenLimit}::bigint IS NULL OR p.used + EXCLUDED.used <= ${key.tokenLimit}::bigint
    RETURNING used`;
  if (!row) throw exhausted();
  return { subject, period, reserved: cost, used: row.used };
}

/**
 * Settles a reservation to the tokens the call actually cost (0 releases it) and records the charge.
 * AI tokens may take the balance past the allowance by that one call's AI usage; the next reservation then fails.
 */
export async function settle(sql: Sql, key: KeyContext, reservation: Reservation, endpoint: string, tokens: number): Promise<{ tokens: number; remaining: number | null }> {
  const delta = tokens - reservation.reserved;
  const used = await sql.begin(async (tx) => {
    let after = reservation.used;
    if (delta !== 0) {
      const [row] = await tx<{ used: number }[]>`
        INSERT INTO usage_periods AS p (subject, period_start, used) VALUES (${reservation.subject}, ${reservation.period}, ${delta})
        ON CONFLICT (subject, period_start) DO UPDATE SET used = p.used + EXCLUDED.used
        RETURNING used`;
      after = row!.used;
    }
    if (tokens > 0) await tx`INSERT INTO usage (key_id, account_id, endpoint, tokens) VALUES (${key.id}, ${key.accountId}, ${endpoint}, ${tokens})`;
    // last_used_at is informational: write it at most once a minute per key.
    if (key.id !== 'dev') await tx`UPDATE api_keys SET last_used_at = now() WHERE id = ${key.id} AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')`;
    return after;
  });
  if (key.tokenLimit == null) return { tokens, remaining: null };
  const current = used ?? await counterValue(sql, reservation.subject, reservation.period);
  return { tokens, remaining: Math.max(key.tokenLimit - current, 0) };
}

/** Tokens charged for AI usage alone: 1 per 1,000 model tokens, rounded up. */
export const aiTokens = (usage?: Partial<AIUsage> | null) => (usage ? Math.ceil(((usage.inputTokens || 0) + (usage.outputTokens || 0)) / 1000) : 0);

export async function usageSummary(sql: Sql, key: KeyContext): Promise<UsageSummary> {
  const filter = key.accountId ? sql`account_id = ${key.accountId} AND ${usageMode(sql, key.mode ?? 'live')}` : sql`key_id = ${key.id}`;
  const rows = (await sql<EndpointUsage[]>`SELECT endpoint, COUNT(*) AS calls, SUM(tokens) AS tokens FROM usage
    WHERE ${filter} AND at >= ${monthStart()} GROUP BY endpoint ORDER BY endpoint`).map((r) => ({ ...r }));
  const used = await counterValue(sql, subjectOf(key));
  return { keyId: key.id, mode: key.mode ?? 'live', accountId: key.accountId, periodStart: monthStart(), tokenLimit: key.tokenLimit, used, remaining: key.tokenLimit == null ? null : Math.max(key.tokenLimit - used, 0), byEndpoint: rows };
}

/**
 * Rebuilds one month's allowance counters from the `usage` history (e.g. after a crash lost a settlement).
 * Reservations in flight while it runs are dropped from the counter, so run it when traffic is quiet.
 * Returns the number of subjects with usage that month.
 */
export async function reconcileUsage(sql: Sql, month: string): Promise<number> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM');
  const period = `${month}-01`;
  return sql.begin(async (tx) => {
    await tx`DELETE FROM usage_periods WHERE period_start = ${period}`;
    const rows = await tx`
      INSERT INTO usage_periods (subject, period_start, used)
      SELECT CASE WHEN k.mode = 'test' THEN (CASE WHEN u.account_id IS NOT NULL THEN 'test:' || u.account_id ELSE 'test-key:' || u.key_id END)
                  WHEN u.account_id IS NOT NULL THEN 'acct:' || u.account_id ELSE 'key:' || u.key_id END, ${period}::date, SUM(u.tokens)
      FROM usage u LEFT JOIN api_keys k ON k.id = u.key_id
      WHERE u.at >= ${period}::date AND u.at < (${period}::date + interval '1 month')
      GROUP BY 1
      RETURNING subject`;
    return rows.length;
  });
}

/** Daily live token totals for an account over the last `days` days (UTC), zero-filled; test keys are left out. */
export async function usageSeries(sql: Sql, accountId: string, days = 30): Promise<UsageDay[]> {
  const since = new Date(Date.now() - (days - 1) * 864e5);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await sql<UsageDay[]>`SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, SUM(tokens) AS tokens, COUNT(*) AS calls
    FROM usage WHERE account_id = ${accountId} AND ${usageMode(sql, 'live')} AND at >= ${since} GROUP BY day`;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10);
    return { day, tokens: byDay.get(day)?.tokens ?? 0, calls: byDay.get(day)?.calls ?? 0 };
  });
}

/**
 * Counts one request against `bucket`'s per-minute limit, shared by all app instances.
 * A window opens at the bucket's first request and lasts one minute. Throws 429 with Retry-After.
 */
export async function hitRateLimit(sql: Sql, bucket: string, limit: number): Promise<void> {
  // `left` is numeric, which postgres returns as a string.
  const [w] = await sql<{ count: number; left: string }[]>`
    INSERT INTO rate_windows AS w (bucket, window_start, count) VALUES (${bucket}, clock_timestamp(), 1)
    ON CONFLICT (bucket) DO UPDATE SET
      window_start = CASE WHEN w.window_start <= clock_timestamp() - interval '1 minute' THEN clock_timestamp() ELSE w.window_start END,
      count        = CASE WHEN w.window_start <= clock_timestamp() - interval '1 minute' THEN 1 ELSE w.count + 1 END
    RETURNING count, EXTRACT(EPOCH FROM (w.window_start + interval '1 minute' - clock_timestamp())) AS left`;
  if (w.count > limit) {
    throw Object.assign(new Error('rate limit exceeded'), { status: 429, code: 'rate_limited', retryAfter: Math.max(1, Math.ceil(Number(w.left))) });
  }
}

// Per account (or per operator key); test keys have their own bucket.
export function rateLimit(sql: Sql, key: KeyContext): Promise<void> {
  return hitRateLimit(sql, `${key.mode === 'test' ? 'test' : 'key'}:${key.accountId || key.id}`, key.ratePerMinute || DEFAULT_RATE);
}
