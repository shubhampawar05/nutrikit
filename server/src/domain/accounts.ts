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
  /** Active keys allowed per mode (live and test are counted separately). */
  maxKeys: number;
  /** People in the team, pending invitations included. */
  maxMembers: number;
}

/** A team: what the API bills. It owns the plan, keys, usage and payments (the `accounts` table). */
export interface Account {
  id: string;
  name: string;
  plan: string;
  createdAt: Date;
  /** When the paid period ends; null = no end (Free, or a plan set by an operator). */
  planExpiresAt: Date | null;
  planDetails: Plan;
}

/** A person who signs in to the portal. Belongs to teams through memberships. */
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  /** The email has been confirmed through a link (verification, password reset or an invitation). */
  emailVerified: boolean;
}

export type Role = 'owner' | 'admin' | 'developer';
export const ROLES: readonly Role[] = ['owner', 'admin', 'developer'];

/** A signed-in request: who, the team in use, and their role in it. */
export interface SessionContext {
  user: User;
  account: Account;
  role: Role;
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
  free: { name: 'Free', monthlyTokens: 2_000, ratePerMinute: 30, price: 0, currency: CURRENCY, maxKeys: 2, maxMembers: 5 },
  starter: { name: 'Starter', monthlyTokens: 100_000, ratePerMinute: 120, price: 1_499, currency: CURRENCY, maxKeys: 5, maxMembers: 10 },
  growth: { name: 'Growth', monthlyTokens: 1_000_000, ratePerMinute: 600, price: 11_999, currency: CURRENCY, maxKeys: 20, maxMembers: 25 },
  enterprise: { name: 'Enterprise', monthlyTokens: null, ratePerMinute: 3000, price: null, currency: CURRENCY, maxKeys: 100, maxMembers: 200 },
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
    const { name, monthlyTokens, ratePerMinute, price, currency, maxKeys, maxMembers } = PLANS[id]!;
    return [id, { name, monthlyTokens, ratePerMinute, price, currency, maxKeys, maxMembers, rank }];
  }));
}

const SESSION_DAYS = 14;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const hashId = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

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

export const fail = (status: number, code: string, message: string): DomainError => Object.assign(new Error(message), { status, code });

/** A plausible email address, as signup, password reset and invitations accept it. */
export const isEmail = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

/** A team name (1–100 characters once trimmed), or a 400 naming the field. */
function teamName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: { name: 'Enter a team name (up to 100 characters).' } });
  }
  return name.trim();
}

function validateSignup({ name, email, password }: Credentials): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100) errors.name = 'Enter your name or company (up to 100 characters).';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 10) errors.password = 'Use at least 10 characters.';
  else if (password.length > 200) errors.password = 'Use at most 200 characters.';
  return errors;
}

/**
 * Serializes check-then-insert throttles on one name (an email or a client address) until the transaction ends, so
 * parallel requests can't all pass the same count. Several names are locked in the order given.
 */
async function lockNames(tx: TransactionSql, ...names: string[]) {
  for (const name of names) await tx`SELECT pg_advisory_xact_lock(hashtext(${name}))`;
}

// Every attempt counts, invalid ones included, so a script can't probe without spending its allowance.
async function throttleSignup(sql: Sql, ip: string) {
  const refused = await sql.begin(async (tx) => {
    await lockNames(tx, `signup:${ip}`);
    const [{ recent, oldest }] = await tx<{ recent: number; oldest: Date | null }[]>`
      SELECT COUNT(*)::int AS recent, MIN(at) AS oldest FROM signup_attempts WHERE ip = ${ip} AND at > now() - interval '1 hour'`;
    if (recent >= SIGNUP_LIMIT()) return { oldest };
    await tx`INSERT INTO signup_attempts (ip) VALUES (${ip})`;
    return null;
  });
  if (refused) {
    const { oldest } = refused;
    const retryAfter = oldest ? Math.max(1, Math.ceil((oldest.getTime() + 3600e3 - Date.now()) / 1000)) : 3600;
    throw Object.assign(fail(429, 'too_many_signups', 'too many signups from your network; try again later'), { retryAfter });
  }
}

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

/** Teams one user may own (NUTRIKIT_TEAMS_PER_USER): each team gets its own Free allowance, so this caps farming. */
const TEAMS_PER_USER = () => Number(process.env.NUTRIKIT_TEAMS_PER_USER) || 3;

/** Creates a team owned by `userId`, on the Free plan. */
export async function createTeam(sql: Sql | TransactionSql, userId: string, name: unknown): Promise<string> {
  const id = newId('acct');
  await sql`INSERT INTO accounts (id, name, plan) VALUES (${id}, ${teamName(name)}, 'free')`;
  await sql`INSERT INTO memberships (account_id, user_id, role) VALUES (${id}, ${userId}, 'owner')`;
  return id;
}

/** Signup: a user, a team named after them that they own, on the Free plan. */
export async function signup(sql: Sql, { name, email, password }: Credentials, { ip }: Origin = {}): Promise<{ user: User; account: Account }> {
  if (ip) await throttleSignup(sql, ip);
  const errors = validateSignup({ name, email, password });
  if (Object.keys(errors).length) throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: errors });
  const passwordHash = await hashPassword(password as string);
  const ids = await sql.begin(async (tx) => {
    const userId = newId('usr');
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO users (id, email, name, password_hash)
      VALUES (${userId}, ${(email as string).trim()}, ${(name as string).trim()}, ${passwordHash})
      ON CONFLICT (email) DO NOTHING
      RETURNING id`;
    if (!row) return null;
    return { userId, accountId: await createTeam(tx, userId, name) };
  });
  if (!ids) {
    throw Object.assign(fail(409, 'email_taken', 'an account with this email already exists'), { fields: { email: 'This email is already registered — log in instead.' } });
  }
  return { user: (await getUser(sql, ids.userId))!, account: (await getAccount(sql, ids.accountId))! };
}

// Failed logins are throttled (shared by all instances): 5 per 15 minutes per email, and NUTRIKIT_LOGIN_IP_LIMIT
// per 15 minutes per client address, so one address can't try many emails. Over either, even a correct password waits.
export async function login(sql: Sql, { email, password }: Credentials, { ip }: Origin = {}): Promise<User> {
  const key = String(email || '').trim();
  if (!(await countAttempt(sql, key, ip, LOGIN_IP_LIMIT()))) {
    throw Object.assign(fail(429, 'too_many_attempts', 'too many failed logins; try again in 15 minutes'), { retryAfter: 900 });
  }
  const [row] = await sql<{ id: string; password_hash: string }[]>`SELECT id, password_hash FROM users WHERE email = ${key}`;
  // Hash even for unknown emails so response time does not reveal which emails exist.
  const ok = row ? await verifyPassword(String(password || ''), row.password_hash) : (await verifyPassword(String(password || ''), await unknownAccountHash()), false);
  if (!ok) throw fail(401, 'invalid_credentials', 'email or password is incorrect'); // the attempt stays counted
  await sql`DELETE FROM login_failures WHERE email = ${key}`;
  return getUser(sql, row!.id) as Promise<User>; // row exists: !ok threw above
}

/**
 * Counts a password attempt as a failure before the password is checked (a correct one clears the email's failures
 * afterwards), so parallel guesses can't all pass the limit: 5 per email per 15 minutes, and `ipLimit` per client
 * address when one is given. Returns false, recording nothing, when either limit is already reached.
 */
async function countAttempt(sql: Sql, email: string, ip: string | undefined, ipLimit: number): Promise<boolean> {
  return sql.begin(async (tx) => {
    await lockNames(tx, `login:${email.toLowerCase()}`, ...(ip ? [`login-ip:${ip}`] : []));
    const [{ byEmail, byIp }] = await tx<{ byEmail: number; byIp: number }[]>`
      SELECT COUNT(*) FILTER (WHERE email = ${email})::int AS "byEmail",
             COUNT(*) FILTER (WHERE ${ip ?? null}::inet IS NOT NULL AND ip = ${ip ?? null}::inet)::int AS "byIp"
      FROM login_failures WHERE at > now() - interval '15 minutes'`;
    if (byEmail >= 5 || byIp >= ipLimit) return false;
    await tx`INSERT INTO login_failures (email, ip) VALUES (${email}, ${ip ?? null})`;
    return true;
  });
}

/** The plan in force: a paid period that has ended reads as Free (no scheduler needed). */
export const effectivePlan = (sql: Sql | TransactionSql, table = 'accounts') =>
  sql`CASE WHEN ${sql(table)}.plan_expires_at <= now() THEN 'free' ELSE ${sql(table)}.plan END`;

/** The email of a team's first owner, as a column (admin lists, upgrade requests). `table` is the accounts alias. */
export const ownerEmail = (sql: Sql | TransactionSql, table = 'accounts') =>
  sql`(SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.account_id = ${sql(table)}.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1)`;

/** A team by id. */
export async function getAccount(sql: Sql | TransactionSql, id: string): Promise<Account | null> {
  const [row] = await sql<Omit<Account, 'planDetails'>[]>`
    SELECT id, name, ${effectivePlan(sql)} AS plan, created_at AS "createdAt",
           CASE WHEN plan_expires_at > now() THEN plan_expires_at END AS "planExpiresAt"
    FROM accounts WHERE id = ${id}`;
  return row ? { ...row, planDetails: PLANS[row.plan] || PLANS.free } : null;
}

export async function getUser(sql: Sql | TransactionSql, id: string): Promise<User | null> {
  const [row] = await sql<User[]>`
    SELECT id, email, name, created_at AS "createdAt", email_verified_at IS NOT NULL AS "emailVerified"
    FROM users WHERE id = ${id}`;
  return row ? { ...row } : null;
}

export async function setPlan(sql: Sql, accountId: string, plan: string): Promise<boolean> {
  if (!PLANS[plan]) throw fail(400, 'invalid_plan', `plan must be one of ${Object.keys(PLANS).join(', ')}`);
  // Plans set here (operator or billing code that manages expiry itself) do not expire.
  return (await sql`UPDATE accounts SET plan = ${plan}, plan_expires_at = NULL WHERE id = ${accountId}`).count > 0;
}

export async function renameTeam(sql: Sql, accountId: string, name: unknown): Promise<void> {
  await sql`UPDATE accounts SET name = ${teamName(name)} WHERE id = ${accountId}`;
}

/**
 * A new team the user asked for (the dashboard's "New team"): refused with 403 team_limit once they own
 * NUTRIKIT_TEAMS_PER_USER teams. The count and insert share a lock on the user, so parallel requests can't overshoot.
 */
export async function createOwnedTeam(sql: Sql, userId: string, name: unknown): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    const [{ n }] = await tx<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM memberships WHERE user_id = ${userId} AND role = 'owner'`;
    const max = TEAMS_PER_USER();
    if (n >= max) throw fail(403, 'team_limit', `you can own up to ${max} teams; delete or hand over one first`);
    return createTeam(tx, userId, name);
  });
}

/** Starts a session for `userId`, in `accountId` (or their oldest team when omitted). */
export async function createSession(sql: Sql, userId: string, accountId: string | null = null): Promise<{ token: string; expires: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`INSERT INTO sessions (id_hash, user_id, account_id, expires_at) VALUES (${hashId(token)}, ${userId}, ${accountId}, ${expires})`;
  return { token, expires };
}

/**
 * The signed-in user, the team in use and their role. When the session's team is gone or no longer theirs, it
 * falls back to their oldest team (and remembers it); a user with no team gets a new one named after them.
 */
export async function sessionContext(sql: Sql, token: string | null | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const id = hashId(token);
  const [row] = await sql<{ userId: string; accountId: string | null; role: Role | null }[]>`
    SELECT s.user_id AS "userId", s.account_id AS "accountId", m.role
    FROM sessions s LEFT JOIN memberships m ON m.account_id = s.account_id AND m.user_id = s.user_id
    WHERE s.id_hash = ${id} AND s.expires_at > now()`;
  if (!row) return null;
  const user = await getUser(sql, row.userId);
  if (!user) return null;
  let { accountId, role } = row;
  if (!accountId || !role) {
    // Under a lock on the user, so parallel requests from a teamless user create one team, not one each.
    ({ accountId, role } = await sql.begin(async (tx) => {
      await tx`SELECT 1 FROM users WHERE id = ${user.id} FOR UPDATE`;
      const [first] = await tx<{ accountId: string; role: Role }[]>`
        SELECT account_id AS "accountId", role FROM memberships WHERE user_id = ${user.id} ORDER BY created_at LIMIT 1`;
      return first ? { ...first } : { accountId: await createTeam(tx, user.id, user.name), role: 'owner' as const };
    }));
    await sql`UPDATE sessions SET account_id = ${accountId} WHERE id_hash = ${id}`;
  }
  const account = await getAccount(sql, accountId!);
  return account ? { user, account, role: role! } : null;
}

/** Makes `accountId` the session's team. Returns false when the user isn't a member of it. */
export async function switchTeam(sql: Sql, token: string, userId: string, accountId: string): Promise<boolean> {
  const r = await sql`UPDATE sessions SET account_id = ${accountId}
    WHERE id_hash = ${hashId(token)} AND user_id = ${userId}
      AND EXISTS (SELECT 1 FROM memberships WHERE account_id = ${accountId} AND user_id = ${userId})`;
  return r.count > 0;
}

export interface TeamSummary {
  id: string;
  name: string;
  role: Role;
  plan: string;
}

/** The teams a user belongs to, oldest membership first. */
export async function userTeams(sql: Sql, userId: string): Promise<TeamSummary[]> {
  return (await sql<TeamSummary[]>`
    SELECT a.id, a.name, m.role, ${effectivePlan(sql, 'a')} AS plan
    FROM memberships m JOIN accounts a ON a.id = m.account_id
    WHERE m.user_id = ${userId} ORDER BY m.created_at`).map((r) => ({ ...r }));
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

async function issueEmailToken(sql: Sql, userId: string, email: string, purpose: 'verify' | 'reset', ip?: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + (purpose === 'verify' ? VERIFY_DAYS * 864e5 : RESET_MINUTES * 6e4));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM email_tokens WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL`;
    await tx`INSERT INTO email_tokens (id_hash, user_id, purpose, email, expires_at) VALUES (${hashId(token)}, ${userId}, ${purpose}, ${email}, ${expires})`;
    await tx`INSERT INTO email_sends (email, ip, purpose) VALUES (${email}, ${ip ?? null}, ${purpose})`;
  });
  return token;
}

/**
 * Email a link that confirms the account's address. `origin` is the site's public origin. Returns `retryAfter` when
 * this address was sent too many links in the last hour (nothing is sent), and does nothing for a verified account.
 */
export async function sendVerification(sql: Sql, user: User, origin: string, { ip }: Origin = {}): Promise<{ sent: boolean; retryAfter?: number }> {
  if (user.emailVerified) return { sent: false };
  const retryAfter = await emailThrottle(sql, user.email, 'verify', ip);
  if (retryAfter) return { sent: false, retryAfter };
  const token = await issueEmailToken(sql, user.id, user.email, 'verify', ip);
  await mailer().send({
    to: user.email,
    subject: 'Confirm your email for Nutrikit',
    text: `Hi ${user.name},\n\nConfirm that this is your email address by opening this link:\n${origin}/verify-email?token=${token}\n\n`
      + `The link works for ${VERIFY_DAYS} days. If you didn't create a Nutrikit account, you can ignore this email.\n\n— Nutrikit`,
  });
  return { sent: true };
}

/** Confirm an address from its link. A link clicked again after it worked still answers that the email is verified. */
export async function verifyEmail(sql: Sql, token: unknown): Promise<{ email: string }> {
  if (typeof token !== 'string' || !token) throw invalidLink();
  const [row] = await sql<{ userId: string; email: string; expired: boolean; used: boolean; current: string; verified: boolean }[]>`
    SELECT t.user_id AS "userId", t.email, t.expires_at <= now() AS expired, t.used_at IS NOT NULL AS used,
           a.email AS current, a.email_verified_at IS NOT NULL AS verified
    FROM email_tokens t JOIN users a ON a.id = t.user_id
    WHERE t.id_hash = ${hashId(token)} AND t.purpose = 'verify'`;
  if (!row || row.email.toLowerCase() !== row.current.toLowerCase()) throw invalidLink();
  if (row.used || row.expired) {
    if (row.verified) return { email: row.current };
    throw invalidLink();
  }
  await sql.begin(async (tx) => {
    await tx`UPDATE email_tokens SET used_at = now() WHERE id_hash = ${hashId(token)}`;
    await tx`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${row.userId}`;
  });
  return { email: row.current };
}

/**
 * Email a password-reset link if an account uses this address. The caller always answers the same way, so this
 * never reveals whether the account exists; too many requests for one address are dropped silently.
 */
export async function requestPasswordReset(sql: Sql, email: unknown, origin: string, { ip }: Origin = {}): Promise<void> {
  const address = String(email ?? '').trim();
  if (!isEmail(address)) {
    throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: { email: 'Enter a valid email address.' } });
  }
  if (await emailThrottle(sql, address, 'reset', ip)) return;
  const [row] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email = ${address}`;
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
export async function resetPassword(sql: Sql, token: unknown, password: unknown): Promise<User> {
  const { password: problem } = validateSignup({ name: 'x', email: 'x@x.co', password });
  if (problem) throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: { password: problem } });
  if (typeof token !== 'string' || !token) throw invalidLink();
  const hash = await hashPassword(password as string);
  const userId = await sql.begin(async (tx) => {
    const [row] = await tx<{ userId: string; email: string }[]>`
      UPDATE email_tokens SET used_at = now()
      WHERE id_hash = ${hashId(token)} AND purpose = 'reset' AND used_at IS NULL AND expires_at > now()
      RETURNING user_id AS "userId", email`;
    if (!row) return null;
    await tx`UPDATE users SET password_hash = ${hash},
               email_verified_at = CASE WHEN email = ${row.email} THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END
             WHERE id = ${row.userId}`;
    await tx`DELETE FROM sessions WHERE user_id = ${row.userId}`;
    await tx`DELETE FROM email_tokens WHERE user_id = ${row.userId} AND purpose = 'reset' AND used_at IS NULL`;
    await tx`DELETE FROM login_failures WHERE email = ${row.email}`;
    return row.userId;
  });
  if (!userId) throw invalidLink();
  return getUser(sql, userId) as Promise<User>;
}

// ---- Account deletion ----
// A user deletes their login by confirming their password. Wrong passwords count as failed logins (same per-email
// limit), so this can't be used to guess a password around the login throttle.
// Teams where they are the only member are deleted with them (keys, usage rows, upgrade requests cascade; payment
// records are kept without the team, migration 005). It is refused while they are the only owner of a team that has
// other members: they must make someone else an owner first.
// Deleted with the user (ON DELETE CASCADE): memberships, sessions, email links. Deleted here: login failures and
// email sends recorded for the address, and the monthly counters of deleted teams.
export async function deleteAccount(sql: Sql, userId: string, password: unknown, { ip }: Origin = {}): Promise<{ email: string; deletedTeams: string[] }> {
  const [row] = await sql<{ email: string; password_hash: string }[]>`SELECT email, password_hash FROM users WHERE id = ${userId}`;
  if (!row) throw fail(404, 'not_found', 'account not found');
  if (!(await countAttempt(sql, row.email, ip, Infinity))) {
    throw Object.assign(fail(429, 'too_many_attempts', 'too many wrong passwords; try again in 15 minutes'), { retryAfter: 900 });
  }
  if (typeof password !== 'string' || !password || !(await verifyPassword(password, row.password_hash))) {
    throw Object.assign(fail(400, 'invalid_password', 'check the highlighted fields'), { fields: { password: 'Password is incorrect' } });
  }
  await sql`DELETE FROM login_failures WHERE email = ${row.email}`;
  const deletedTeams = await sql.begin(async (tx) => {
    // Lock the teams first (as membership changes do, teams.ts), then count: owners can't leave in between.
    await tx`SELECT a.id FROM accounts a JOIN memberships m ON m.account_id = a.id WHERE m.user_id = ${userId} ORDER BY a.id FOR UPDATE OF a`;
    const teams = await tx<{ id: string; name: string; role: Role; members: number; owners: number }[]>`
      SELECT a.id, a.name, m.role,
             (SELECT COUNT(*)::int FROM memberships x WHERE x.account_id = a.id) AS members,
             (SELECT COUNT(*)::int FROM memberships x WHERE x.account_id = a.id AND x.role = 'owner') AS owners
      FROM memberships m JOIN accounts a ON a.id = m.account_id
      WHERE m.user_id = ${userId}`;
    const blocking = teams.filter((t) => t.members > 1 && t.role === 'owner' && t.owners === 1);
    if (blocking.length) {
      throw Object.assign(fail(409, 'sole_owner', `you are the only owner of ${blocking.map((t) => t.name).join(', ')}; make another member an owner first`),
        { teams: blocking.map((t) => ({ id: t.id, name: t.name })) });
    }
    const solo = teams.filter((t) => t.members === 1).map((t) => t.id);
    if (solo.length) {
      await tx`DELETE FROM usage_periods WHERE subject IN ${tx(solo.flatMap((id) => [`acct:${id}`, `test:${id}`]))}`;
      await tx`DELETE FROM accounts WHERE id IN ${tx(solo)}`;
    }
    await tx`DELETE FROM login_failures WHERE email = ${row.email}`;
    await tx`DELETE FROM email_sends WHERE email = ${row.email}`;
    await tx`DELETE FROM users WHERE id = ${userId}`;
    return solo;
  });
  return { email: row.email, deletedTeams };
}

// ---- Housekeeping ----

/**
 * Deletes rows nothing reads any more: ended sessions, email links and invitations a day after they expire (a used
 * link keeps answering until then), throttle records past their windows, and idle per-minute rate windows (one per
 * demo visitor's address). Run periodically (app.ts); returns how many rows each table lost.
 */
export async function pruneExpired(sql: Sql): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const run = async (table: string, query: Promise<{ count: number }>) => { counts[table] = (await query).count; };
  await run('sessions', sql`DELETE FROM sessions WHERE expires_at < now()`);
  await run('email_tokens', sql`DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day'`);
  await run('invitations', sql`DELETE FROM invitations WHERE expires_at < now() - interval '1 day'`);
  await run('rate_windows', sql`DELETE FROM rate_windows WHERE window_start < now() - interval '1 hour'`);
  await run('login_failures', sql`DELETE FROM login_failures WHERE at < now() - interval '15 minutes'`);
  await run('signup_attempts', sql`DELETE FROM signup_attempts WHERE at < now() - interval '1 hour'`);
  await run('email_sends', sql`DELETE FROM email_sends WHERE at < now() - interval '1 day'`);
  await run('invite_sends', sql`DELETE FROM invite_sends WHERE at < now() - interval '1 hour'`);
  return counts;
}

export async function requestUpgrade(sql: Sql, accountId: string, plan: string, message: unknown): Promise<{ requested: string }> {
  if (!PLANS[plan] || plan === 'free') throw fail(400, 'invalid_plan', 'choose starter, growth or enterprise');
  await sql`INSERT INTO upgrade_requests (account_id, plan, message) VALUES (${accountId}, ${plan}, ${typeof message === 'string' ? message.slice(0, 1000) : null})`;
  return { requested: plan };
}

export async function listUpgradeRequests(sql: Sql): Promise<UpgradeRequest[]> {
  return sql<UpgradeRequest[]>`
    SELECT r.id, r.plan AS "requestedPlan", r.message, r.created_at AS "createdAt",
           a.id AS "accountId", ${ownerEmail(sql, 'a')} AS email, a.name, ${effectivePlan(sql, 'a')} AS "currentPlan"
    FROM upgrade_requests r JOIN accounts a ON a.id = r.account_id
    ORDER BY r.created_at DESC`.then((rows) => rows.map((r) => ({ ...r })));
}
