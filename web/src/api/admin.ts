// Operator API (/v1/admin) for the admin console. The admin token is the bearer credential; while signed in it is
// kept in this tab's sessionStorage only (gone when the tab closes or on sign-out).
import { toApiError } from './client.ts';

const TOKEN_KEY = 'nk-admin-token';

export const adminToken = {
  get: (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (token: string) => { try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ } },
  clear: () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

/** Fired on window when the stored admin token is refused (401); the console returns to sign-in. */
export const ADMIN_UNAUTHORIZED = 'nk-admin-unauthorized';

/** Calls /v1/admin. With no explicit token it uses the stored one, and a 401 then clears it and fires ADMIN_UNAUTHORIZED. */
async function admin<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`/v1/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${token ?? adminToken.get() ?? ''}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && token === undefined) {
    adminToken.clear();
    window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED));
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

const qs = (q?: string) => (q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '');

export interface Overview {
  accounts: number;
  byPlan: Record<string, number>;
  activePaidPeriods: number;
  payments: { count: number; revenue: number; last30Days: { count: number; revenue: number } };
  activeKeys: number;
  upgradeRequests: number;
  tokensThisMonth: number;
}

export interface AdminAccount {
  id: string; email: string; name: string; plan: string; planExpiresAt: string | null; createdAt: string;
  activeKeys: number; usedThisMonth: number; totalPaid: number; lastPaymentAt: string | null;
}

export interface AdminPayment {
  paymentId: string; orderId: string; accountId: string; email: string; name: string;
  plan: string; amount: number; currency: string; periodEnd: string; paidAt: string;
}

export interface AdminKey {
  id: string; name: string; tokenLimit: number | null; createdAt: string; revokedAt: string | null; lastUsedAt: string | null;
  accountId: string | null; email: string | null; accountName: string | null; usedThisMonth: number;
}

export interface UpgradeRequest {
  id: number; requestedPlan: string; message: string | null; createdAt: string;
  accountId: string; email: string; name: string; currentPlan: string;
}

export interface RouteMetrics {
  route: string; count: number; byStatus: Record<'2xx' | '3xx' | '4xx' | '5xx', number>;
  p50Ms: number | null; p95Ms: number | null; p99Ms: number | null;
}

export interface Metrics {
  startedAt: string; uptimeSeconds: number;
  process: { rssMb: number; heapUsedMb: number; eventLoopDelayMs: { p50: number | null; p99: number | null; max: number | null }; node: string };
  requests: {
    total: number; byStatus: Record<'2xx' | '3xx' | '4xx' | '5xx', number>;
    last5Minutes: { requests: number; serverErrors: number }; last60Minutes: { requests: number; serverErrors: number };
  };
  routes: RouteMetrics[];
  alerts: { configured: boolean; sent: number; failed: number; suppressed: number; lastSentAt: string | null };
}

export const adminApi = {
  /** Checks a token by loading the overview with it. */
  signIn: (token: string) => admin<Overview>('GET', '/overview', undefined, token),
  overview: () => admin<Overview>('GET', '/overview'),
  accounts: (q?: string) => admin<{ accounts: AdminAccount[] }>('GET', `/accounts${qs(q)}`),
  payments: (q?: string) => admin<{ payments: AdminPayment[] }>('GET', `/payments${qs(q)}`),
  keys: (q?: string) => admin<{ keys: AdminKey[] }>('GET', `/keys${qs(q)}`),
  requests: () => admin<{ requests: UpgradeRequest[] }>('GET', '/upgrade-requests'),
  metrics: () => admin<Metrics>('GET', '/metrics'),
  revokeKey: (id: string) => admin<{ revoked: string }>('DELETE', `/keys/${id}`),
  setPlan: (accountId: string, plan: string) => admin<{ account: string; plan: string }>('POST', `/accounts/${accountId}/plan`, { plan }),
};
