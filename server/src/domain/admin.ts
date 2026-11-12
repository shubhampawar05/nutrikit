// Read models for the operator console (/admin) and the admin API: overview numbers, accounts, payments and keys.
// Lists are newest first, capped, and optionally filtered by email or name. Amounts are in rupees.
import type { Sql } from 'postgres';
import { effectivePlan } from './accounts.ts';
import { monthStart } from './auth.ts';

const LIMIT = 200;
const like = (q: string | undefined) => (q && q.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);

export interface Overview {
  accounts: number;
  byPlan: Record<string, number>;
  activePaidPeriods: number;
  payments: { count: number; revenue: number; last30Days: { count: number; revenue: number } };
  activeKeys: number;
  upgradeRequests: number;
  tokensThisMonth: number;
}

export async function overview(sql: Sql): Promise<Overview> {
  const plans = await sql<{ plan: string; n: number }[]>`SELECT ${effectivePlan(sql)} AS plan, COUNT(*) AS n FROM accounts GROUP BY 1`;
  const [counts] = await sql<{ accounts: number; active_paid: number; active_keys: number; requests: number; tokens: number }[]>`
    SELECT (SELECT COUNT(*) FROM accounts) AS accounts,
           (SELECT COUNT(*) FROM accounts WHERE plan_expires_at > now()) AS active_paid,
           (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL) AS active_keys,
           (SELECT COUNT(*) FROM upgrade_requests) AS requests,
           (SELECT COALESCE(SUM(tokens), 0) FROM usage WHERE at >= ${monthStart()}) AS tokens`;
  const [paid] = await sql<{ count: number; revenue: number; recent_count: number; recent_revenue: number }[]>`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS revenue,
           COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') AS recent_count,
           COALESCE(SUM(amount) FILTER (WHERE created_at > now() - interval '30 days'), 0) AS recent_revenue
    FROM payments`;
  return {
    accounts: counts!.accounts,
    byPlan: Object.fromEntries(plans.map((p) => [p.plan, p.n])),
    activePaidPeriods: counts!.active_paid,
    payments: { count: paid!.count, revenue: paid!.revenue / 100, last30Days: { count: paid!.recent_count, revenue: paid!.recent_revenue / 100 } },
    activeKeys: counts!.active_keys,
    upgradeRequests: counts!.requests,
    tokensThisMonth: counts!.tokens,
  };
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  plan: string;
  planExpiresAt: Date | null;
  createdAt: Date;
  activeKeys: number;
  usedThisMonth: number;
  totalPaid: number;
  lastPaymentAt: Date | null;
}

export async function listAccounts(sql: Sql, q?: string): Promise<AdminAccount[]> {
  const pattern = like(q);
  const rows = await sql<AdminAccount[]>`
    SELECT a.id, a.email, a.name, ${effectivePlan(sql, 'a')} AS plan,
           CASE WHEN a.plan_expires_at > now() THEN a.plan_expires_at END AS "planExpiresAt",
           a.created_at AS "createdAt",
           (SELECT COUNT(*) FROM api_keys k WHERE k.account_id = a.id AND k.revoked_at IS NULL) AS "activeKeys",
           (SELECT COALESCE(SUM(u.tokens), 0) FROM usage u WHERE u.account_id = a.id AND u.at >= ${monthStart()}) AS "usedThisMonth",
           (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.account_id = a.id) / 100.0 AS "totalPaid",
           (SELECT MAX(p.created_at) FROM payments p WHERE p.account_id = a.id) AS "lastPaymentAt"
    FROM accounts a
    WHERE ${pattern === null ? sql`TRUE` : sql`(a.email ILIKE ${pattern} OR a.name ILIKE ${pattern})`}
    ORDER BY a.created_at DESC
    LIMIT ${LIMIT}`;
  return rows.map((r) => ({ ...r, totalPaid: Number(r.totalPaid) }));
}

export interface AdminPayment {
  paymentId: string;
  orderId: string;
  /** Null once the paying account was deleted: the payment record is kept for accounting. */
  accountId: string | null;
  email: string | null;
  name: string | null;
  plan: string;
  amount: number;
  currency: string;
  periodEnd: Date;
  paidAt: Date;
}

export async function listPayments(sql: Sql, q?: string): Promise<AdminPayment[]> {
  const pattern = like(q);
  const rows = await sql<AdminPayment[]>`
    SELECT p.payment_id AS "paymentId", p.order_id AS "orderId", p.account_id AS "accountId", a.email, a.name,
           p.plan, p.amount / 100.0 AS amount, p.currency, p.period_end AS "periodEnd", p.created_at AS "paidAt"
    FROM payments p LEFT JOIN accounts a ON a.id = p.account_id
    WHERE ${pattern === null ? sql`TRUE` : sql`(a.email ILIKE ${pattern} OR a.name ILIKE ${pattern})`}
    ORDER BY p.created_at DESC
    LIMIT ${LIMIT}`;
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export interface AdminKey {
  id: string;
  name: string;
  tokenLimit: number | null;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  accountId: string | null;
  email: string | null;
  accountName: string | null;
  usedThisMonth: number;
}

/** Every key with its owner (operator keys have no account), active keys first. */
export async function listKeysWithOwners(sql: Sql, q?: string): Promise<AdminKey[]> {
  const pattern = like(q);
  const rows = await sql<AdminKey[]>`
    SELECT k.id, k.name, k.token_limit AS "tokenLimit", k.created_at AS "createdAt", k.revoked_at AS "revokedAt",
           k.last_used_at AS "lastUsedAt", k.account_id AS "accountId", a.email, a.name AS "accountName",
           (SELECT COALESCE(SUM(u.tokens), 0) FROM usage u WHERE u.key_id = k.id AND u.at >= ${monthStart()}) AS "usedThisMonth"
    FROM api_keys k LEFT JOIN accounts a ON a.id = k.account_id
    WHERE ${pattern === null ? sql`TRUE` : sql`(a.email ILIKE ${pattern} OR a.name ILIKE ${pattern} OR k.name ILIKE ${pattern})`}
    ORDER BY (k.revoked_at IS NULL) DESC, k.created_at DESC
    LIMIT ${LIMIT}`;
  return rows.map((r) => ({ ...r }));
}
