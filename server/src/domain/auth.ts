// API keys, short-lived access tokens, token-based usage metering and rate limiting.
//
// Credentials accepted by the API (Authorization: Bearer ...):
//   nk_...    secret API key, created in the developer portal; stored only as a SHA-256 hash.
//   nkat_...  access token from POST /v1/auth/token; HMAC-signed, expires after 1 hour.
//             Lets a backend keep the secret key and hand mobile/web clients a short-lived token.
//
// Data functions take the Postgres pool (`sql`) as their first argument.
//
// Calls are charged in "tokens": a flat cost per endpoint, plus 1 token per 1,000 model tokens on
// AI-assisted calls. Accounts get a monthly allowance and per-minute rate from their plan; keys made
// by an operator (admin API / CLI) may carry their own allowance instead.
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
  tokenLimit: number | null; // null = unlimited
  ratePerMinute: number;
}

export interface NewKey {
  id: string;
  key: string; // the secret; shown once
  name: string | null | undefined;
  tokenLimit: number | null;
  prefix: string;
}

export interface KeySummary {
  id: string;
  name: string;
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
};

export type CostKey = keyof typeof COSTS;

export const ACCESS_TOKEN_TTL = 3600;
const DEFAULT_RATE = Number(process.env.NUTRIKIT_RATE_LIMIT || 120);
const hash = (key: string) => crypto.createHash('sha256').update(key).digest('hex');
export const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

// ---------------------------------------------------------------- keys

export async function createKey(sql: Sql, { name, tokenLimit = null, accountId = null }: { name?: string | null; tokenLimit?: number | null; accountId?: string | null }): Promise<NewKey> {
  const id = `key_${crypto.randomBytes(6).toString('hex')}`;
  const key = `nk_${crypto.randomBytes(32).toString('base64url')}`;
  await sql`INSERT INTO api_keys (id, key_hash, name, token_limit, account_id)
    VALUES (${id}, ${hash(key)}, ${String(name || 'unnamed').slice(0, 100)}, ${tokenLimit == null ? null : Number(tokenLimit)}, ${accountId})`;
  return { id, key, name, tokenLimit, prefix: key.slice(0, 10) };
}

export async function listKeys(sql: Sql, accountId?: string): Promise<KeySummary[]> {
  const used = sql`(SELECT COALESCE(SUM(u.tokens), 0) FROM usage u WHERE u.key_id = k.id AND u.at >= ${monthStart()}) AS "usedThisMonth"`;
  const rows = accountId === undefined
    ? await sql<KeySummary[]>`SELECT id, name, token_limit AS "tokenLimit", created_at AS "createdAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt", account_id AS "accountId", ${used}
        FROM api_keys k ORDER BY created_at`
    : await sql<KeySummary[]>`SELECT id, name, created_at AS "createdAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt", ${used}
        FROM api_keys k WHERE account_id = ${accountId} ORDER BY created_at DESC`;
  return rows.map((k) => ({ ...k }));
}

export async function newestActiveKey(sql: Sql, accountId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM api_keys WHERE account_id = ${accountId} AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`;
  return row ? { ...row } : null;
}

export async function activeKeyCount(sql: Sql, accountId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`SELECT COUNT(*) AS n FROM api_keys WHERE account_id = ${accountId} AND revoked_at IS NULL`;
  return n;
}

export async function revokeKey(sql: Sql, id: string, accountId?: string): Promise<boolean> {
  const r = accountId === undefined
    ? await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`
    : await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND account_id = ${accountId} AND revoked_at IS NULL`;
  return r.count > 0;
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
  const plan = row.account_id ? PLANS[row.plan as string] || PLANS.free : null;
  return {
    id: row.id,
    name: row.name,
    accountId: row.account_id || null,
    via,
    tokenLimit: row.token_limit ?? (plan ? plan.monthlyTokens : null),
    ratePerMinute: plan ? plan.ratePerMinute : DEFAULT_RATE,
  };
}

const activeKeys = (sql: Sql, where: Fragment) => sql<KeyRow[]>`
  SELECT k.id, k.name, k.token_limit, k.account_id, ${effectivePlan(sql, 'a')} AS plan
  FROM api_keys k LEFT JOIN accounts a ON a.id = k.account_id
  WHERE k.revoked_at IS NULL AND ${where}`;

/**
 * Resolve the caller from Authorization: Bearer <key|access token> or X-Api-Key.
 * Returns the key context, null when no/unknown credentials, or throws 401 for an expired token.
 */
export async function authenticate(sql: Sql, headers: IncomingHttpHeaders): Promise<KeyContext | null> {
  if (process.env.NUTRIKIT_AUTH === 'off') return { id: 'dev', name: 'auth disabled', accountId: null, via: 'none', tokenLimit: null, ratePerMinute: DEFAULT_RATE };
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

export async function accountUsedThisMonth(sql: Sql, accountId: string): Promise<number> {
  const [{ t }] = await sql<{ t: number }[]>`SELECT COALESCE(SUM(tokens), 0) AS t FROM usage WHERE account_id = ${accountId} AND at >= ${monthStart()}`;
  return t;
}

async function keyUsedThisMonth(sql: Sql, keyId: string): Promise<number> {
  const [{ t }] = await sql<{ t: number }[]>`SELECT COALESCE(SUM(tokens), 0) AS t FROM usage WHERE key_id = ${keyId} AND at >= ${monthStart()}`;
  return t;
}

// Allowances apply to the whole account (all of its keys) unless the key has its own limit.
const usedFor = (sql: Sql, key: Pick<KeyContext, 'id' | 'accountId'>) => (key.accountId ? accountUsedThisMonth(sql, key.accountId) : keyUsedThisMonth(sql, key.id));

/** Throws 429 if the caller cannot afford `cost` more tokens this month. */
export async function checkAllowance(sql: Sql, key: KeyContext, cost: number): Promise<number | null> {
  if (key.tokenLimit == null) return null;
  const remaining = key.tokenLimit - await usedFor(sql, key);
  if (remaining < cost) {
    throw Object.assign(new Error(`monthly token allowance exhausted (${key.tokenLimit} tokens); upgrade your plan or wait for the next month`), { status: 429, code: 'quota_exceeded' });
  }
  return remaining;
}

export async function charge(sql: Sql, key: KeyContext, endpoint: string, baseCost: number, aiUsage?: Partial<AIUsage> | null): Promise<{ tokens: number; remaining: number | null }> {
  const aiTokens = aiUsage ? Math.ceil(((aiUsage.inputTokens || 0) + (aiUsage.outputTokens || 0)) / 1000) : 0;
  const tokens = baseCost + aiTokens;
  if (tokens > 0) {
    await sql`INSERT INTO usage (key_id, account_id, endpoint, tokens) VALUES (${key.id}, ${key.accountId}, ${endpoint}, ${tokens})`;
  }
  if (key.id !== 'dev') await sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${key.id}`;
  return { tokens, remaining: key.tokenLimit == null ? null : key.tokenLimit - await usedFor(sql, key) };
}

export async function usageSummary(sql: Sql, key: KeyContext): Promise<UsageSummary> {
  const filter = key.accountId ? sql`account_id = ${key.accountId}` : sql`key_id = ${key.id}`;
  const rows = (await sql<EndpointUsage[]>`SELECT endpoint, COUNT(*) AS calls, SUM(tokens) AS tokens FROM usage
    WHERE ${filter} AND at >= ${monthStart()} GROUP BY endpoint ORDER BY endpoint`).map((r) => ({ ...r }));
  const used = rows.reduce((s, r) => s + r.tokens, 0);
  return { keyId: key.id, accountId: key.accountId, periodStart: monthStart(), tokenLimit: key.tokenLimit, used, remaining: key.tokenLimit == null ? null : key.tokenLimit - used, byEndpoint: rows };
}

/** Daily token totals for an account over the last `days` days (UTC), zero-filled. */
export async function usageSeries(sql: Sql, accountId: string, days = 30): Promise<UsageDay[]> {
  const since = new Date(Date.now() - (days - 1) * 864e5);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await sql<UsageDay[]>`SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, SUM(tokens) AS tokens, COUNT(*) AS calls
    FROM usage WHERE account_id = ${accountId} AND at >= ${since} GROUP BY day`;
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

// Per account (or per operator key).
export function rateLimit(sql: Sql, key: KeyContext): Promise<void> {
  return hitRateLimit(sql, `key:${key.accountId || key.id}`, key.ratePerMinute || DEFAULT_RATE);
}
