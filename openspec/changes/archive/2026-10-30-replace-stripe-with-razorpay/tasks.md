# Tasks

## 1. Server

- [x] 1.1 Replace migration `002` with `002_paid_plans` (accounts.plan_expires_at, payments table), INR prices in `PLANS`, and the effective plan on every read (portal and API keys); admin plan changes clear the expiry; verify migrate up/down and a test that an expired period reads as Free
- [x] 1.2 Rewrite `domain/billing.ts` for Razorpay Orders: billing info, create order, payment-signature check, idempotent apply (extend or move up, `plan_active` guard), `order.paid` webhook; verify with `billing.test` against a fake Razorpay API
- [x] 1.3 Routes: `/portal/api/billing/{order,verify}` and `/webhooks/razorpay`; verify `billing.test` covers order creation, verify (valid, replayed, forged, foreign), extension, moving up, the 409 guard, expiry, webhook backup and bad signatures, and the 501s without credentials

## 2. Web

- [x] 2.1 Client types and the dashboard plan card: Checkout with the order, verify, paid-until date, extend/move up, request fallback; verify with Dashboard Vitest tests
- [x] 2.2 INR prices on the pricing page ("per 30 days") and other web tests updated; verify `npm test -w web`

## 3. Cleanup and docs

- [x] 3.1 Stripe removed everywhere; Razorpay settings in `.env.example`, compose and the README (test-mode steps, webhook setup, no auto-renewal); verify `grep -ri stripe` finds nothing outside the archive
- [x] 3.2 Run `npm run typecheck`, `npm run test:unit` and the Playwright smoke test; verify all pass
- [x] 3.3 Real test-mode check with the configured `rzp_test_` keys: the server creates a Razorpay order; verify the order exists in Razorpay

## Workflow follow-up

- Archive with `/opsx:archive` after review.
- Follow-up change: auto-renewing subscriptions once the Razorpay Subscriptions product is enabled.
