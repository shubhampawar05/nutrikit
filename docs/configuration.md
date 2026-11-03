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
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint: Azure, OpenRouter, Ollama |

## Payments (optional)

| Variable | What it's for |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Turn on paid upgrades. `rzp_test_…` for testing, `rzp_live_…` for real money |
| `RAZORPAY_WEBHOOK_SECRET` | Secret of the `order.paid` webhook at `/webhooks/razorpay` |

## Tuning (optional)

| Variable | Default | What it's for |
|---|---|---|
| `PORT` | `8787` | HTTP port (most hosts set it) |
| `NUTRIKIT_RATE_LIMIT` | `120` | Requests per minute per key |
| `NUTRIKIT_DB_POOL` | `10` | Postgres connections per instance |
| `NUTRIKIT_OFFLINE` | – | `1` serves barcodes from the cache only |
| `NUTRIKIT_WEB_DIST` | `web/dist` | Built website to serve; without it the server is API-only |

## Development only

| Variable | What it's for |
|---|---|
| `TEST_DATABASE_URL` | Where `npm test` creates throwaway databases. Never point it at production |
| `NUTRIKIT_AUTH` | `off` disables API key checks |
