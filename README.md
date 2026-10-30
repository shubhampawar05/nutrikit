# Nutrikit

A self-hostable nutrition platform: a REST API plus a JavaScript SDK for food search, nutrient
breakdowns, meal logging from text, voice and photos, barcode and nutrition-label scanning, meal
plans, and API keys with token-metered usage. It runs on open data and has no runtime dependencies
apart from an optional AI provider.

This is a clean-room build. [CLEAN-ROOM.md](CLEAN-ROOM.md) records what it was and wasn't derived from.

## Quick start

```bash
npm install
cp .env.example .env               # DATABASE_URL / TEST_DATABASE_URL for the local Postgres below
docker compose up -d postgres      # PostgreSQL 16 on localhost:5433
npm run migrate                    # creates the application tables
npm run build:db                   # builds server/data/foods.db from the USDA CSVs in server/data/raw (about 3 s)
npm run create-key -- "my app"
npm run dev                        # API on http://localhost:8787 (restarts on change)
npm run dev:web                    # in a second terminal: the web app on http://localhost:5173 (hot reload)
```

During development, open http://localhost:5173: Vite serves the React app and forwards `/v1`, `/portal`,
`/webhooks`, `/openapi.json` and `/sdk` to the API, so the portal's session cookie stays same-origin.

For production, use the Docker image (see *Deployment*), or `npm run build`, which builds the web app to `web/dist/` and compiles the server to `server/dist/`;
`npm start` then serves the site, docs, portal and API from one process on port 8787. Restart the server
after rebuilding the web app (it registers the built files at startup).

Accounts, sessions, API keys, usage, rate limits and the barcode cache live in PostgreSQL
(`DATABASE_URL`). The food catalog stays a read-only SQLite file, `server/data/foods.db`.

**Moving from the SQLite app store.** Earlier versions kept application data in `server/data/app.db`.
To carry it over, point `DATABASE_URL` at an empty database and run
`npm run migrate:sqlite -- server/data/app.db`. It applies the migrations, copies every table in one
transaction (password and key hashes, and the access-token secret, are copied as they are), and prints
source and target row counts. It refuses to copy into tables that already have rows, and never
modifies the SQLite file.

### Repository layout

| Path | What |
|---|---|
| `server/src/` | Fastify server in TypeScript: `app.ts` (buildApp), `main.ts`, `routes/` (v1, admin, portal, webhooks, static pages), `plugins/` (errors, metering), `domain/` (search, logging, labels, barcodes, meal plans, accounts, keys, billing) |
| `server/` | also `migrations/` (SQL), `scripts/`, `test/`, `data/` (food catalog) and `docs/openapi.json` |
| `web/` | the website, docs, developer portal and playground: a React + Vite + TypeScript single-page app (`src/pages/`, `src/components/`, `src/api/client.ts`); Fastify serves its build from `web/dist/` |
| `sdk/js/` | JavaScript SDK |
| `openspec/` | change proposals and designs ([OpenSpec](https://github.com/Fission-AI/OpenSpec)) |
| `compose.yml` | local PostgreSQL (`docker compose up -d postgres`; see `.env.example`), and the app image (`docker compose up -d --build`) |
| `docker/Dockerfile` | the production image (see *Deployment*) |
| `e2e/` | Playwright smoke test and the multi-instance check |

The root is an npm workspace: run every command above from the root.

Requires Node ≥ 22.13 (it uses the built-in `node:sqlite` with FTS5) and PostgreSQL 16+ (Docker is enough for development). To fetch the USDA source data
yourself, download these three releases from <https://fdc.nal.usda.gov/download-datasets/> and
unzip them into `server/data/raw/`: `FoodData_Central_sr_legacy_food_csv_2018-04`,
`FoodData_Central_survey_food_csv_2024-10-31` and `FoodData_Central_foundation_food_csv_2026-04-30`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | – | PostgreSQL connection string for the application store (required) |
| `TEST_DATABASE_URL` | local compose | Server where `npm test` creates and drops a throwaway database per test file |
| `PORT` | `8787` | HTTP port |
| `ANTHROPIC_API_KEY` | – | Enables the Claude provider: photo logging, label photos, `ai: true` text parsing |
| `NUTRIKIT_AI_PROVIDER` | auto | `anthropic` or `none` |
| `NUTRIKIT_ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used by the provider |
| `NUTRIKIT_ANTHROPIC_EFFORT` | `medium` | `low` … `max` |
| `NUTRIKIT_ADMIN_TOKEN` | – | Bearer token for `/v1/admin/keys` |
| `NUTRIKIT_AUTH` | on | `off` disables API keys, for local development only |
| `NUTRIKIT_RATE_LIMIT` | `120` | Requests per minute per key |
| `NUTRIKIT_OFFLINE` | – | `1` serves barcodes from the cache only |
| `NUTRIKIT_TOKEN_SECRET` | generated | HMAC secret for access tokens (otherwise generated once and stored in Postgres) |
| `NUTRIKIT_SECURE_COOKIES` | – | `1` adds `Secure` to session cookies (use behind HTTPS) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | – | Enable paid self-serve upgrades. `rzp_test_…` keys for test mode, `rzp_live_…` for real payments |
| `RAZORPAY_WEBHOOK_SECRET` | – | Signing secret of the `order.paid` webhook pointed at `POST /webhooks/razorpay` (backup for lost browser confirmations) |
| `NUTRIKIT_WEB_DIST` | `web/dist` | Built web app to serve; without one the server is API-only |

### Payments (Razorpay)

With `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` set, developers buy Starter or Growth from the dashboard with a
**one-time payment** through Razorpay Checkout (cards, UPI and the other methods your account allows), in INR.
Each payment unlocks the plan for **30 days**. Paying again extends the same plan by 30 days, or moves up to Growth
(a fresh 30 days); a cheaper plan can be bought once the current period ends. There is no automatic renewal: when the
period ends the account is treated as Free everywhere, with no admin action and no scheduled job. Enterprise and
servers without Razorpay keys still use upgrade requests, and plans set through the admin API never expire.

When Checkout succeeds, the browser hands the server Razorpay's signed payment response; the server verifies the
signature, checks that the order belongs to that account, and applies the payment straight away. Every payment is
recorded in the `payments` table and applied once.

To try it in **test mode** (no real money):

1. Sign up at https://dashboard.razorpay.com, switch to **Test Mode**, open *Account & Settings → API Keys* and
   generate a test key.
2. Put both values in `.env`: `RAZORPAY_KEY_ID=rzp_test_…` and `RAZORPAY_KEY_SECRET=…`, then restart the API.
3. On the dashboard choose Starter or Growth and pay with one of Razorpay's
   [test cards or UPI ids](https://razorpay.com/docs/payments/payments/test-card-details/). The plan and its
   paid-until date appear as soon as Checkout closes. No webhook or tunnel is needed for this.

**Webhook (production).** In the Razorpay dashboard add a webhook at `https://<your domain>/webhooks/razorpay` for the
`order.paid` event and put its secret in `RAZORPAY_WEBHOOK_SECRET`. It applies payments whose browser confirmation
never arrived (a closed tab, a lost connection); a payment already applied is ignored. Without the secret the
endpoint answers 501.

## Developer platform

The server also hosts everything other developers need to use your API on their own:

| Page | What it is |
|---|---|
| `/` | Marketing homepage |
| `/pricing` | Plans and the per-call token costs. The plans are placeholders: edit `PLANS` in `server/src/domain/accounts.ts` and this page together |
| `/docs` | Guides: quick start, authentication, access tokens, every feature, the SDK, errors, and limits |
| `/docs/reference` | API reference, rendered live from `/openapi.json`, which the server generates from its route schemas |
| `/signup`, `/login` | Self-serve accounts. A new account starts on the Free plan, and its first API key is shown once |
| `/dashboard` | Create and revoke keys, see usage (30-day chart, per-endpoint breakdown, remaining allowance), request an upgrade |
| `/playground` | Try every endpoint in the browser with a key or access token |

**How a developer authenticates**
- The secret key (`nk_…`) stays on the developer's server.
- Their server calls `POST /v1/auth/token` to get a 1-hour access token (`nkat_…`), which is what their web and mobile apps use.
- An access token cannot mint new tokens, and revoking the key also invalidates its tokens.
- In the SDK: `nk.createAccessToken()`.

**Plans and allowances.** A plan sets the monthly token allowance, the requests-per-minute limit, and the maximum number of keys. Every key on an account shares the plan's allowance.

**Admin console.** Open `/admin` (not linked from the site) and sign in with `NUTRIKIT_ADMIN_TOKEN`. The token is
kept in that browser tab only and forgotten on *Sign out* or when the tab closes. Tabs:

| Tab | What you can do |
|---|---|
| Overview | Accounts per plan, active paid periods, revenue (all time and last 30 days), active keys, tokens this month |
| Payments | Every Razorpay payment with the account's email, plan, amount, paid-until date and payment/order ids; search by email |
| Accounts | Plan, paid-until, keys, usage and total paid per account; search; **change an account's plan** (operator plans never expire) |
| Keys | Every API key with its owner's email; search; **revoke** a key (its access tokens stop working too) |
| Requests | Upgrade requests (Enterprise, or any plan while online payment is off) |

The same data is available from the admin API: `GET /v1/admin/overview`, `/v1/admin/accounts?q=`,
`/v1/admin/payments?q=`, `/v1/admin/keys?q=`.

**Your operator tasks from the command line** (with `Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN`):

```bash
curl localhost:8787/v1/admin/upgrade-requests -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN"
curl -X POST localhost:8787/v1/admin/accounts/acct_…/plan -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"plan": "starter"}'
```

**Security already in place**
- Passwords are hashed with scrypt; session ids and API keys are stored only as SHA-256 hashes.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Portal requests that change data must send the `X-Nutrikit-Portal` header (CSRF protection), and the portal accepts no cross-origin requests.
- Failed logins are throttled to 5 per 15 minutes per email, shared by every server instance (stored in Postgres).
- Pages are sent with `X-Frame-Options: DENY`.

**Before a public launch**, also:
- serve over HTTPS and set `NUTRIKIT_SECURE_COOKIES=1`;
- set a fixed `NUTRIKIT_TOKEN_SECRET`, so access tokens survive a database reset (the Docker image refuses to start without one);
- replace the placeholder plans and prices;
- switch Razorpay to your live keys and set up its webhook (see *Payments*);
- add what isn't built yet: email verification, password reset, auto-renewing subscriptions (paid plans are bought 30 days at a time today), invoices/GST, so customers can change or cancel plans themselves.

## Deployment

Nutrikit ships as one Docker image (`docker/Dockerfile`): the API, the developer portal and the web app on
port 8787, with the food catalog inside. It needs a PostgreSQL 16+ database. Any host that runs a container
next to a managed Postgres works (Fly.io, Render, Railway, a VM); nothing in the image is host-specific.

**Try the image locally.** `docker compose up -d --build` builds it and starts it next to the compose
Postgres on http://localhost:8787 (it applies migrations first). Stop the stack with `docker compose down`;
add `-v` to also delete the database volume.

**Build.** The catalog `server/data/foods.db` must exist before building (it is checked in; rebuild it
with `npm run build:db` when the USDA data changes).

```bash
docker build -f docker/Dockerfile -t nutrikit .
```

The image runs as the unprivileged `node` user, has a `HEALTHCHECK` on `/v1/health`, and is about 75 MB
compressed (250 MB unpacked, on `node:24-alpine`).

**Environment.** Set at least:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | The production database, e.g. `postgres://user:pass@host:5432/nutrikit?sslmode=require` |
| `NUTRIKIT_TOKEN_SECRET` | Required (`NODE_ENV=production` is set in the image). Generate once with `openssl rand -hex 32`, keep it stable across deploys and identical on every instance |
| `NUTRIKIT_SECURE_COOKIES` | `1` once the site is served over HTTPS |
| `NUTRIKIT_ADMIN_TOKEN` | For `/v1/admin/*`; leave unset to disable the admin API |
| `ANTHROPIC_API_KEY` | Optional: photo logging, label photos and `ai: true` parsing |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Optional: paid upgrades (see *Payments*) |

**Release order: migrate, then start.** Run the migrations once per release, before new instances take
traffic, and never from several instances at the same time:

```bash
docker run --rm -e DATABASE_URL=… nutrikit node dist/cli/migrate.js
docker run -d -p 8787:8787 -e DATABASE_URL=… -e NUTRIKIT_TOKEN_SECRET=… nutrikit
```

On a platform, make the first command its release or pre-deploy step and leave the image's default
command (`node dist/main.js`) as the start command. More than one instance can run at once: rate limits,
login throttling and sessions live in Postgres. Create an operator key inside the image with
`node dist/cli/create-key.js "my app"`.

**Bringing over data from the SQLite version.** From a checkout of this repository (not the image), point
`DATABASE_URL` at the new, empty production database and run `npm run migrate:sqlite -- path/to/app.db`
(see *Quick start*). It copies everything in one transaction and refuses to write into tables that
already have rows. Do it before the first instance starts, then start the app.

**Rollback.** Redeploy the previous image tag. Migrations are additive within a release; if a release's
migration has to be undone, run `node dist/cli/migrate.js down` from the *new* image (it knows how to
revert its own migration), then deploy the old image. After moving from SQLite, the old `app.db` is never
modified, so the SQLite-based release stays available as a fallback until you retire it.

## Capabilities

| Capability | Endpoint | How it works |
|---|---|---|
| Food search | `GET /v1/foods/search?q=` | SQLite FTS5 recall over 13,359 foods, then a reranker that prefers the generic, as-eaten form ("banana" → *Banana, raw*) |
| Food detail | `GET /v1/foods/{id}` | 33 nutrients per 100 g, plus USDA household portions (30k) |
| Portion nutrients | `GET /v1/foods/{id}/nutrients?quantity=&unit=` | Converts mass, volume and household units ("2 medium", "1.5 cups", "12 fl oz") to grams; returns %DV against FDA reference values |
| Text logging | `POST /v1/log/text` | A rule-based parser handles quantities, fractions, units, "with" add-ons and meal words. Set `ai: true` to parse with Claude |
| Voice logging | `POST /v1/log/voice` | Speech is transcribed on the device (`Nutrikit.listen()` uses the Web Speech API); the server strips filler words and logs the transcript |
| Photo logging | `POST /v1/log/photo` | Claude vision lists the foods with gram estimates, then each item is matched to the database |
| Barcodes | `GET /v1/barcodes/{ean}` | Validates the GTIN check digit, looks the product up in Open Food Facts, and caches the result for 30 days |
| Nutrition labels | `POST /v1/labels/parse` | Parses label text (current and legacy FDA formats). A label photo is read by Claude |
| Meal plans | `POST /v1/meal-plans` | Builds 1–7 days of plans for 6 diets with exclusions, drawn from USDA survey dishes. Portions are scaled to a calorie target; the same seed gives the same plan |
| Usage | `GET /v1/usage` | Tokens used this month, broken down by endpoint |
| Access tokens | `POST /v1/auth/token` | Exchanges a secret key for a 1-hour token for apps |
| Operator | `/v1/admin/*` | Keys, upgrade requests and account plans (admin token) |

The full contract is served at `/openapi.json`, generated from the route schemas; [server/docs/openapi.json](server/docs/openapi.json) is a checked-in copy (`npm run openapi` regenerates it).

### Token metering

| Call | Tokens |
|---|---|
| search, food detail, portion nutrients | 1 |
| barcode, text/voice log, label text | 5 |
| photo log, label photo, meal plan | 20 |
| AI-assisted calls | + 1 per 1,000 model tokens |

Every response carries `X-Tokens-Charged` (and `X-Tokens-Remaining` when the key has an allowance).
A key that runs out of its allowance gets `429 quota_exceeded`; going over the per-minute rate limit
gets `429 rate_limited` with a `Retry-After` header.

## SDK

```js
import { Nutrikit } from './sdk/js/nutrikit.mjs';   // types in nutrikit.d.ts

const nk = new Nutrikit({ apiKey: 'nk_...', baseUrl: 'http://localhost:8787' });

const meal = await nk.logText('2 eggs, a slice of toast and coffee with milk');
meal.totals.calories;            // { amount: 234, unit: 'kcal', dailyValuePercent: 12 }

await nk.logPhoto(fileInput.files[0], { hint: 'restaurant portion' });
await nk.lookupBarcode('3017624010701');
await nk.parseLabel({ text: labelText });
await nk.createMealPlan({ calories: 1800, diet: 'vegetarian', days: 3 });

// Browser only: on-device capture
await nk.voiceLog();                                   // Web Speech API, then logVoice()
const code = await Nutrikit.scanBarcode(videoElement); // BarcodeDetector API
```

The SDK retries 429, 502 and 503 responses, honouring `Retry-After`, but does not retry quota
exhaustion. Errors are thrown as `NutrikitError` with `status`, `code` and `retryAfter`.

## Tests

Everything needs only Node and Docker:

```bash
npm test                         # all of the below; starts the compose Postgres, then the compose app for the browser test
npm run test:unit                # server: 53 node:test tests (parsing, search, labels, barcodes, meal plans, HTTP API,
                                 # SDK, portal, access tokens, shared limits); web: 37 Vitest tests (API client, every page)
npm run test:e2e                 # builds and starts the app image, then a Playwright smoke test: sign up -> dashboard ->
                                 # create key -> playground food search
npm run multi-instance -w e2e    # two app containers on one database: rate limit, login throttle and sessions are shared
```

Server tests create a throwaway database per file on `TEST_DATABASE_URL` and drop it afterwards. The API tests
inject a fake AI provider, so they need neither network access nor credentials. Playwright installs its
browser inside `node_modules` (`PLAYWRIGHT_BROWSERS_PATH=0`); set `E2E_BASE_URL` to run the smoke test
against another deployment.

## Accuracy and limits

- Nutrient values are USDA averages, and branded products come from crowd-sourced Open Food Facts.
  None of it is medical advice.
- The rule-based text parser handles common phrasing; `ai: true` copes better with free-form descriptions.
- Portion estimates fall back in a fixed order: the stated unit, the food's household portions, a
  volume conversion through any portion of the food, water density, and finally 100 g. The
  `portionMethod` field on each item says which one was used.
- Diet filters work from food names, plus a cholesterol check for vegan. Survey food names can hide
  ingredients, so treat the filters as best effort.
- Photo and label recognition depend on the AI provider. Without one, those endpoints return `501`.
  The Claude provider is covered by contract tests with a fake provider; a live call has not been run
  in this repository's test suite.

## Data and attribution

- **USDA FoodData Central** (SR Legacy, FNDDS 2021–2023, Foundation Foods): public domain (CC0).
  U.S. Department of Agriculture, Agricultural Research Service.
- **Open Food Facts**: product data © Open Food Facts contributors, licensed under the
  [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). Barcode responses carry this attribution;
  if you redistribute the cache, the ODbL share-alike terms apply to it.
- Daily values: FDA, 21 CFR 101.9.
