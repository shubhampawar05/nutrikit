# Configuration

Set these in `.env` locally, or in your host's environment settings in production.
Templates: [.env.example](../.env.example) (local) and [.env.production.example](../.env.production.example).

## Required

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NUTRIKIT_TOKEN_SECRET` | Signs access tokens. Required in production; generate with `openssl rand -hex 32` and keep it fixed |

## Production

| Variable | What it's for |
|---|---|
| `NUTRIKIT_SECURE_COOKIES` | `1` marks session cookies `Secure`. Use when serving over HTTPS |
| `NUTRIKIT_ADMIN_TOKEN` | Password for `/admin` and `/v1/admin/*`. Unset disables the admin console |
| `NUTRIKIT_TRUST_PROXY` | Proxies in front of the server, so per-address limits see the real client: a hop count (`1` on Render, where every request comes through its proxy) or comma-separated proxy addresses/CIDRs. Unset trusts nothing and `X-Forwarded-For` is ignored. Never set a count on a host that clients can reach directly |
| `NUTRIKIT_PUBLIC_URL` | The site's address, e.g. `https://nutrikit.onrender.com`. Used for canonical URLs, link previews, the sitemap and the links in emails; without it they follow the request's host |

## AI (optional)

Enables photo logging, label photos and `ai: true` text parsing. Without a provider those return `501`.

| Variable | Default | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Use Claude (wins if both keys are set) |
| `OPENAI_API_KEY` | – | Use OpenAI |
| `NUTRIKIT_AI_PROVIDER` | auto | Force `anthropic`, `openai` or `none` |
| `NUTRIKIT_ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude model |
| `NUTRIKIT_ANTHROPIC_EFFORT` | `medium` | `low` … `max` |
| `NUTRIKIT_OPENAI_MODEL` | `gpt-5-mini` | OpenAI model (needs vision and structured outputs) |
| `NUTRIKIT_AI_TIMEOUT_MS` | `60000` | Deadline for one AI call, retries included; past it the API answers `504 ai_timeout` and charges nothing |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint: Azure, OpenRouter, Ollama |

## Payments (optional)

| Variable | What it's for |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Turn on paid upgrades. `rzp_test_…` for testing, `rzp_live_…` for real money |
| `RAZORPAY_WEBHOOK_SECRET` | Secret of the `order.paid` webhook at `/webhooks/razorpay` |

## Email

Verification and password-reset links, sent over HTTPS (Render's free plan blocks SMTP ports, so SMTP is not
offered). Without a provider, development prints each email to the server console; production sends nothing (signups
still work, but nobody can reset a password).

| Variable | What it's for |
|---|---|
| `BREVO_API_KEY` | A [Brevo](https://www.brevo.com) API key. Free plan; the sender can be one verified address, such as your Gmail, so no domain is needed |
| `RESEND_API_KEY` | A [Resend](https://resend.com) API key. Sends only from a domain verified in Resend |
| `NUTRIKIT_MAIL_FROM` | The sender, e.g. `Nutrikit <you@gmail.com>` (Brevo: a verified sender) or `Nutrikit <no-reply@yourdomain.com>` (Resend) |
| `NUTRIKIT_MAIL_PROVIDER` | `brevo` or `resend`, when both keys are set (default Brevo) |

Brevo setup: sign up, add and verify your address under **Senders**, then **SMTP & API → API keys**. Mail from a
free address may land in spam more often than mail from your own domain; switch to Resend (or authenticate your domain
in Brevo) when you have one.

## Tuning (optional)

| Variable | Default | What it's for |
|---|---|---|
| `PORT` | `8787` | HTTP port (most hosts set it) |
| `NUTRIKIT_RATE_LIMIT` | `120` | Requests per minute per key |
| `NUTRIKIT_SIGNUP_LIMIT` | `5` | Signups per hour per client address (invalid attempts count). Raise it if many developers share one network, e.g. an office or college |
| `NUTRIKIT_LOGIN_IP_LIMIT` | `20` | Failed logins per 15 minutes per client address, across all emails (each email also has its own limit of 5) |
| `NUTRIKIT_EMAIL_LIMIT` | `3` | Emails per hour per address and kind (verification, password reset). Reset requests over it are dropped silently, so the answer never shows whether an account exists |
| `NUTRIKIT_EMAIL_IP_LIMIT` | `10` | Emails per hour per client address |
| `NUTRIKIT_MAIL_TIMEOUT_MS` | `15000` | Deadline for one call to the email provider |
| `NUTRIKIT_DB_POOL` | `10` | Postgres connections per instance |
| `NUTRIKIT_OFFLINE` | – | `1` serves barcodes from the packaged-foods store and the cache only |
| `NUTRIKIT_PACKAGED_DB` | `data/packaged.db` | Packaged-foods store (see below). Set it to `data/packaged.all.db` to use the full local set; without a store, barcodes use the live API and packaged-food search answers 503 |
| `NUTRIKIT_WEB_DIST` | `web/dist` | Built website to serve; without it the server is API-only |
| `NUTRIKIT_LOG_LEVEL` | `info` | `fatal` … `debug`, or `silent`. Logs are JSON lines on stdout, one per request, with its `requestId` (also sent as `X-Request-Id`); bodies and credentials are never logged |

## Monitoring (optional)

| Variable | Default | What it's for |
|---|---|---|
| `NUTRIKIT_ALERT_WEBHOOK_URL` | – | Slack or Discord incoming webhook for unhandled errors, error bursts and crashes. See [Monitoring](monitoring.md) |
| `NUTRIKIT_ALERT_COOLDOWN_S` | `600` | Seconds before the same alert is sent again |
| `NUTRIKIT_ALERT_ERROR_BURST` | `10` | Server errors within 5 minutes that raise an alert |

## Development only

| Variable | What it's for |
|---|---|
| `TEST_DATABASE_URL` | Where `npm test` creates throwaway databases. Never point it at production |
| `NUTRIKIT_AUTH` | `off` disables API key checks |

## Packaged foods

Barcode lookups and `GET /v1/barcodes/search` read a store built from an Open Food Facts export. Two sets can be
built from the JSONL export at [world.openfoodfacts.org/data](https://world.openfoodfacts.org/data) (about 80 GB
uncompressed); each build reads it one line at a time (about 10 minutes, little memory):

- **Live set** (`server/data/packaged.db`, committed and in the Docker image): every product sold in India, and the
  US products someone has scanned at least once on Open Food Facts. About 140,000 products in 35 MB. Other US
  barcodes are answered by the live Open Food Facts API.

  ```bash
  npm run build:packaged -w server -- /path/to/openfoodfacts-products.jsonl
  ```

- **Full set** (`server/data/packaged.all.db`, gitignored): every product sold in India or the US whose label passes
  the checks, about 750,000 products. Use it locally with `NUTRIKIT_PACKAGED_DB=data/packaged.all.db`.

  ```bash
  npm run build:packaged -w server -- /path/to/openfoodfacts-products.jsonl --all
  ```

Only products whose label values pass the checks in [api.md](api.md#missing-data) are kept. The build prints, and
stores in the file's `meta` table, how many products it kept and why the others were left out. Each store is a
database under the ODbL 1.0, separate from `foods.db` ([server/data/packaged.LICENSE.md](../server/data/packaged.LICENSE.md)):
credit Open Food Facts, and share it or a database made from it under the same licence. Rebuild from a newer export
to refresh it; every rebuild of the live set adds its size to the git history, so refresh it a few times a year
rather than weekly.
