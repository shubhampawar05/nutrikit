// Developer accounts, browser sessions and plans for the self-serve portal.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Sql, TransactionSql } from 'postgres';
import { lookup } from './lookup.ts';
import { mailer } from './mail.ts';

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
  /** The account's email has been confirmed through a link (verification, or a password reset). */
  emailVerified: boolean;
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

/** Plans ordered by value: Free first, paid plans by price, Enterprise (priced directly) above them all. */
export const planRank = (plan: string): number => (plan === 'enterprise' ? Infinity : PLANS[plan]?.price ?? 0);

export interface PublicPlan extends Plan {
  /** 0 = Free, increasing with value; the same order the server uses to refuse cheaper plans. */
  rank: number;
}

/** The plans as shown to visitors and the dashboard (display fields only), with their order. */
export function publicPlans(): Record<string, PublicPlan> {
  const order = Object.keys(PLANS).sort((a, b) => planRank(a) - planRank(b));
  return Object.fromEntries(order.map((id, rank) => {
    const { name, monthlyTokens, ratePerMinute, price, currency, maxKeys } = PLANS[id]!;
    return [id, { name, monthlyTokens, ratePerMinute, price, currency, maxKeys, rank }];
  }));
}

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
           CASE WHEN plan_expires_at > now() THEN plan_expires_at END AS "planExpiresAt",
           email_verified_at IS NOT NULL AS "emailVerified"
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

// ---- Email verification and password reset ----
// Links carry a random token; only its SHA-256 is stored. A new link replaces the account's earlier unused link of
// the same kind. Sends are throttled per address (silently for forgotten passwords, so the answer never shows whether
// an account exists) and per client address.
const VERIFY_DAYS = 7;
const RESET_MINUTES = 60;
const EMAIL_SENDS_PER_HOUR = () => Number(process.env.NUTRIKIT_EMAIL_LIMIT) || 3;
const EMAIL_IP_SENDS_PER_HOUR = () => Number(process.env.NUTRIKIT_EMAIL_IP_LIMIT) || 10;

const invalidLink = () => fail(400, 'invalid_token', 'this link has expired or was already used');

/** Over the per-address limit -> retry-after seconds; over the per-network limit -> throws 429. */
async function emailThrottle(sql: Sql, email: string, purpose: string, ip?: string): Promise<number | null> {
  await sql`DELETE FROM email_sends WHERE at < now() - interval '1 day'`;
  const [{ byEmail, byIp, oldest }] = await sql<{ byEmail: number; byIp: number; oldest: Date | null }[]>`
    SELECT COUNT(*) FILTER (WHERE email = ${email} AND purpose = ${purpose}) AS "byEmail",
           COUNT(*) FILTER (WHERE ${ip ?? null}::inet IS NOT NULL AND ip = ${ip ?? null}::inet) AS "byIp",
           MIN(at) FILTER (WHERE email = ${email} AND purpose = ${purpose}) AS oldest
    FROM email_sends WHERE at > now() - interval '1 hour'`;
  if (byIp >= EMAIL_IP_SENDS_PER_HOUR()) {
    throw Object.assign(fail(429, 'too_many_emails', 'too many emails requested from your network; try again later'), { retryAfter: 3600 });
  }
  if (byEmail >= EMAIL_SENDS_PER_HOUR()) return oldest ? Math.max(1, Math.ceil((oldest.getTime() + 3600e3 - Date.now()) / 1000)) : 3600;
  return null;
}

async function issueEmailToken(sql: Sql, accountId: string, email: string, purpose: 'verify' | 'reset', ip?: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + (purpose === 'verify' ? VERIFY_DAYS * 864e5 : RESET_MINUTES * 6e4));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM email_tokens WHERE account_id = ${accountId} AND purpose = ${purpose} AND used_at IS NULL`;
    await tx`INSERT INTO email_tokens (id_hash, account_id, purpose, email, expires_at) VALUES (${hashId(token)}, ${accountId}, ${purpose}, ${email}, ${expires})`;
    await tx`INSERT INTO email_sends (email, ip, purpose) VALUES (${email}, ${ip ?? null}, ${purpose})`;
  });
  return token;
}

/**
 * Email a link that confirms the account's address. `origin` is the site's public origin. Returns `retryAfter` when
 * this address was sent too many links in the last hour (nothing is sent), and does nothing for a verified account.
 */
export async function sendVerification(sql: Sql, account: Account, origin: string, { ip }: Origin = {}): Promise<{ sent: boolean; retryAfter?: number }> {
  if (account.emailVerified) return { sent: false };
  const retryAfter = await emailThrottle(sql, account.email, 'verify', ip);
  if (retryAfter) return { sent: false, retryAfter };
  const token = await issueEmailToken(sql, account.id, account.email, 'verify', ip);
  await mailer().send({
    to: account.email,
    subject: 'Confirm your email for Nutrikit',
    text: `Hi ${account.name},\n\nConfirm that this is your email address by opening this link:\n${origin}/verify-email?token=${token}\n\n`
      + `The link works for ${VERIFY_DAYS} days. If you didn't create a Nutrikit account, you can ignore this email.\n\n— Nutrikit`,
  });
  return { sent: true };
}

/** Confirm an address from its link. A link clicked again after it worked still answers that the email is verified. */
export async function verifyEmail(sql: Sql, token: unknown): Promise<{ email: string }> {
  if (typeof token !== 'string' || !token) throw invalidLink();
  const [row] = await sql<{ accountId: string; email: string; expired: boolean; used: boolean; current: string; verified: boolean }[]>`
    SELECT t.account_id AS "accountId", t.email, t.expires_at <= now() AS expired, t.used_at IS NOT NULL AS used,
           a.email AS current, a.email_verified_at IS NOT NULL AS verified
    FROM email_tokens t JOIN accounts a ON a.id = t.account_id
    WHERE t.id_hash = ${hashId(token)} AND t.purpose = 'verify'`;
  if (!row || row.email.toLowerCase() !== row.current.toLowerCase()) throw invalidLink();
  if (row.used || row.expired) {
    if (row.verified) return { email: row.current };
    throw invalidLink();
  }
  await sql.begin(async (tx) => {
    await tx`UPDATE email_tokens SET used_at = now() WHERE id_hash = ${hashId(token)}`;
    await tx`UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${row.accountId}`;
  });
  return { email: row.current };
}

/**
 * Email a password-reset link if an account uses this address. The caller always answers the same way, so this
 * never reveals whether the account exists; too many requests for one address are dropped silently.
 */
export async function requestPasswordReset(sql: Sql, email: unknown, origin: string, { ip }: Origin = {}): Promise<void> {
  const address = String(email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) {
    throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: { email: 'Enter a valid email address.' } });
  }
  if (await emailThrottle(sql, address, 'reset', ip)) return;
  const [row] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM accounts WHERE email = ${address}`;
  if (!row) {
    await sql`INSERT INTO email_sends (email, ip, purpose) VALUES (${address}, ${ip ?? null}, 'reset')`; // unknown addresses count too
    return;
  }
  const token = await issueEmailToken(sql, row.id, row.email, 'reset', ip);
  await mailer().send({
    to: row.email,
    subject: 'Reset your Nutrikit password',
    text: `Someone asked to reset the password for ${row.email} on Nutrikit. To choose a new one, open this link:\n${origin}/reset-password?token=${token}\n\n`
      + `The link works once, for ${RESET_MINUTES} minutes. If you didn't ask, you can ignore this email: your password stays the same.\n\n— Nutrikit`,
  });
}

/**
 * Set a new password from a reset link. Every existing session of the account ends, its failed logins are cleared,
 * and the address counts as verified (the link reached it). The caller signs the user in.
 */
export async function resetPassword(sql: Sql, token: unknown, password: unknown): Promise<Account> {
  const { password: problem } = validateSignup({ name: 'x', email: 'x@x.co', password });
  if (problem) throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: { password: problem } });
  if (typeof token !== 'string' || !token) throw invalidLink();
  const hash = await hashPassword(password as string);
  const accountId = await sql.begin(async (tx) => {
    const [row] = await tx<{ accountId: string; email: string }[]>`
      UPDATE email_tokens SET used_at = now()
      WHERE id_hash = ${hashId(token)} AND purpose = 'reset' AND used_at IS NULL AND expires_at > now()
      RETURNING account_id AS "accountId", email`;
    if (!row) return null;
    await tx`UPDATE accounts SET password_hash = ${hash},
               email_verified_at = CASE WHEN email = ${row.email} THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END
             WHERE id = ${row.accountId}`;
    await tx`DELETE FROM sessions WHERE account_id = ${row.accountId}`;
    await tx`DELETE FROM email_tokens WHERE account_id = ${row.accountId} AND purpose = 'reset' AND used_at IS NULL`;
    await tx`DELETE FROM login_failures WHERE email = ${row.email}`;
    return row.accountId;
  });
  if (!accountId) throw invalidLink();
  return getAccount(sql, accountId) as Promise<Account>;
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
