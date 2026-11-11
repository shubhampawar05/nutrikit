// Typed client for the portal API (/portal/api, session cookie) and small helpers for /v1.
// Portal calls always send X-Nutrikit-Portal (the server's CSRF check) and same-origin credentials.

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  retryAfter?: number;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

interface ErrorBody { error?: { code?: string; message?: string; fields?: Record<string, string> } }

/** Turns a non-2xx response into an ApiError carrying the server's code, message and field errors. */
export async function toApiError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as ErrorBody;
  const retry = res.headers.get('Retry-After');
  return new ApiError(res.status, data.error?.code || 'error', data.error?.message || 'Something went wrong', data.error?.fields, retry ? Number(retry) : undefined);
}

export async function portal<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/portal/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Nutrikit-Portal': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- shapes returned by the portal

export interface Plan {
  name: string;
  monthlyTokens: number | null;
  ratePerMinute: number;
  price: number | null; // per 30-day period, in `currency`; null = arranged directly
  currency: string;
  maxKeys: number;
  /** 0 = Free, increasing with value: the server never sells a plan ranked below the current one. */
  rank: number;
}

/** sessionStorage key of a key pasted into the playground (cleared on logout). */
export const PLAYGROUND_KEY_STORE = 'nk-playground-key';

export interface AccountView {
  account: { id: string; name: string; email: string; emailVerified?: boolean; createdAt: string };
  /** expiresAt: when a paid 30-day period ends (null = no end). */
  plan: Plan & { id: string; expiresAt: string | null };
  usage: { periodStart: string; used: number; remaining: number | null };
}

export interface Me extends AccountView {
  plans: Record<string, Plan>;
  billing: { enabled: boolean; mode: 'live' | 'test' | null; currency: string; keyId: string | null };
}

export interface NewKey { id: string; name: string; key: string }

export interface KeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  usedThisMonth: number;
}

export interface UsageDay { day: string; tokens: number; calls: number }
export interface UsageMonth {
  periodStart: string;
  tokenLimit: number | null;
  used: number;
  remaining: number | null;
  byEndpoint: { endpoint: string; calls: number; tokens: number }[];
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  expires_at: string;
  key: { id: string; name: string };
}

/** A Razorpay order for one 30-day period, waiting to be paid in Razorpay Checkout (amount in paise). */
export interface NewOrder { orderId: string; keyId: string; plan: string; amount: number; currency: string }

/** What Razorpay Checkout hands the page after a successful payment; the server verifies the signature. */
export interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export const api = {
  me: () => portal<Me>('GET', '/me'),
  /** Public: the plans the server sells, ordered by rank (no session needed). */
  plans: () => portal<{ plans: Record<string, Plan>; currency: string }>('GET', '/plans'),
  signup: (body: { name: string; email: string; password: string }) => portal<AccountView & { firstKey: NewKey }>('POST', '/signup', body),
  login: (body: { email: string; password: string }) => portal<AccountView>('POST', '/login', body),
  logout: () => portal<{ ok: true }>('POST', '/logout'),
  forgotPassword: (email: string) => portal<{ ok: true }>('POST', '/password/forgot', { email }),
  resetPassword: (token: string, password: string) => portal<AccountView>('POST', '/password/reset', { token, password }),
  verifyEmail: (token: string) => portal<{ verified: true; email: string }>('POST', '/email/verify', { token }),
  sendVerification: () => portal<{ sent: true } | { verified: true }>('POST', '/email/verification'),
  keys: () => portal<{ keys: KeySummary[] }>('GET', '/keys'),
  createKey: (name: string) => portal<NewKey>('POST', '/keys', { name }),
  revokeKey: (id: string) => portal<{ revoked: string }>('DELETE', `/keys/${id}`),
  usage: (days = 30) => portal<{ series: UsageDay[]; month: UsageMonth }>('GET', `/usage?days=${days}`),
  playgroundToken: () => portal<AccessToken>('POST', '/playground-token'),
  requestUpgrade: (plan: string, message?: string) => portal<{ requested: string }>('POST', '/upgrade', { plan, message }),
  createOrder: (plan: string) => portal<NewOrder>('POST', '/billing/order', { plan }),
  verifyPayment: (response: RazorpayPaymentResponse) => portal<AccountView>('POST', '/billing/verify', response),
  demo: <T>(text: string) => portal<T>('POST', '/demo', { text }),
};

/** A price such as "₹1,499" (no paise for whole amounts). */
export const fmtPrice = (amount: number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);

/** Token and call counts, grouped the same way on every page ("1,000,000"); prices use fmtPrice. */
export const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
/** Usage and billing period boundaries are UTC on the server, so show them in UTC ("1 Dec 2026" everywhere). */
export const fmtPeriodDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

/** A server message as a sentence: "too many requests" -> "Too many requests." */
export function sentence(message: string | null | undefined, fallback = 'Something went wrong.'): string {
  const text = String(message ?? '').trim();
  if (!text) return fallback;
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/** The message to show for any thrown value, as a sentence. */
export const errorText = (err: unknown, fallback = 'Something went wrong.') =>
  sentence(err instanceof Error ? err.message : null, fallback);
