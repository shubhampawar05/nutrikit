# Proposal

## Why

Nutrikit runs on a hand-written `node:http` router with hand-written validation, an OpenAPI file
maintained separately from the routes, application data in a local SQLite file, and vanilla
HTML/JS pages. That works on one laptop, but it cannot be hosted reliably: the SQLite app database
ties the server to one disk and one instance, rate limits live in process memory, and the growing
portal and playground pages (`portal.js`, `playground.js`) are hard to maintain without a UI
framework. We want a conventional, hostable stack before adding more features (email, billing fixes).

## What Changes

- Replace the hand-written HTTP server with **Fastify** (Node.js, TypeScript). Every route declares
  JSON schemas, which drive request validation and generate `openapi.json` automatically, replacing
  `scripts/gen-openapi.mjs`.
- Move the writable application store (accounts, sessions, API keys, usage, upgrade requests,
  barcode cache, meta) from `data/app.db` (SQLite) to **PostgreSQL**, with versioned migrations.
  The read-only food catalog `data/foods.db` stays SQLite and ships inside the image.
- Move per-minute rate limiting and failed-login throttling out of process memory into Postgres,
  so more than one instance can run.
- Replace the vanilla `web/` pages with a single **React + Vite + TypeScript** single-page app
  (home, pricing, docs, API reference, signup/login, dashboard, playground), built to static files
  and served by Fastify from the same origin.
- Package the app with **Docker** (multi-stage build) and add a `compose.yml` for local development
  with Postgres.
- Add a one-off script that copies existing data from `data/app.db` into Postgres.
- All new tooling is added as project dependencies or devDependencies; nothing is installed globally.

The public `/v1` API, the `/portal/api` contract, the Stripe webhook, the JS SDK, token costs,
error shapes and response headers stay the same. URLs of the web pages stay the same.

## Capabilities

### New Capabilities

None. This is a re-platforming: externally observable behaviour of the API, portal and pages is
preserved, so no spec-level requirements change. The change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- **Code**: `src/server.mjs` is split into Fastify route plugins; every module that calls `app()`
  (accounts, auth, billing, barcode cache) becomes async against Postgres; `src/db.mjs` is split
  into a Postgres pool and the read-only foods handle.
- **Frontend**: `web/` is replaced by a Vite project; `reference.js` is replaced by a generated
  reference page from the served `openapi.json`.
- **Dependencies**: adds `fastify` and plugins, `pg` (or `postgres`), a migration tool,
  `typescript`, `vite`, `react`, `react-router`, `@tanstack/react-query`. Node ≥ 22.13 stays.
- **Operations**: requires a PostgreSQL 16+ database (`DATABASE_URL`). Deployment becomes a Docker
  image on a container host (Fly.io, Render or Railway) with managed Postgres.
- **Tests**: the existing 40 `node:test` tests remain the behaviour contract and run against a
  Postgres test database.
- **Out of scope**: email verification, password reset, Stripe subscription-state fixes, and plan
  pricing. Those are separate changes after this one.
