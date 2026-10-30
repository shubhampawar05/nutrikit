# Tasks

## 1. Workspace and tooling setup

- [x] 1.1 Convert the root `package.json` into an npm workspaces root (`server`, `web`, `sdk/js`) and move `src/`, `scripts/`, `test/`, `data/` and `docs/` under `server/`; verify `npm install` succeeds from the root and the existing tests still pass with `node --test server/test/`
- [x] 1.2 Add TypeScript (`typescript`, `tsx`, `@types/node`) as devDependencies, with a shared `tsconfig.base.json` and `server/tsconfig.json`; verify `npx tsc -p server --noEmit` runs clean on an empty `server/src/app.ts`
- [x] 1.3 Add a `compose.yml` with a `postgres:16` service (named volume, healthcheck) and a `.env.example` documenting `DATABASE_URL` and `TEST_DATABASE_URL`; verify `docker compose up -d postgres` becomes healthy and `psql "$DATABASE_URL" -c 'select 1'` works

## 2. Postgres data layer

- [x] 2.1 Add `postgres` and `node-pg-migrate` to `server`, and write `migrations/001_init.sql` covering accounts (`citext` email), sessions, api_keys, usage, upgrade_requests, barcode_cache (`jsonb`), meta, `rate_windows` and `login_failures`, with FKs and indexes per design §3–4; verify `npm run migrate` applies on an empty database and `npm run migrate -- down` reverts it
- [x] 2.2 Add a test helper that creates a throwaway `nutrikit_test_<random>` database from `TEST_DATABASE_URL`, migrates it and drops it after the run; verify a smoke test inserts and reads an account row
- [x] 2.3 Port `accounts` (create, login, sessions, plans, upgrade requests) to async Postgres queries taking an injected `sql`; verify the account and session cases in `portal.test` pass against Postgres
- [x] 2.4 Port `auth` (keys, access tokens, token secret in `meta`, allowance, charge, usage summary and series) to async Postgres; verify the key, access-token, quota and usage cases in `api.test` pass
- [x] 2.5 Replace the in-memory rate limiter and login throttle with the `rate_windows` and `login_failures` queries (design §4); verify new tests: `429 rate_limited` with `Retry-After` after N calls in one window, `429 too_many_attempts` after 5 failed logins, and both survive a fresh app instance on the same database
- [x] 2.6 Port the `barcode` cache and `billing.applyEvent`/`setPlan` to async Postgres; verify `billing.test` and the barcode cache cases pass
- [x] 2.7 Write `scripts/migrate-sqlite-to-postgres` that copies an existing `app.db` into Postgres in FK order and prints per-table row counts; document it in the README; verify on a copy of `data/app.db` that the source and target counts match and an existing API key still authenticates

## 3. Fastify server

- [x] 3.1 Add `fastify`, `@sinclair/typebox`, `@fastify/cookie`, `@fastify/cors`, `@fastify/helmet`, `@fastify/static` and `@fastify/swagger`, and create `buildApp(opts)` with a `db` plugin (Postgres `sql` + read-only `foods.db`) and `main.ts`; verify `GET /v1/health` and `GET /v1/nutrients` return the same JSON as the old server
- [x] 3.2 Implement the `errors` plugin (HttpError, validation → `400 invalid_request`, 404 `not_found`, 405 `method_not_allowed`, 500 masking, `Retry-After`, `fields`); verify contract tests for each error shape match the old server's output exactly
- [x] 3.3 Implement the `auth` + `metering` hooks driven by `config.cost` (authenticate, rate limit, allowance pre-check, charge, `X-Tokens-*` headers, dynamic `costKey`/AI usage); verify the token-header and quota cases in `api.test` pass
- [x] 3.4 Move the domain modules (`search`, `textlog`, `units`, `nutrients`, `label`, `mealplan`, `barcode`, `providers/`) to `server/src/domain/*.ts` without logic changes; verify `core.test` passes unchanged in behaviour
- [x] 3.5 Port the `/v1` routes (foods, nutrients, log text/voice/photo, barcodes, labels, meal plans, usage, auth/token) with TypeBox schemas, and register CORS only on `/v1`; verify all of `api.test` and `sdk.test` pass against `buildApp()`
- [x] 3.6 Port the admin routes (`/v1/admin/*`, admin bearer check) and the Stripe webhook with a raw-body parser; verify the admin cases and the webhook signature tests in `billing.test` pass
- [x] 3.7 Implement the `portal-session` plugin (cookie, CSRF header, `request.account`) and port the `/portal/api/*` routes, with no CORS headers on `/portal`; verify all of `portal.test` passes
- [x] 3.8 Generate OpenAPI 3.1 with `@fastify/swagger`, serve `GET /openapi.json`, add `npm run openapi` to write `docs/openapi.json`, and delete `scripts/gen-openapi.mjs`; verify a new test that every registered `/v1` route appears in the spec, and diff against the old `docs/openapi.json` for unintended contract changes
- [x] 3.9 Temporarily serve the existing vanilla `web/` pages and `/sdk/*` through `@fastify/static` at the same URLs and headers; verify all 40 original test cases pass on Fastify + Postgres, then delete `src/server.mjs` and `src/db.mjs`
- [x] 3.10 Update the README (requirements, env vars including `DATABASE_URL`, `npm run dev`/`migrate`/`test`) for the new server; verify a fresh clone following the README reaches a working `GET /v1/health`

## 4. React frontend

- [x] 4.1 Scaffold `web/` with Vite + React + TypeScript, React Router and TanStack Query, and configure the dev proxy (`/v1`, `/portal`, `/webhooks`, `/openapi.json`, `/sdk` → `:8787`); verify `npm run dev -w web` serves a page and a proxied `GET /v1/health` succeeds
- [x] 4.2 Build the shared layout and carry over `site.css`, plus a typed API client (`credentials: 'same-origin'`, `X-Nutrikit-Portal` on mutations, error-JSON parsing); verify with Vitest unit tests for the client's header and error handling
- [x] 4.3 Port the Home and Pricing pages (pricing read from `/portal/api/me` plans or a shared constant); verify visually against the old pages and with a Vitest render test
- [x] 4.4 Port Docs and replace `reference.js` with Scalar rendering `/openapi.json` at `/docs/reference`; verify every `/v1` endpoint appears on the reference page
- [x] 4.5 Port Signup and Login with React Hook Form, showing server `fields` errors and the one-time first key; verify Vitest tests for validation and the field-error mapping
- [x] 4.6 Port the Dashboard (account, plan, keys create/revoke with the one-time key reveal, 30-day usage chart with Recharts, per-endpoint table, upgrade request and Stripe checkout); verify manually against a local Postgres plus a Vitest test for key creation
- [x] 4.7 Port the Playground using `sdk/js/nutrikit.mjs` with a playground token; verify each endpoint can be called from the UI and shows the token headers
- [x] 4.8 Serve `web/dist` from Fastify with an SPA fallback (excluding API prefixes and non-HTML `Accept`), cache headers and helmet headers, then delete the old `web/*.html/js/css`; verify tests that `/dashboard` returns `index.html`, `/v1/nope` returns JSON 404, and HTML responses carry `X-Frame-Options: DENY`

## 5. Docker and deployment

- [x] 5.1 Write the multi-stage `docker/Dockerfile` (deps → build web+server → runtime `node:22-slim`, non-root, `foods.db` baked in from a prebuilt file, `HEALTHCHECK /v1/health`) and a `.dockerignore` excluding `data/raw` and `node_modules`; verify `docker build` succeeds and the image is under 300 MB
- [x] 5.2 Add the `app` service to `compose.yml` (depends on a healthy Postgres, runs `migrate` then starts); verify `docker compose up` serves the SPA and API on `localhost:8787`
- [x] 5.3 Document deployment in the README: env vars (required `NUTRIKIT_TOKEN_SECRET`, `DATABASE_URL`, Stripe), the migrate-then-start order, the optional SQLite→Postgres copy, and rollback; verify by following the doc against the local compose stack

## 6. Integration checks

- [x] 6.1 Add a Playwright smoke test against the compose stack: signup → dashboard → create key → playground food search shows results and `X-Tokens-Charged`; verify it passes headlessly via `npx playwright test`
- [x] 6.2 Run two app containers against one Postgres and confirm the rate limit and login throttle are shared across them; verify with a scripted burst that the combined requests hit `429` at the plan limit
- [x] 6.3 Run the full suite (`npm test` at the root: server contract tests, web Vitest, Playwright) green from a clean clone with only Docker and Node installed

## Workflow follow-up

- Archive the change with `/opsx:archive` once implementation is reviewed and deployed.
- Follow-up changes: transactional email (verification and password reset), Stripe subscription state and customer portal, and real plan pricing.
