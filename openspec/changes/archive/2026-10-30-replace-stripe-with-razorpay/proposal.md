# Proposal

## Why

Paid upgrades should happen without an operator approving each one, and the business bills in India,
so the payment provider should be Razorpay (INR, UPI and Indian cards) instead of Stripe. The current
Stripe integration also double-bills an account that switches between paid plans and downgrades it when
an old subscription ends, because it never records which subscription the account is on.

## What Changes

- **BREAKING** Remove the Stripe integration: `POST /webhooks/stripe`, `STRIPE_*` settings and the Stripe CLI
  compose service. Payments go through Razorpay.
- Paid plans are priced in INR (placeholders: Starter ₹1,499, Growth ₹11,999 per 30 days). The plan data the
  portal returns carries `price` and `currency` instead of `priceUsd`. **BREAKING** for clients of `/portal/api/me`.
- Self-serve **one-time payments** (Razorpay Orders): paying unlocks Starter or Growth for 30 days. Paying again
  extends the same plan by 30 days or moves up to Growth; when the period lapses the account falls back to Free.
  No auto-renewal.
- The dashboard opens Razorpay Checkout; the browser sends Razorpay's signed response to the server, which verifies
  it and applies the plan immediately. A signature-checked `order.paid` webhook applies payments whose browser
  confirmation never arrived. Each payment is applied once.
- Enterprise and servers without Razorpay keys keep the upgrade-request flow.
- Recurring subscriptions (auto-renewal) are deferred: they need the Razorpay Subscriptions product enabled.

## Capabilities

### New Capabilities

- `billing`: self-serve paid plans through Razorpay one-time payments: 30-day plan periods, verified payment
  confirmation, webhook backup, expiry back to Free, and the request-based fallback.

### Modified Capabilities

None (no main specs exist yet).

## Impact

- **Server**: `domain/billing.ts` rewritten for Razorpay Orders; `domain/accounts.ts` plan prices and the effective
  plan (expired paid plans read as Free); migration `002_paid_plans` (plan expiry, applied payments); portal routes
  `POST /portal/api/billing/order` and `/billing/verify` replace `/portal/api/checkout`; `/webhooks/razorpay`
  replaces `/webhooks/stripe`.
- **Web**: dashboard plan card pays through Razorpay Checkout and shows the paid-until date; INR prices on the
  pricing page.
- **Config**: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` replace the `STRIPE_*` variables.
- **Tests**: billing tests run against a fake Razorpay API; web tests updated for the new plan shape.
- **Out of scope**: auto-renewing subscriptions, proration (moving up to Growth starts a fresh 30 days), refunds,
  invoices and GST handling.
