# Design

## Context

See proposal.md for the motivation and specs/ for the required behavior. The current state that shapes the
approach:

- **Metering** (`plugins/metering.ts`, `domain/auth.ts`). Before a handler runs, `checkAllowance` reads
  `SUM(usage.tokens)` for the month. After it succeeds, `charge` inserts a `usage` row, updates
  `api_keys.last_used_at` and sums again. Nothing happens on failure. The read-then-write is not atomic, and
  every call repeats the sum over a month that keeps growing.
- **Passwords** (`domain/accounts.ts`) use `crypto.scryptSync` (N=16384, r=8, p=1), which takes about 50 ms
  of event-loop time per call. A login with an unknown email runs it twice.
- **Client address**: `Fastify({ logger: false })` with no `trustProxy`, so `req.ip` and
  `req.socket.remoteAddress` are Render's proxy. Only the demo uses a per-address limit today.
- **Shared state is in Postgres**: `rate_windows` (fixed one-minute windows, upserted on each call) and
  `login_failures`. This works across instances, and Phase 1 keeps it that way. There is no Redis.
- **Headers**: `spa.ts` sets `X-Frame-Options`, `nosniff` and `Referrer-Policy` on website pages only. The
  pages load Google Fonts, the Razorpay Checkout script (`checkout.razorpay.com`) and Open Food Facts images,
  and the server inlines a JSON-LD `<script type="application/ld+json">`, which a CSP does not execute or block.
- **Outbound calls**: OpenAI has a 120 s timeout and Open Food Facts 8 s. The Anthropic SDK client and
  Razorpay `fetch` have none (the SDK's default is 10 minutes).
- **Tests**: `node --test` with a throwaway Postgres database per file (`test/helpers.mjs`), Vitest for the web
  app, Playwright for end-to-end. No CI exists.

## Goals / Non-Goals

**Goals:**
- Allowance enforcement that holds under concurrency and costs O(1) per call.
- No new runtime infrastructure. Postgres stays the only shared store.
- Backwards compatibility for existing stored passwords, keys, sessions and usage history.
- Every new protection has a test.

**Non-Goals:**
- Sliding-window or token-bucket rate limiting. The fixed window stays.
- Moving rate limits to Redis, partitioning `usage`, or cleanup jobs (Phase 2/4).
- Email verification, password reset, per-operator admin accounts (Phase 3).
- A third-party bot check (CAPTCHA) on signup. The per-address throttle covers Phase 1.
- Error-tracking or metrics services (Phase 2). Logs go to stdout only.
- Dropping the `api_keys.last_used_at` write. It is throttled instead (see decision 2).

## Decisions

### 1. Reserve-then-settle against a per-period counter

New table `usage_periods(subject text, period_start date, used bigint, PRIMARY KEY (subject, period_start))`,
where `subject` is `acct:<id>` or `key:<id>`, using the same subject choice as `usedFor` today.

- **Reserve** (onRequest, after rate limiting): a single upsert that fails when the cost does not fit.
  ```sql
  INSERT INTO usage_periods (subject, period_start, used) VALUES ($s, $p, $cost)
  ON CONFLICT (subject, period_start) DO UPDATE SET used = usage_periods.used + $cost
    WHERE usage_periods.used + $cost <= $limit
  RETURNING used
  ```
  No row returned means quota exceeded. The INSERT branch is guarded by `$cost <= $limit`, checked in code
  before the statement. The row lock makes concurrent reservations serialize on that row.
- **Settle** (after the handler succeeds): `used = used + (actual − reserved)`, always applied with no limit
  check (the allowed overrun is at most one call's AI tokens). The `usage` row is inserted in the same
  transaction.
- **On failure**: an `onError`/`onResponse` path releases `reserved − aiTokens` and records a `usage` row only
  when `aiTokens > 0`. A request flag prevents settling twice.
- **Dynamic-cost routes** (`labels/parse`) reserve the route's configured worst case (`labelImage`), as the
  pre-check does today, and settle down to the variant that ran.
- **Unlimited allowances** (`tokenLimit == null`) skip reserving but still increment the counter at settle time,
  so reports stay cheap.
- **Reads**: `accountUsedThisMonth`, `usageSummary.used` and the `X-Tokens-Remaining` header read the counter.
  Per-endpoint and per-day breakdowns still query `usage` (dashboard and admin only, not the hot path).
- **Migration 003** backfills the current month: `INSERT … SELECT subject, month, SUM(tokens) FROM usage …`.

*Alternatives:* `SELECT … FOR UPDATE` on the account row plus `SUM`. That is atomic but still O(rows) and puts a
lock on `accounts`. An advisory lock per subject means more round trips for the same effect. Redis `INCRBY`
needs new infrastructure. The conditional upsert gives atomicity and O(1) in one round trip.

### 2. Fewer writes per call

`last_used_at` is updated only when it is more than 60 seconds old
(`WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')`). Settle runs the
counter update, the `usage` insert and this update in one transaction, so a call goes from about six round trips
to about four: auth, rate limit, reserve, settle.

### 3. Async scrypt with the same parameters

Use `util.promisify(crypto.scrypt)` with the existing N/r/p/keylen and `scrypt$salt$hash` format, so stored
hashes keep verifying and no rehash is needed. libuv runs scrypt on its threadpool (default 4 threads). Set
`UV_THREADPOOL_SIZE=8` in the Dockerfile so hashing cannot starve file and DNS work. The unknown-email path
verifies against one fixed dummy hash, computed once at startup, instead of hashing twice.

*Alternative:* argon2id. It is stronger but adds a native dependency, which the image deliberately avoids
(node:sqlite only), and needs rehash-on-login. Deferred.

### 4. Client address via Fastify `trustProxy`

`NUTRIKIT_TRUST_PROXY` takes a hop count or a comma-separated list of proxy addresses or CIDRs, and the code uses
`req.ip` everywhere. Fastify 5.12 reads a bare number as "trust nothing", because a hop count can't check who
the immediate peer is. So a count becomes a trust function, `(addr, hop) => hop < count`. That is safe only
where every request goes through the proxy, which is true on Render, where `render.yaml` sets `1`. On hosts
where clients can reach the server directly, use the address list. Either way a client can't pick its own
address by sending a forged `X-Forwarded-For`. The default is to trust nothing.

### 5. Throttles reuse existing tables

- **Signup per address**: new table `signup_attempts(ip inet, at timestamptz)`, indexed on `(ip, at)`, and
  counted like `login_failures`. An attempt is recorded before validation, so invalid submissions count too.
  `NUTRIKIT_SIGNUP_LIMIT` (default 5 per hour).
- **Login per address**: add a nullable `ip inet` column to `login_failures` and count by `ip` as well as by
  `email`. `NUTRIKIT_LOGIN_IP_LIMIT` (default 20 per 15 minutes). The existing opportunistic
  `DELETE … < now() - 15 min` also prunes `signup_attempts` older than one hour.

*Alternative:* reuse `rate_windows`. Its one-minute fixed window does not fit hourly limits, and a sliding count
over attempt rows is more accurate for low-volume events.

### 6. Timeouts

- **Anthropic**: `new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 1 })`. With two retries, worst-case
  latency was three timeouts.
- **OpenAI**: `AbortSignal.timeout(AI_TIMEOUT_MS)`.
- **Shared default**: `NUTRIKIT_AI_TIMEOUT_MS=60000`. A timeout (`APIConnectionTimeoutError` / `TimeoutError`)
  maps to `HttpError(504, 'ai_timeout')` with no usage, so decision 1 charges nothing.
- **Razorpay**: `AbortSignal.timeout(15000)`, with the abort mapped to the existing `502 billing_error`.

### 7. Headers in one global hook

An `onSend` hook in `app.ts` adds `nosniff` and `Referrer-Policy` to everything, plus
`Strict-Transport-Security: max-age=31536000; includeSubDomains` when `NUTRIKIT_SECURE_COOKIES=1`. `spa.ts`
keeps the page-only headers and adds the CSP:

```
default-src 'self'; script-src 'self' https://checkout.razorpay.com;
frame-src https://api.razorpay.com https://checkout.razorpay.com;
connect-src 'self' https://lumberjack.razorpay.com; img-src 'self' data: https://images.openfoodfacts.org
https://*.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`'unsafe-inline'` for styles is needed for React `style={}` attributes and the Razorpay overlay. Scripts stay
strict. No dependency on `@fastify/helmet`: the header set is small and fixed. The Vite dev server is
unaffected because the CSP is only sent by the production server.

### 8. Logging with Fastify's built-in pino

`logger: { level: NUTRIKIT_LOG_LEVEL || 'info', redact: [...] }` with custom serializers that log only method,
route pattern (`req.routeOptions.url`), status, `responseTime`, `req.id`, and the key or account id (added in
`onResponse`). Request headers are not logged, so redaction is defence in depth. `genReqId` reuses a valid
incoming `X-Request-Id` or `crypto.randomUUID()`, and an `onSend` hook echoes it.
`errors.ts` replaces `console.error(err)` with `req.log.error({ err })`. Tests set the level to `silent`.

### 9. Readiness route

`GET /v1/health/ready` runs `SELECT 1` raced against a 2 s timer and checks `foods()` opens. It is unmetered,
like `/v1/health`. Render keeps `healthCheckPath: /v1/health`, so a database outage does not restart the
container in a loop. Readiness is for load balancers and uptime monitors.

### 10. CI

`.github/workflows/ci.yml`: on `pull_request` and on push to `main`, using Node 22.16 (the first 22.x whose built-in SQLite has FTS5, which food search needs) and Node 24 with a
`postgres:16` service. Steps: `npm ci`, `npm run typecheck`, `npm run test:unit` with
`TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`. The Playwright end-to-end test runs in a
separate job, only on push to `main`, because it needs Docker Compose and browser installs. `foods.db` is in git,
so the catalog build is not needed. The workflow states the intent that Render's `autoDeploy` is
safe only because main is protected. Branch protection itself is a repository setting the owner turns on.

## Risks / Trade-offs

- [Counter drifts from `usage` if a settle is lost (process crash mid-request)] → The reservation stays
  counted, so the drift is in the operator's favour by at most the flat cost. Add a tested
  `npm run usage:reconcile` script that recomputes a month from `usage`.
- [Hot counter row for a very busy account serializes its calls] → One short row update per call. That is fine
  at Growth plan rates (600 per minute). Phase 4 moves counters to Redis if needed.
- [`trustProxy` set too high on a different host lets clients spoof addresses] → Default 0. Document "set to the
  number of proxies in front of the server" in `docs/deployment.md`.
- [Signup limit per address blocks shared networks (offices, colleges, mobile carrier NAT)] → Default 5 per hour
  is configurable. The error message suggests trying later, and operators can raise the limit.
- [Charging AI tokens on a failed call surprises existing users] → Mark it as breaking in the changelog and API
  docs, and expose `X-Tokens-Charged` on the error. The amounts are small (1 token per 1,000 model tokens).
- [CSP breaks a page or the payment flow] → Browser test that the Checkout script and frame origins are
  allowed. Verify a test-mode payment on staging (or a local production build) before deploy.
- [Async scrypt under a login flood still uses CPU] → It no longer blocks the event loop, and the per-address
  login throttle bounds the volume.

## Migration Plan

1. Merge with CI green. Migration `003` is additive: new tables, a nullable column, and a backfill.
2. Deploy. `start.js` runs `003` before listening. The backfill covers the current month, so allowances carry
   over exactly.
3. Set `NUTRIKIT_TRUST_PROXY=1` on Render (in `render.yaml`).
4. Check the request logs and `X-Request-Id` in production. Confirm `/v1/health/ready` answers 200.
5. **Rollback**: redeploy the previous image. The old code ignores the new tables and column and still sums
   `usage`, which kept being written. Run `003`'s down migration only if the tables must go.

## Open Questions

- Exact default limits for signup per address and login per address. They are configurable, and the defaults
  can be tuned after a week of logs.
- Whether to also cap concurrent AI calls per account in Phase 1, or leave it to Phase 4's queue. The spec does
  not require it.
