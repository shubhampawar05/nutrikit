# Design

## Context

See proposal.md (Why) for motivation. Constraints that shape the approach:

- `src/server.mjs` (489 lines) owns routing, body parsing, CORS, auth, metering, the portal
  session/CSRF layer, static files and error shaping. Feature modules (`search`, `textlog`,
  `mealplan`, `label`, `units`, `nutrients`, `providers/`) are pure or read only `foods.db` and can
  move unchanged.
- About 25 call sites use the synchronous `node:sqlite` handle `app()` (`accounts`, `auth`,
  `billing`, `barcode`). A Postgres client is asynchronous, so these functions and their callers
  become `async`.
- Tests (`node:test`, 40 cases) start the exported `server` on port 0, call it over HTTP, and some
  import `app()` and `createKey()` directly. They are the behaviour contract for this change.
- The portal relies on a same-origin `SameSite=Lax` cookie plus the `X-Nutrikit-Portal` header,
  and sends no CORS headers. The frontend must stay on the same origin as the API.
- Node 22.13+ is required (`node:sqlite` with FTS5); the dev machine runs Node 26.

## Goals / Non-Goals

**Goals:**
- One deployable Docker image that serves the API, portal API, webhook and SPA on one port.
- Byte-compatible API behaviour: paths, status codes, error JSON (`{ error: { code, message, fields? } }`),
  `X-Tokens-Charged` / `X-Tokens-Remaining` / `Retry-After` headers, CORS on `/v1`, none on `/portal`.
- Route schemas are the single source of truth for validation and `openapi.json`.
- Stateless app instances: no correctness-relevant state in process memory.

**Non-Goals:**
- Changing endpoint shapes, token costs, plans or SDK API.
- Moving `foods.db` into Postgres (it is read-only, rebuilt from USDA CSVs, and its FTS5 search is tuned).
- Server-side rendering or SEO for the web pages.
- Email, password reset and billing-state fixes (separate changes).

## Decisions

### 1. Repository layout: npm workspaces

```
nutrition-platform/
  package.json          workspace root: scripts, devDeps (openspec, typescript, eslint)
  server/               Fastify app (TypeScript)
    src/app.ts          buildApp(opts) -> FastifyInstance (no listen; used by tests)
    src/main.ts         reads env, buildApp, listen
    src/plugins/        db, auth, metering, portal-session, errors, static
    src/routes/         v1/*.ts, portal/*.ts, admin.ts, webhooks.ts
    src/domain/         existing feature modules moved from src/*.mjs
    migrations/         SQL migrations
    data/foods.db       read-only catalog (built by scripts/build-db)
  web/                  Vite + React SPA (TypeScript)
  sdk/js/               unchanged
  docker/Dockerfile, compose.yml
```

Why: one install, shared TypeScript config, the SPA and server versioned together, and the
web build output lands where the server can serve it. Alternative: separate repos, rejected as
overhead for a single small team.

### 2. Server: Fastify 5 with TypeBox schemas

- Each route declares `schema: { querystring, params, body, response }` with `@sinclair/typebox`,
  which gives both runtime validation (Ajv, built into Fastify) and static TS types.
- `@fastify/swagger` builds OpenAPI 3.1 from the route schemas; `GET /openapi.json` serves it and
  `npm run openapi` writes `docs/openapi.json` for the SDK and repo. `scripts/gen-openapi.mjs` is deleted.
- Cross-cutting behaviour becomes hooks/plugins, mirroring today's dispatch order:
  - `errors` plugin: `setErrorHandler` maps `HttpError`, Fastify validation errors and unknown errors
    to the existing error JSON and `Retry-After`. Validation errors map to `400 invalid_request`.
  - `auth` + `metering`: a route option `config: { cost: 'search' }` drives a `preHandler` that
    authenticates, rate limits and checks the allowance, and an `onSend` hook that charges usage and
    sets token headers. Routes that bill dynamically (labels, AI usage) return `{ costKey, usage, body }`
    as today.
  - `portal-session`: `@fastify/cookie`, CSRF header check for non-GET, session lookup into
    `request.account`.
  - `@fastify/cors` registered only on the `/v1` prefix.
  - The Stripe webhook route uses a raw-body content-type parser so signature verification keeps working.
- Why Fastify over Express/Hono/NestJS: schema-first validation and OpenAPI built in, plugin
  encapsulation fits the v1/portal/admin split, and the handler style is close to today's code.
- Language: TypeScript compiled with `tsc` to `dist/`; development runs `tsx watch`. Domain
  modules are renamed to `.ts` with minimal type annotations; logic is not rewritten.

### 3. Data: PostgreSQL for app state, SQLite for the catalog

- Driver: `postgres` (porsager) with tagged-template queries. It is small, typed and parameterised by
  default. Alternatives: `pg` (more boilerplate), an ORM such as Prisma or Drizzle (an extra
  abstraction for about 15 queries; can be added later).
- Migrations: plain SQL files in `server/migrations/` applied by `node-pg-migrate`, run by an
  explicit `npm run migrate` step at deploy (not on boot), so multiple instances never race.
- Schema mirrors today's tables with Postgres types: `timestamptz` for times, `citext` for
  `accounts.email`, `bigserial` ids, `jsonb` for `barcode_cache.payload`, foreign keys from `sessions`,
  `api_keys`, `usage` and `upgrade_requests` to `accounts`. Index `usage(account_id, at)` and `usage(key_id, at)`.
- `foods.db` is opened read-only with `node:sqlite` as now and baked into the image.
- Domain functions that touch app data become `async` and receive the `sql` handle through the
  Fastify `db` plugin (`fastify.sql`). There is no module-level singleton, so tests can point at a
  per-run database.

### 4. Rate limiting and login throttling in Postgres

- Per-minute rate limit: one row per bucket in
  `rate_windows(bucket text primary key, window_start timestamptz, count int)`, updated with a single
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. The window opens at the bucket's first request and
  lasts one minute (so a burst never straddles a clock-minute boundary); `Retry-After` is the seconds
  left in it. Buckets are `key:<account or key id>` for the API and `demo:<ip>` for the homepage demo,
  which was also an in-memory limiter. This is a small behaviour difference from today's sliding window
  and is acceptable within the 429 contract.
- Failed logins: a `login_failures(email, at)` table; count the rows in the last 15 minutes and delete
  them on success. Old rows are pruned by the same query path.
- Alternative: Redis with `@fastify/rate-limit`. Rejected for now so we run one fewer service; we can
  switch if the request volume needs it.

### 5. Frontend: React + Vite SPA served by Fastify

- Stack: Vite, React 19, TypeScript, React Router (data routers), TanStack Query for API calls,
  React Hook Form for auth forms, Recharts for the usage chart, Scalar's React component for
  `/docs/reference`. Styling starts from the existing `site.css`; adopting Tailwind is optional later.
- Routes keep today's URLs: `/`, `/pricing`, `/docs`, `/docs/reference`, `/signup`, `/login`,
  `/dashboard`, `/playground`.
- A small typed API client in `web/src/api/` wraps `fetch`, always sends `X-Nutrikit-Portal: 1` on
  portal mutations and uses `credentials: 'same-origin'`. The playground calls `/v1` through the
  existing JS SDK (`sdk/js/nutrikit.mjs`) so the SDK is exercised by the product itself.
- Production: `vite build` → `web/dist`, served by `@fastify/static` with long cache headers on
  hashed assets and `no-cache` on `index.html`. A `setNotFoundHandler` returns `index.html` for GET
  requests that accept HTML and are not under `/v1`, `/portal`, `/webhooks`, `/openapi.json` or `/sdk`,
  so client-side routes work. API paths keep returning JSON 404s.
- Development: the Vite dev server proxies `/v1`, `/portal`, `/webhooks`, `/openapi.json` and `/sdk`
  to Fastify on 8787, so cookies stay same-origin through the proxy.
- Security headers (`X-Frame-Options: DENY`, `nosniff`, referrer policy) are set by `@fastify/helmet`
  on HTML responses, matching today.
- Alternatives: Astro (only needed for SEO, which is a non-goal) and Next.js (a second server that
  competes with Fastify).

### 6. Docker and hosting

- Multi-stage `Dockerfile`: (1) `npm ci` for the workspaces; (2) build the web and server; (3) build
  `foods.db` from the USDA CSVs, or copy a prebuilt file supplied as a build context or release
  artifact; (4) runtime `node:22-slim` (or later LTS) with `npm ci --omit=dev`, `dist/`, `web/dist`
  and `foods.db`, running as a non-root user, `EXPOSE 8787`, `HEALTHCHECK` on `/v1/health`.
- `compose.yml` for local development: `postgres:16` with a named volume, plus the `app` service
  built from the Dockerfile with `DATABASE_URL`.
- Hosting target: any container host with managed Postgres (Fly.io, Render or Railway). The image is
  host-agnostic and configured only through env vars; `NUTRIKIT_TOKEN_SECRET` becomes required in
  production.

### 7. Testing strategy

- Keep the 40 tests as the contract and port them to `buildApp()` plus `app.listen({ port: 0 })`, so
  they still go over real HTTP. Direct `app()` / `createKey()` imports go through the injected `sql`.
- Each test run creates a throwaway database (`nutrikit_test_<random>`) from `TEST_DATABASE_URL`,
  runs migrations, and drops it afterwards. `compose.yml` provides the Postgres for local runs.
- Add a test that the generated `openapi.json` covers every registered `/v1` route.
- Frontend: Vitest + Testing Library for the API client and auth forms; one Playwright smoke test
  (signup → dashboard → create key → playground search) against the Docker image.

## Risks / Trade-offs

- [Sync → async ripple across accounts/auth/billing] → convert module by module behind the
  unchanged HTTP tests; no handler logic changes in the same commit as the async conversion.
- [Subtle API drift: Fastify's default error shapes, `HEAD` handling, trailing slashes, 404/405] →
  a custom error handler and not-found handler; port the existing 405 behaviour explicitly; contract
  tests assert the exact error JSON.
- [Schema validation stricter than today's hand checks (types, additional properties)] → schemas
  allow additional properties on request bodies by default; tighten later deliberately.
- [Fixed-window rate limit allows bursts of up to 2× at window edges] → acceptable for this tier;
  documented; can move to a sliding window or Redis later.
- [foods.db build needs the USDA CSVs (large) inside Docker] → support copying a prebuilt `foods.db`
  into the image and keep `data/raw/` out of the build context by default.
- [SPA fallback could mask API 404s] → the fallback excludes API prefixes and non-HTML `Accept` headers.
- [Data migration from existing `app.db`] → a one-off `scripts/migrate-sqlite-to-postgres` copies
  rows in dependency order and verifies counts. Password and key hashes copy as-is.

## Migration Plan

1. Land the server on Fastify + Postgres with the existing vanilla `web/` still served statically;
   all 40 tests green against Postgres.
2. Land the React SPA, replacing `web/`, at the same URLs.
3. Add Docker and compose; verify the image locally (migrations, health check, Playwright smoke).
4. Deploy: provision Postgres → `npm run migrate` → (optional) run the SQLite→Postgres copy for
   existing data → start the container → point DNS.
5. Rollback: the previous release (the `node src/server.mjs` + SQLite build) stays runnable from git;
   because step 4 copies data rather than moving it, `app.db` remains the rollback source until the
   new deployment is accepted.

## Open Questions

- Which container host to use first (Fly.io, Render or Railway). The image and env contract are the
  same for all three, so this can be decided at deploy time.
- Whether to keep `site.css` or adopt Tailwind for the SPA. Either fits the task breakdown.

## Implementation notes (group 3)

Choices made while building the server that refine the decisions above:

- **Schemas** use `typebox` 1.x through `@fastify/type-provider-typebox` 6 (the maintained successor of
  `@sinclair/typebox`). Shared response shapes are registered with `addSchema` and referenced as `Name#`.
- **Serialization** is plain `JSON.stringify` (`setSerializerCompiler`), so response schemas only document
  the API and can never strip fields from a response.
- **CORS, cookies and security headers** are set by small hooks instead of `@fastify/cors`, `@fastify/cookie`
  and `@fastify/helmet`, because those plugins would change the exact headers clients see today (for example
  CORS on every non-portal path, including errors and unknown paths, and no CSP on the vanilla pages).
  `@fastify/helmet` can come back with the React app (task 4.8), when the pages change anyway.
- **Metering** is an `onRoute` hook: routes with `config.cost` get an `onRequest` guard (authenticate,
  rate limit, allowance pre-check, before the body is read) and a handler wrapper that charges after
  success. This keeps the old order: 401/429 come before validation errors, and failed calls are never charged.
- **Bodies** go through one content-type parser that keeps raw `image/*` bytes and parses anything else as
  a JSON object regardless of its `Content-Type`, as the old server did. The Stripe webhook scope reads raw bytes.
- **Validation**: Ajv coerces scalars but never wraps a scalar into an array. Failures are `400 invalid_request`
  with messages formatted as `` `field` is required `` / `` `limit` must be <= 50 ``. The photo, label and barcode
  routes document their schemas but validate in the handler (raw image bodies; the `invalid_barcode` code).
- **404/405**: `/v1` paths that exist with another method answer `405 method_not_allowed`; admin, portal and
  everything else answer `404 not_found`, as before.
- **Contract check**: 68 requests were replayed against the old server (SQLite) and the new one (Postgres).
  Statuses, error codes and contract headers match; the remaining differences are validation-message
  wording and the random seed of an unseeded meal plan.
- **TypeScript** runs through `tsx` for development, tests and scripts; `npm run build` compiles to `dist/`
  with `.ts` import specifiers rewritten to `.js`. `noUncheckedIndexedAccess` was dropped from the base config.

## Implementation notes (group 4)

- **Pages** keep their URLs and the legacy stylesheet (`web/src/styles/site.css`, unchanged), so the site looks
  the same; scripts that manipulated the DOM became React state. The API reference is Scalar, reading the
  live `/openapi.json`. The playground calls the API through the JS SDK (`@nutrikit/sdk` workspace package).
- **Bundles**: every page is a lazy route. Scalar is large (~500 kB gzipped) but loads only on `/docs/reference`;
  recharts loads only with the dashboard.
- **Serving**: `@fastify/static` registers one route per built file at startup (`wildcard: false`), with
  immutable caching for fingerprinted `assets/` and `no-cache` elsewhere. The not-found handler answers
  browser navigations (GET/HEAD, `Accept: text/html`, not an API prefix, no file extension) with `index.html`;
  everything else keeps the JSON 404/405. The server must be restarted after a web rebuild.
- **Headers**: HTML responses keep `X-Frame-Options: DENY`, `nosniff` and the referrer policy. `@fastify/helmet`
  is still not used: a CSP would have to allow the Google Fonts stylesheet and Scalar's runtime, which is a
  change of its own.
- **Anchors**: lazy pages render after the browser's own `#section` jump, and the router restores positions
  saved under the shared `default` key of fresh loads. The layout jumps to the section once it exists (timer
  polling, smooth scrolling paused) and fresh loads with a hash skip scroll restoration.

## Implementation notes (group 5)

- **Base images**: the build stage is `node:24-slim` (Vite and esbuild ship glibc binaries); the runtime is
  `node:24-alpine` (Node 24 is the active LTS; the server has no native modules and `node:sqlite` is built in).
  The image is ~75 MB compressed / ~250 MB unpacked.
- **Production dependencies**: `npm ci --omit=dev --workspace server` still installs the workspace's
  devDependencies (TypeScript, tsx, esbuild), so the deps stage narrows the root `workspaces` to `server` and
  runs `npm install --omit=dev` against the same lockfile (versions verified identical).
- **CLIs**: `migrate` and `create-key` moved from `scripts/*.mjs` to `src/cli/*.ts`, so they compile into the
  image (`node dist/cli/migrate.js`). The one-off SQLite copy stays a repository script.
- **Secrets**: with `NODE_ENV=production` (set in the image) the server refuses to start without
  `NUTRIKIT_TOKEN_SECRET`. Source maps are left out of the image.
- **Compose** keeps `postgres` usable on its own for development and adds an `app` service that runs
  `migrate` then the server; its token secret defaults to a clearly local-only value.

## Implementation notes (group 6)

- **Playwright** lives in an `e2e/` workspace and installs Chromium into `node_modules`
  (`PLAYWRIGHT_BROWSERS_PATH=0`), so nothing is installed outside the project. `npm test` at the root starts
  the compose Postgres, runs the unit suites, builds and starts the app image, and runs the smoke test.
  The very first run on a new machine timed out once on the sign-up click (right after the browser download);
  it did not recur in 11 further runs, including runs straight after an app restart.
- **Multi-instance check** (`npm run multi-instance -w e2e`): two containers on one fresh database. A burst of
  40 requests alternating between them got exactly 30 × 200 (the Free plan's per-minute limit) and then 429 with
  `Retry-After`; five failed logins split across them blocked the correct password on the other (429
  `too_many_attempts`, `Retry-After: 900`); a session created on one was valid on the other.
- **Clean clone**: a copy without `node_modules`, builds, `.env` or data artifacts ran `npm ci && npm test`
  green in about 80 s, with its own compose project and volume.
