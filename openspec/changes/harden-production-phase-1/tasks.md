# Tasks

## 1. CI

- [x] 1.1 Add `.github/workflows/ci.yml` (Node 22.13 and 24 matrix, `postgres:16` service, `npm ci`, `npm run typecheck`, `npm run test:unit` with `TEST_DATABASE_URL`) plus a push-to-`main` Playwright job; verify the workflow passes on a pull request
- [x] 1.2 Document CI and recommended branch protection for `main` in `docs/testing.md` and `docs/deployment.md`; verify the docs name the workflow file and the required check

## 2. Client address, request ids and logging

- [x] 2.1 Configure `trustProxy` from `NUTRIKIT_TRUST_PROXY` (hop count, default off) and switch the demo limit to `req.ip`; verify with tests that one trusted hop uses `X-Forwarded-For` and zero hops ignores a forged header
- [x] 2.2 Add `genReqId` (reuse a valid incoming `X-Request-Id`, else a UUID) and echo `X-Request-Id` on every response, including errors and 404s; verify with tests for generated, supplied, malformed and error cases
- [x] 2.3 Turn on the Fastify logger (`NUTRIKIT_LOG_LEVEL`, default `info`) with serializers that log request id, method, route, status, duration, key id and account id only; replace `console.error` in `errors.ts` and `billing.ts` with `req.log`/`app.log`; tests run `silent`; verify with a test that captures log output for a call carrying an API key and a session cookie and asserts that neither secret, the body, nor image data appears, and that a 500 logs a stack under the request id
- [x] 2.4 Add `NUTRIKIT_TRUST_PROXY` and `NUTRIKIT_LOG_LEVEL` to `.env.example`, `.env.production.example`, `docs/configuration.md`, and set `NUTRIKIT_TRUST_PROXY: "1"` in `render.yaml`; verify by reading the files back

## 3. Health and readiness

- [x] 3.1 Add `GET /v1/health/ready` (DB `SELECT 1` raced against 2 s, catalog open) answering 200/503 with per-check status; keep `/v1/health` DB-free; add it to OpenAPI; verify with tests for ready, database down (closed pool), and that `/v1/health` stays 200 when the database is down, plus the OpenAPI coverage test
- [x] 3.2 Document liveness vs readiness in `docs/deployment.md`; verify it explains why Render's health check stays on `/v1/health`

## 4. Security headers and CSP

- [x] 4.1 Add a global `onSend` hook setting `X-Content-Type-Options` and `Referrer-Policy` on every response, plus HSTS when `NUTRIKIT_SECURE_COOKIES=1`; verify with tests on a `/v1` route, a portal route and a 404, with and without secure cookies
- [x] 4.2 Add the Content-Security-Policy from design.md to website pages in `spa.ts`; verify with a server test asserting the header on `/` and `/dashboard`, and a production-build browser check that the home page, docs and Razorpay test-mode Checkout load with no CSP violations in the console

## 5. Outbound timeouts

- [x] 5.1 Add `NUTRIKIT_AI_TIMEOUT_MS` (default 60000); pass `timeout` and `maxRetries: 1` to the Anthropic client and the timeout to OpenAI's `AbortSignal`; map timeouts to `504 ai_timeout` with no usage; verify with provider tests that use a stub server that never answers and a short timeout
- [x] 5.2 Add a 15 s `AbortSignal.timeout` to Razorpay calls, mapping an abort to `502 billing_error`; verify with a billing test against a stub that hangs
- [x] 5.3 Document `504 ai_timeout` in OpenAPI and `docs/api.md`, and the timeout variable in `docs/configuration.md`; verify `npm run openapi` regenerates without errors

## 6. Atomic metering

- [x] 6.1 Add migration `003` with `usage_periods (subject, period_start, used)`, the current-month backfill from `usage`, `signup_attempts (ip, at)`, `login_failures.ip`, and a down migration; verify that `npm run migrate` up and down and up again succeeds on a database with existing usage rows, and the backfilled counters equal the sums
- [x] 6.2 Implement reserve (conditional upsert), settle (actual cost, same transaction as the `usage` insert and throttled `last_used_at` update) and release-on-failure in `auth.ts`/`metering.ts`; read `used`/`remaining` from the counter; verify the existing metering, usage and dashboard tests still pass
- [x] 6.3 Charge AI tokens on failed AI calls (provider errors carrying `usage`) and send `X-Tokens-Charged` on those errors; charge nothing on failures without AI usage or on `ai_timeout`; verify with tests for refusal (charged AI tokens only), a validation error (nothing), and a timeout (nothing)
- [x] 6.4 Add a concurrency test: an account with 20 tokens left sends 10 parallel 20-token calls, and at most one succeeds while the rest answer 429 `quota_exceeded`; add tests that the text variant of `labels/parse` settles to 5 tokens and that `GET /v1/usage` `used` matches the counter; verify they pass, including the multi-instance e2e script
- [x] 6.5 Add `npm run usage:reconcile [YYYY-MM]` to recompute a month's counters from `usage`; verify with a test that corrupts a counter and reconciles it
- [x] 6.6 Document the reserve/settle model, the failed-call charging (**breaking**) and reconciliation in `docs/api.md`, `docs/platform.md` and the SDK README's error section; verify the docs examples match the test expectations

## 7. Portal abuse protection

- [x] 7.1 Switch password hashing to async `crypto.scrypt` with unchanged parameters and format, use a precomputed dummy hash for unknown emails, and set `UV_THREADPOOL_SIZE=8` in the Dockerfile; verify that an account created with the old code logs in (fixture hash), and with a test that a `/v1/health` call during 20 concurrent logins answers in well under the total hashing time
- [x] 7.2 Add per-address signup throttling (`NUTRIKIT_SIGNUP_LIMIT`, default 5 per hour, counting invalid attempts) answering `429 too_many_signups` with `Retry-After`; verify with tests for the 6th attempt, separate addresses, and that no account or key is created
- [x] 7.3 Add per-address login throttling (`NUTRIKIT_LOGIN_IP_LIMIT`, default 20 per 15 minutes) alongside the per-email limit, and prune old `signup_attempts`; verify with tests for many emails from one address and for the existing per-email limit
- [x] 7.4 Show `too_many_signups` and `too_many_attempts` as form errors on the signup and login pages; verify with Vitest
- [x] 7.5 Document `NUTRIKIT_SIGNUP_LIMIT` and `NUTRIKIT_LOGIN_IP_LIMIT` in `.env.example`, `.env.production.example` and `docs/configuration.md`; verify by reading them back

## 8. Integration check

- [ ] 8.1 Run `npm run typecheck`, `npm test` (unit, browser, multi-instance, e2e) and a manual smoke on a production build: sign up, create a key, call search and photo, see `X-Request-Id` and JSON logs, `/v1/health/ready` 200; verify everything passes and record the results in the PR

## Workflow follow-up

- Review the PR, deploy, and watch logs for a day before raising traffic.
- Archive with `/opsx:archive` after review, which creates the `api-metering`, `portal-auth`, `http-security` and `observability` main specs.
- Next changes on the roadmap: Phase 2 operations (error tracking, metrics, staging, cleanup jobs, backups), Phase 3 product (email, password reset, GST invoices, admin accounts), Phase 4 scale (Redis limits, AI queue, usage partitioning, model tiering).
