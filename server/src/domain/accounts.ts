// Developer accounts, browser sessions and plans for the self-serve portal.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Sql, TransactionSql } from 'postgres';
import { lookup } from './lookup.ts';

export interface Plan {
  name: string;
  monthlyTokens: number | null; // null = unlimited
  ratePerMinute: number;
  price: number | null; // per 30-day period, in `currency`; null = arranged directly
  currency: string;
  maxKeys: number;
}

export interface Account {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: Date;
  /** When the paid period ends; null = no end (Free, or a plan set by an operator). */
  planExpiresAt: Date | null;
  planDetails: Plan;
}

/** Signup/login input as received (unvalidated request body fields). */
export interface Credentials {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}

export interface UpgradeRequest {
  id: number;
  requestedPlan: string;
  message: string | null;
  createdAt: Date;
  accountId: string;
  email: string;
  name: string;
  currentPlan: string;
}

export type DomainError = Error & { status: number; code: string };

// Placeholder commercial plans: edit names, allowances and prices to match your business.
// Prices are in rupees per 30-day period, paid once through Razorpay (billing.ts); there is no auto-renewal.
export const CURRENCY = 'INR';
export const PLANS: Record<string, Plan> = lookup({
  free: { name: 'Free', monthlyTokens: 2_000, ratePerMinute: 30, price: 0, currency: CURRENCY, maxKeys: 2 },
  starter: { name: 'Starter', monthlyTokens: 100_000, ratePerMinute: 120, price: 1_499, currency: CURRENCY, maxKeys: 5 },
  growth: { name: 'Growth', monthlyTokens: 1_000_000, ratePerMinute: 600, price: 11_999, currency: CURRENCY, maxKeys: 20 },
  enterprise: { name: 'Enterprise', monthlyTokens: null, ratePerMinute: 3000, price: null, currency: CURRENCY, maxKeys: 100 },
});

const SESSION_DAYS = 14;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const hashId = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// scrypt runs on libuv's threadpool, so hashing never blocks other requests. Same parameters and stored format
// as before (scrypt$<salt hex>$<hash hex>), so existing passwords keep verifying.
const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;
const derive = (password: string, salt: Buffer) => scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [, saltHex, hashHex] = stored.split('$');
  const hash = await derive(password, Buffer.from(saltHex!, 'hex'));
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex!, 'hex'));
}

// Unknown emails are checked against this, so a login takes as long whether or not the account exists.
let dummyHash: Promise<string> | undefined;
const unknownAccountHash = () => (dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex')));

// Per client address: signups per hour, and failed logins per 15 minutes (alongside 5 per email).
const SIGNUP_LIMIT = () => Number(process.env.NUTRIKIT_SIGNUP_LIMIT) || 5;
const LOGIN_IP_LIMIT = () => Number(process.env.NUTRIKIT_LOGIN_IP_LIMIT) || 20;

/** Where a portal request came from (req.ip); absent when called outside HTTP (scripts, tests). */
export interface Origin {
  ip?: string;
}

const fail = (status: number, code: string, message: string): DomainError => Object.assign(new Error(message), { status, code });

export function validateSignup({ name, email, password }: Credentials): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100) errors.name = 'Enter your name or company (up to 100 characters).';
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 10) errors.password = 'Use at least 10 characters.';
  else if (password.length > 200) errors.password = 'Use at most 200 characters.';
  return errors;
}

// Every attempt counts, invalid ones included, so a script can't probe without spending its allowance.
async function throttleSignup(sql: Sql, ip: string) {
  await sql`DELETE FROM signup_attempts WHERE at < now() - interval '1 hour'`;
  const [{ recent, oldest }] = await sql<{ recent: number; oldest: Date | null }[]>`
    SELECT COUNT(*) AS recent, MIN(at) AS oldest FROM signup_attempts WHERE ip = ${ip} AND at > now() - interval '1 hour'`;
  if (recent >= SIGNUP_LIMIT()) {
    const retryAfter = oldest ? Math.max(1, Math.ceil((oldest.getTime() + 3600e3 - Date.now()) / 1000)) : 3600;
    throw Object.assign(fail(429, 'too_many_signups', 'too many signups from your network; try again later'), { retryAfter });
  }
  await sql`INSERT INTO signup_attempts (ip) VALUES (${ip})`;
}

export async function createAccount(sql: Sql, { name, email, password }: Credentials, { ip }: Origin = {}): Promise<Account> {
  if (ip) await throttleSignup(sql, ip);
  const errors = validateSignup({ name, email, password });
  if (Object.keys(errors).length) throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: errors });
  const id = `acct_${crypto.randomBytes(8).toString('hex')}`;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO accounts (id, email, name, password_hash, plan)
    VALUES (${id}, ${(email as string).trim()}, ${(name as string).trim()}, ${await hashPassword(password as string)}, 'free')
    ON CONFLICT (email) DO NOTHING
    RETURNING id`;
  if (!row) {
    throw Object.assign(fail(409, 'email_taken', 'an account with this email already exists'), { fields: { email: 'This email is already registered — log in instead.' } });
  }
  return getAccount(sql, id) as Promise<Account>; // the row was just inserted
}

// Failed logins are throttled (shared by all instances): 5 per 15 minutes per email, and NUTRIKIT_LOGIN_IP_LIMIT
// per 15 minutes per client address, so one address can't try many emails. Over either, even a correct password waits.
export async function login(sql: Sql, { email, password }: Credentials, { ip }: Origin = {}): Promise<Account> {
  const key = String(email || '').trim();
  const [{ byEmail, byIp }] = await sql<{ byEmail: number; byIp: number }[]>`
    SELECT COUNT(*) FILTER (WHERE email = ${key}) AS "byEmail",
           COUNT(*) FILTER (WHERE ${ip ?? null}::inet IS NOT NULL AND ip = ${ip ?? null}::inet) AS "byIp"
    FROM login_failures WHERE at > now() - interval '15 minutes'`;
  if (byEmail >= 5 || byIp >= LOGIN_IP_LIMIT()) throw Object.assign(fail(429, 'too_many_attempts', 'too many failed logins; try again in 15 minutes'), { retryAfter: 900 });
  const [row] = await sql<{ id: string; password_hash: string }[]>`SELECT id, password_hash FROM accounts WHERE email = ${key}`;
  // Hash even for unknown emails so response time does not reveal which emails exist.
  const ok = row ? await verifyPassword(String(password || ''), row.password_hash) : (await verifyPassword(String(password || ''), await unknownAccountHash()), false);
  if (!ok) {
    await sql`DELETE FROM login_failures WHERE at < now() - interval '15 minutes'`;
    await sql`INSERT INTO login_failures (email, ip) VALUES (${key}, ${ip ?? null})`;
    throw fail(401, 'invalid_credentials', 'email or password is incorrect');
  }
  await sql`DELETE FROM login_failures WHERE email = ${key}`;
  return getAccount(sql, row!.id) as Promise<Account>; // row exists: !ok threw above
}

/** The plan in force: a paid period that has ended reads as Free (no scheduler needed). */
export const effectivePlan = (sql: Sql | TransactionSql, table = 'accounts') =>
  sql`CASE WHEN ${sql(table)}.plan_expires_at <= now() THEN 'free' ELSE ${sql(table)}.plan END`;

export async function getAccount(sql: Sql, id: string): Promise<Account | null> {
  const [row] = await sql<Omit<Account, 'planDetails'>[]>`
    SELECT id, email, name, ${effectivePlan(sql)} AS plan, created_at AS "createdAt",
           CASE WHEN plan_expires_at > now() THEN plan_expires_at END AS "planExpiresAt"
    FROM accounts WHERE id = ${id}`;
  return row ? { ...row, planDetails: PLANS[row.plan] || PLANS.free } : null;
}

export async function setPlan(sql: Sql, accountId: string, plan: string): Promise<boolean> {
  if (!PLANS[plan]) throw fail(400, 'invalid_plan', `plan must be one of ${Object.keys(PLANS).join(', ')}`);
  // Plans set here (operator or billing code that manages expiry itself) do not expire.
  return (await sql`UPDATE accounts SET plan = ${plan}, plan_expires_at = NULL WHERE id = ${accountId}`).count > 0;
}

export async function createSession(sql: Sql, accountId: string): Promise<{ token: string; expires: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`INSERT INTO sessions (id_hash, account_id, expires_at) VALUES (${hashId(token)}, ${accountId}, ${expires})`;
  return { token, expires };
}

export async function sessionAccount(sql: Sql, token: string | null | undefined): Promise<Account | null> {
  if (!token) return null;
  const [row] = await sql<{ account_id: string }[]>`SELECT account_id FROM sessions WHERE id_hash = ${hashId(token)} AND expires_at > now()`;
  return row ? getAccount(sql, row.account_id) : null;
}

export async function endSession(sql: Sql, token: string | null | undefined): Promise<void> {
  if (token) await sql`DELETE FROM sessions WHERE id_hash = ${hashId(token)}`;
}

export async function requestUpgrade(sql: Sql, accountId: string, plan: string, message: unknown): Promise<{ requested: string }> {
  if (!PLANS[plan] || plan === 'free') throw fail(400, 'invalid_plan', 'choose starter, growth or enterprise');
  await sql`INSERT INTO upgrade_requests (account_id, plan, message) VALUES (${accountId}, ${plan}, ${typeof message === 'string' ? message.slice(0, 1000) : null})`;
  return { requested: plan };
}

export async function listUpgradeRequests(sql: Sql): Promise<UpgradeRequest[]> {
  return sql<UpgradeRequest[]>`
    SELECT r.id, r.plan AS "requestedPlan", r.message, r.created_at AS "createdAt",
           a.id AS "accountId", a.email, a.name, ${effectivePlan(sql, 'a')} AS "currentPlan"
    FROM upgrade_requests r JOIN accounts a ON a.id = r.account_id
    ORDER BY r.created_at DESC`.then((rows) => rows.map((r) => ({ ...r })));
}
