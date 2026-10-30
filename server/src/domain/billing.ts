// Self-serve paid plans through one-time Razorpay payments (Orders, INR), with no SDK dependency.
// Each payment unlocks Starter or Growth for 30 days; paying again extends the same plan or moves up to a
// dearer one. There is no auto-renewal: when the period ends the account reads as Free (accounts.effectivePlan).
//
//   createOrder -> Razorpay Checkout in the browser -> verifyPayment (signed response) -> applyPayment
//   An `order.paid` webhook applies payments whose browser confirmation never arrived. Each payment applies once.
// Use test-mode keys (rzp_test_...) while developing; Razorpay's test cards and UPI ids complete payments.
import crypto from 'node:crypto';
import type { Sql } from 'postgres';
import { PLANS, CURRENCY, effectivePlan } from './accounts.ts';
import type { Account, DomainError } from './accounts.ts';

const API = () => process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com';
export const PERIOD_DAYS = 30;

const fail = (status: number, code: string, message: string): DomainError => Object.assign(new Error(message), { status, code });

// The few Razorpay response fields we read (external JSON; anything may be missing).
interface RazorpayEntity {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  notes?: { account_id?: string; plan?: string };
  // Usually { code, description }; an authentication failure is the bare string "Unauthorized".
  error?: { code?: string; description?: string } | string;
}

/** A Razorpay webhook event, reduced to the fields applyEvent reads. */
export interface RazorpayEvent {
  event?: string;
  payload?: { order?: { entity?: RazorpayEntity }; payment?: { entity?: RazorpayEntity } };
}

export type BillingEventResult =
  | { applied: 'payment'; accountId: string; plan: string }
  | { applied: null };

export interface BillingInfo {
  enabled: boolean;
  mode: 'live' | 'test' | null;
  currency: string;
  /** Public key for Razorpay Checkout in the browser (never the secret). */
  keyId: string | null;
}

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';

export function billingInfo(): BillingInfo {
  const id = keyId();
  if (!id || !keySecret()) return { enabled: false, mode: null, currency: CURRENCY, keyId: null };
  return { enabled: true, mode: id.startsWith('rzp_live_') ? 'live' : 'test', currency: CURRENCY, keyId: id };
}

async function razorpay(method: 'GET' | 'POST', path: string, body?: object): Promise<RazorpayEntity> {
  const res = await fetch(`${API()}/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as RazorpayEntity;
  if (!res.ok) {
    const detail = typeof data.error === 'string' ? data.error : [data.error?.code, data.error?.description].filter(Boolean).join(': ');
    console.error(`razorpay ${method} ${path} failed: ${res.status} ${detail || ''}${res.status === 401 ? ' (check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET belong to the same key)' : ''}`);
    throw fail(502, 'billing_error', 'the payment provider rejected the request; try again later');
  }
  return data;
}

const paise = (rupees: number) => Math.round(rupees * 100);

/** Paid plans in price order; buying a cheaper plan while a dearer period runs would waste paid time. */
const rank = (plan: string) => PLANS[plan]?.price ?? 0;

export interface NewOrder { orderId: string; keyId: string; plan: string; amount: number; currency: string }

/** Creates a Razorpay order for one 30-day period of a paid plan; Checkout then collects the payment. */
export async function createOrder(account: Account, plan: string): Promise<NewOrder> {
  if (!billingInfo().enabled) throw fail(501, 'billing_disabled', 'online payment is not configured on this server');
  const details = PLANS[plan];
  if (!details || plan === 'free') throw fail(400, 'invalid_plan', 'choose starter or growth');
  if (details.price == null) throw fail(400, 'contact_sales', `the ${details.name} plan is arranged with us directly; send an upgrade request`);
  if (account.planExpiresAt && plan !== account.plan && rank(plan) < rank(account.plan)) {
    throw fail(409, 'plan_active', `your ${account.planDetails.name} plan runs until ${account.planExpiresAt.toISOString().slice(0, 10)}; you can extend it or choose a plan after it ends`);
  }
  const amount = paise(details.price);
  const order = await razorpay('POST', '/orders', {
    amount,
    currency: CURRENCY,
    receipt: `${account.id}-${Date.now().toString(36)}`.slice(0, 40),
    notes: { account_id: account.id, plan },
  });
  if (!order.id) throw fail(502, 'billing_error', 'the payment provider did not return an order');
  return { orderId: order.id, keyId: keyId(), plan, amount, currency: CURRENCY };
}

const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmac = (secret: string, data: string | Buffer) => crypto.createHmac('sha256', secret).update(data).digest('hex');

export interface PaymentResponse { razorpay_payment_id?: unknown; razorpay_order_id?: unknown; razorpay_signature?: unknown }

/**
 * Checks the signed response Razorpay Checkout hands the browser after a successful payment, confirms the order
 * belongs to this account, and applies the payment.
 */
export async function verifyPayment(sql: Sql, account: Account, response: PaymentResponse): Promise<void> {
  if (!billingInfo().enabled) throw fail(501, 'billing_disabled', 'online payment is not configured on this server');
  const { razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature } = response;
  if (typeof paymentId !== 'string' || typeof orderId !== 'string' || typeof signature !== 'string') {
    throw fail(400, 'invalid_payment', 'the payment response is incomplete');
  }
  if (!sameHex(hmac(keySecret(), `${orderId}|${paymentId}`), signature)) {
    throw fail(400, 'invalid_payment', 'the payment response could not be verified');
  }
  const order = await razorpay('GET', `/orders/${encodeURIComponent(orderId)}`);
  if (order.notes?.account_id !== account.id) throw fail(400, 'invalid_payment', 'this payment does not belong to your account');
  await applyPayment(sql, paymentId, order);
}

/**
 * Grants the order's plan for one period, once per payment: the same plan still running is extended by 30 days;
 * otherwise the plan starts now and runs 30 days. Returns false when the payment was already applied.
 */
async function applyPayment(sql: Sql, paymentId: string, order: RazorpayEntity): Promise<boolean> {
  const accountId = order.notes?.account_id;
  const plan = order.notes?.plan;
  if (!order.id || !accountId || !plan || plan === 'free' || PLANS[plan]?.price == null) {
    throw fail(400, 'invalid_payment', 'the order is not for a plan that can be bought online');
  }
  const orderId = order.id;
  const amount = order.amount ?? paise(PLANS[plan]!.price!);
  const currency = order.currency ?? CURRENCY;
  return sql.begin(async (tx) => {
    const [account] = await tx<{ plan: string; plan_expires_at: Date | null }[]>`
      SELECT ${effectivePlan(tx)} AS plan, plan_expires_at FROM accounts WHERE id = ${accountId} FOR UPDATE`;
    if (!account) throw fail(400, 'invalid_payment', 'the account for this payment no longer exists');
    const running = account.plan === plan && account.plan_expires_at !== null && account.plan_expires_at > new Date();
    const start = running ? account.plan_expires_at! : new Date();
    const periodEnd = new Date(start.getTime() + PERIOD_DAYS * 864e5);
    const inserted = await tx`
      INSERT INTO payments (payment_id, order_id, account_id, plan, amount, currency, period_end)
      VALUES (${paymentId}, ${orderId}, ${accountId}, ${plan}, ${amount}, ${currency}, ${periodEnd})
      ON CONFLICT (payment_id) DO NOTHING`;
    if (inserted.count === 0) return false; // already applied (browser and webhook both arrived, or a replay)
    await tx`UPDATE accounts SET plan = ${plan}, plan_expires_at = ${periodEnd} WHERE id = ${accountId}`;
    return true;
  });
}

/** Throws unless X-Razorpay-Signature is the HMAC of the raw body with the webhook secret. */
export function verifyWebhook(raw: Buffer, signature: string | undefined, secret = process.env.RAZORPAY_WEBHOOK_SECRET): RazorpayEvent {
  if (!secret) throw fail(501, 'billing_disabled', 'RAZORPAY_WEBHOOK_SECRET is not set');
  if (!signature) throw fail(400, 'invalid_signature', 'missing X-Razorpay-Signature');
  if (!sameHex(hmac(secret, raw), signature)) throw fail(400, 'invalid_signature', 'signature mismatch');
  try {
    return JSON.parse(raw.toString('utf8')) as RazorpayEvent;
  } catch {
    throw fail(400, 'invalid_request', 'body must be JSON');
  }
}

/** Applies a verified `order.paid` event for an order the portal created; everything else is acknowledged. */
export async function applyEvent(sql: Sql, event: RazorpayEvent): Promise<BillingEventResult> {
  const order = event.payload?.order?.entity;
  const payment = event.payload?.payment?.entity;
  const accountId = order?.notes?.account_id;
  if (event.event !== 'order.paid' || !order || !accountId || !payment?.id) return { applied: null };
  const [exists] = await sql`SELECT 1 FROM accounts WHERE id = ${accountId}`;
  if (!exists) return { applied: null };
  const applied = await applyPayment(sql, payment.id, order);
  return applied ? { applied: 'payment', accountId, plan: order.notes!.plan! } : { applied: null };
}
