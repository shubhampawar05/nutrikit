# Proposal

## Why

Nutrikit is live and takes payments, but a production review found gaps that cost money or availability as soon
as traffic grows. Anyone can farm free accounts and spend the operator's AI budget. Password hashing blocks the
event loop, so a burst of logins stalls the API. Parallel requests can overspend a monthly allowance. The server
sees the proxy's address instead of the client's. And with logging off and no CI, problems are invisible and
untested commits deploy straight to production. This change is Phase 1 of the production roadmap: close the
abuse and correctness holes and make the service observable, without new infrastructure.

## What Changes

- **Client address**: the server trusts a configured number of proxy hops (`NUTRIKIT_TRUST_PROXY`), so every
  per-IP rule (demo, signup, login) uses the real client address. Render's blueprint sets it to 1.
- **Signup abuse**: signups are throttled per client address. Email verification waits for Phase 3 (no email
  service yet). A third-party bot check (CAPTCHA) is left out; it can be added later as its own change.
- **Login throttling**: failed logins are also throttled per client address, not only per email.
- **Non-blocking password hashing**: scrypt runs asynchronously; stored hashes stay compatible.
- **Atomic allowance**: a call reserves its flat cost with one conditional update against a per-period counter
  before the handler runs, so concurrent calls can no longer exceed the allowance. The counter replaces summing
  the `usage` table on every request. `usage` stays as the per-call history.
- **Charging failed AI calls**: when an AI-assisted call fails after the provider reported usage (refusal,
  truncation), the caller is charged the AI tokens consumed, and the error response says so in
  `X-Tokens-Charged`. A failed call with no AI usage is not charged. **BREAKING** for callers who assumed every
  error is free.
- **Outbound timeouts**: calls to the AI providers and to Razorpay have bounded timeouts. A timed-out AI call
  answers `504 ai_timeout`.
- **Security headers**: every response carries `X-Content-Type-Options`, `Referrer-Policy` and HSTS (when
  secure cookies are on); website pages also get a Content Security Policy.
- **Observability**: structured JSON request logs with a request id (also returned as `X-Request-Id`). Secrets
  and bodies are never logged. A readiness check, `GET /v1/health/ready`, checks the database; `/v1/health`
  stays a cheap liveness check.
- **CI**: a GitHub Actions workflow runs typecheck and the unit and browser tests against Postgres on every pull
  request and push to `main`.

## Capabilities

### New Capabilities

- `api-metering`: how /v1 calls are authenticated against an allowance, reserved, charged and rate limited.
- `portal-auth`: developer signup, login, sessions and their abuse protection.
- `http-security`: client-address resolution, security headers and outbound-call timeouts.
- `observability`: request logging, request ids and health/readiness checks.

### Modified Capabilities

None. Billing and the admin console keep their requirements. Razorpay calls gain a timeout, which is an
implementation detail of the existing "payment provider rejected the request" error.

## Impact

- **Server**: `app.ts` (logger, trustProxy, headers, request id), `plugins/metering.ts` and `domain/auth.ts`
  (reserve/settle, counter table), `domain/accounts.ts` and `routes/portal.ts` (async scrypt, throttles), AI providers and `billing.ts` (timeouts), `routes/v1.ts` (readiness route).
- **Database**: migration `003` adds `usage_periods` (account or key, period start, tokens used) and
  `signup_attempts`, and a client-address column on `login_failures`. It backfills the current month's counters
  from `usage`.
- **Config**: new `NUTRIKIT_TRUST_PROXY`, `NUTRIKIT_SIGNUP_LIMIT`, `NUTRIKIT_LOGIN_IP_LIMIT`,
  `NUTRIKIT_AI_TIMEOUT_MS`, `NUTRIKIT_LOG_LEVEL`. Added to `.env.example`, `.env.production.example`,
  `render.yaml` and `docs/configuration.md`.
- **Web**: website pages get a Content Security Policy; the signup and login forms show the new throttle errors.
- **Repo**: new `.github/workflows/ci.yml`.
- **API docs**: OpenAPI gains `/v1/health/ready`, `504 ai_timeout`, and `X-Request-Id`/`X-Tokens-Charged` on
  errors.
- **Out of scope (later phases)**: email verification and password reset, per-operator admin accounts, Redis,
  job queues, usage partitioning, error tracking and metrics services.
