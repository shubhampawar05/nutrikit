# Design

## Context

See proposal.md (Why). Billing today lives in `server/src/domain/billing.ts` (Stripe Checkout through `fetch`, no SDK),
`POST /portal/api/checkout`, `POST /webhooks/stripe` (raw-body scope in `routes/webhooks.ts`), `PLANS.priceUsd` in
`domain/accounts.ts`, and the dashboard plan card, which redirects to Stripe and polls on return. Accounts do not
record a subscription, which is the cause of the double-billing and wrong-downgrade bugs.

## Goals / Non-Goals

**Goals:** Razorpay one-time payments in INR that grant 30-day plan periods; activation that does not depend on a
webhook reaching a laptop; each payment applied exactly once; expiry without a scheduler; no new runtime dependency.

**Non-Goals:** auto-renewing subscriptions (deferred until the Razorpay Subscriptions product is enabled), proration,
refunds, GST invoices, keeping Stripe as an option.

## Decisions

### 1. Razorpay Orders + Checkout over `fetch`, no SDK
`https://api.razorpay.com/v1`, HTTP Basic auth with key id and secret, JSON bodies; `RAZORPAY_API_BASE` overrides the
host for tests. Orders need no extra Razorpay product, unlike Subscriptions (which answer 401 until enabled).

### 2. Payment flow
```
  POST /portal/api/billing/order {plan}
    -> Razorpay POST /v1/orders {amount (paise), currency INR, receipt, notes: account_id + plan}
  Checkout (browser, order_id) -> {razorpay_payment_id, razorpay_order_id, razorpay_signature}
  POST /portal/api/billing/verify
    -> signature = HMAC_SHA256(key_secret, order_id|payment_id)?  order notes.account_id == account?
    -> apply payment (once) -> account view
```
Creating an order stores nothing, so abandoned payments never affect the account.

### 3. Plan periods and expiry
Migration `002_paid_plans` adds `accounts.plan_expires_at` (null = no end) and a `payments` table
(`payment_id` primary key, order, account, plan, amount, currency, period end, time).
Applying a payment, in one transaction:
- insert into `payments`; if the payment id already exists, stop (replays and webhook + browser both arriving);
- same plan and still running: `expires = expires + 30 days`; otherwise `plan = paid plan, expires = now + 30 days`.

Starting a payment for a cheaper plan while a dearer period runs answers `409 plan_active`, so time is never thrown
away. Every read of an account's plan (portal and API keys) uses the *effective* plan:
`CASE WHEN plan_expires_at <= now() THEN 'free' ELSE plan END`, so expiry needs no cron. Operator plan changes
(`/v1/admin/accounts/:id/plan`) clear `plan_expires_at`.

### 4. Webhook backup
`POST /webhooks/razorpay` keeps the raw-body scope; `X-Razorpay-Signature` = hex HMAC-SHA256(webhook secret, raw body),
compared in constant time. `order.paid` events whose order notes name an account apply the payment through the same
idempotent path. Other events are acknowledged. Without `RAZORPAY_WEBHOOK_SECRET` the route answers 501.

### 5. Dashboard
The plan card loads `https://checkout.razorpay.com/v1/checkout.js` only when a payment starts and opens it with the
order id and public key, prefilled with the account's name and email. On a paid plan it shows the paid-until date and
offers to extend it (same plan) or move up. Prices use `Intl.NumberFormat('en-IN', { currency: 'INR' })`.

### 6. Portal API
`POST /portal/api/billing/order {plan}` -> 201 `{ orderId, keyId, plan, amount, currency }`;
`POST /portal/api/billing/verify {razorpay_payment_id, razorpay_order_id, razorpay_signature}` -> account view.
`/portal/api/me` returns `billing: { enabled, mode, currency, keyId }`, `plans[*].price/currency` and
`plan.expiresAt`.

## Risks / Trade-offs

- [Webhook and browser verification both arrive] -> the `payments` primary key makes the second a no-op.
- [A paid period lapses mid-burst] -> the next request simply sees Free limits; no partial state.
- [No auto-renewal] -> developers pay again each period; the dashboard shows when the period ends.
- [Clients reading `priceUsd`] -> only the bundled web app reads it, updated in the same change.

## Migration Plan

Deploy runs migration `002` (additive). No Stripe payments exist (Stripe was never configured). Rollback: redeploy
the previous image; the extra column and table are ignored by it.
