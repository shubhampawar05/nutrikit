// Self-serve paid plans through one-time Razorpay payments (Orders, INR), with no SDK dependency.
// Each payment unlocks Starter or Growth for 30 days; paying again extends the same plan or moves up to a
// dearer one. There is no auto-renewal: when the period ends the account reads as Free (accounts.effectivePlan).
// A payment never moves a team down or puts an end date on a plan that has none (one an operator set): such a
// payment is recorded with a note for operators and the plan is kept.
//
//   createOrder -> Razorpay Checkout in the browser -> verifyPayment (signed response) -> applyPayment
//   An `order.paid` webhook applies payments whose browser confirmation never arrived. Each payment applies once.
// Use test-mode keys (rzp_test_...) while developing; Razorpay's test cards and UPI ids complete payments.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { PLANS, CURRENCY, effectivePlan, fail, planRank } from './accounts.ts';
import type { Account } from './accounts.ts';

const API = () => process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com';
const PERIOD_DAYS = 30;

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

type BillingEventResult =
  | { applied: 'payment'; accountId: string; plan: string; note?: string }
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

// A hung or unreachable Razorpay answers like a rejected request (502 billing_error), within 15 s.
const TIMEOUT_MS = () => Number(process.env.RAZORPAY_TIMEOUT_MS) || 15_000;
const unavailable = (logDetail: string) => Object.assign(fail(502, 'billing_error', 'the payment provider did not respond; try again later'), { logDetail });

async function razorpay(method: 'GET' | 'POST', path: string, body?: object): Promise<RazorpayEntity> {
  const signal = AbortSignal.timeout(TIMEOUT_MS());
  let res: Response;
  try {
    res = await fetch(`${API()}/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    throw unavailable(`razorpay ${method} ${path} ${signal.aborted ? `timed out after ${TIMEOUT_MS()} ms` : `failed: ${(err as Error).message}`}`);
  }
  const data = (await res.json().catch(() => {
    if (signal.aborted) throw unavailable(`razorpay ${method} ${path} timed out reading the response`);
    return {};
  })) as RazorpayEntity;
  if (!res.ok) {
    const detail = typeof data.error === 'string' ? data.error : [data.error?.code, data.error?.description].filter(Boolean).join(': ');
    const logDetail = `razorpay ${method} ${path} failed: ${res.status} ${detail || ''}${res.status === 401 ? ' (check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET belong to the same key)' : ''}`;
    throw Object.assign(fail(502, 'billing_error', 'the payment provider rejected the request; try again later'), { logDetail });
  }
  return data;
}

const paise = (rupees: number) => Math.round(rupees * 100);


export interface NewOrder { orderId: string; keyId: string; plan: string; amount: number; currency: string }

/** Creates a Razorpay order for one 30-day period of a paid plan; Checkout then collects the payment. */
export async function createOrder(account: Account, plan: string): Promise<NewOrder> {
  if (!billingInfo().enabled) throw fail(501, 'billing_disabled', 'online payment is not configured on this server');
  const details = PLANS[plan];
  if (!details || plan === 'free') throw fail(400, 'invalid_plan', 'choose starter or growth');
  if (details.price == null) throw fail(400, 'contact_sales', `the ${details.name} plan is arranged with us directly; send an upgrade request`);
  // A payment never moves an account down: not while a paid period runs, and not from a plan an operator set.
  if (plan !== account.plan && planRank(plan) < planRank(account.plan)) {
    throw fail(409, 'plan_active', account.planExpiresAt
      ? `your ${account.planDetails.name} plan runs until ${account.planExpiresAt.toISOString().slice(0, 10)}; you can extend it or choose a plan after it ends`
      : `you're on the ${account.planDetails.name} plan, which includes everything in ${details.name}; contact us to change plans`);
  }
  // Nor does it put an end date on a plan without one (Free aside): paying for it again would only shorten it.
  if (plan === account.plan && !account.planExpiresAt) {
    throw fail(409, 'plan_active', `your ${account.planDetails.name} plan has no end date; there is nothing to extend`);
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
export async function verifyPayment(sql: Sql, account: Account, response: PaymentResponse): Promise<{ note: string | null }> {
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
  return { note: (await applyPayment(sql, paymentId, order))?.note ?? null };
}

/**
 * Grants the order's plan for one period, once per payment: the same plan still running is extended by 30 days;
 * otherwise the plan starts now and runs 30 days. The plan is kept, and the payment recorded with a note, when the
 * team is on a dearer plan or already has this one with no end date (an order made before an operator changed the
 * plan, or a second order paid after a dearer one). Returns null when the payment was already applied.
 */
async function applyPayment(sql: Sql, paymentId: string, order: RazorpayEntity): Promise<{ note: string | null } | null> {
  const accountId = order.notes?.account_id;
  const plan = order.notes?.plan;
  if (!order.id || !accountId || !plan || plan === 'free' || PLANS[plan]?.price == null) {
    throw fail(400, 'invalid_payment', 'the order is not for a plan that can be bought online');
  }
  const orderId = order.id;
  const amount = order.amount ?? paise(PLANS[plan]!.price!);
  const currency = order.currency ?? CURRENCY;
  return sql.begin(async (tx) => {
    const [account] = await tx<{ plan: string; expires: Date | null }[]>`
      SELECT ${effectivePlan(tx)} AS plan, CASE WHEN plan_expires_at > now() THEN plan_expires_at END AS expires
      FROM accounts WHERE id = ${accountId} FOR UPDATE`;
    if (!account) throw fail(400, 'invalid_payment', 'the account for this payment no longer exists');
    const current = PLANS[account.plan]?.name ?? account.plan;
    const keep = planRank(plan) < planRank(account.plan)
      ? `not applied: the team was on the dearer ${current} plan`
      : plan === account.plan && !account.expires
        ? `not applied: the team's ${current} plan has no end date`
        : null;
    const start = !keep && account.plan === plan && account.expires ? account.expires : new Date();
    const periodEnd = keep ? account.expires ?? new Date() : new Date(start.getTime() + PERIOD_DAYS * 864e5);
    const inserted = await tx`
      INSERT INTO payments (payment_id, order_id, account_id, plan, amount, currency, period_end, note)
      VALUES (${paymentId}, ${orderId}, ${accountId}, ${plan}, ${amount}, ${currency}, ${periodEnd}, ${keep})
      ON CONFLICT (payment_id) DO NOTHING`;
    if (inserted.count === 0) return null; // already applied (browser and webhook both arrived, or a replay)
    if (!keep) await tx`UPDATE accounts SET plan = ${plan}, plan_expires_at = ${periodEnd} WHERE id = ${accountId}`;
    return { note: keep };
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
  if (!applied) return { applied: null };
  return { applied: 'payment', accountId, plan: order.notes!.plan!, ...(applied.note ? { note: applied.note } : {}) };
}

/**
 * A payment that was taken but left the plan unchanged needs an operator (most likely a refund): it is logged and
 * sent as an alert, besides the note on the payment the admin console shows.
 */
export function paymentKept(app: FastifyInstance, accountId: string, note: string): void {
  app.log.warn({ accountId, note }, 'payment recorded without changing the plan');
  void app.monitor.alert('payment_kept', 'A payment was recorded without changing the plan', { team: accountId, note }, `payment_kept:${accountId}:${note}`);
}
