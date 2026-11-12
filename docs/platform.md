# Developer platform

Besides the API, the server hosts everything other developers need to sign up and use it.

## Pages

| Page | What it is |
|---|---|
| `/` | Homepage |
| `/pricing` | Plans and token costs |
| `/docs`, `/docs/reference` | Guides and the live API reference |
| `/signup`, `/login` | Accounts. New accounts start on Free |
| `/forgot-password`, `/reset-password`, `/verify-email` | Password reset and email confirmation, reached from links in emails |
| `/dashboard` | Keys, usage charts, upgrades, and deleting the account |
| `/privacy`, `/terms` | Privacy policy and terms of use ([web/src/pages/Legal.tsx](../web/src/pages/Legal.tsx)); operator name and contact address in [web/src/legal.ts](../web/src/legal.ts) |
| `/playground` | Try any endpoint in the browser |
| `/admin` | Operator console (not linked from the site) |

## Search engines and link previews

- Every page's title, description and whether it may be indexed live in [web/src/seo.json](../web/src/seo.json).
  Add a page there when you add a route.
- The server puts them into each page's HTML (with canonical URL, Open Graph and Twitter tags, and
  structured data on the homepage), so crawlers and link previews don't need JavaScript.
- `/robots.txt` and `/sitemap.xml` are generated from the same list. Unknown pages return a real `404`.
- Login, dashboard and admin are marked `noindex`.
- Icons and the link-preview image are in `web/public/`; regenerate them with `web/scripts/render-icons.mjs`.
- Once the site is live, add it in [Google Search Console](https://search.google.com/search-console) and
  submit `/sitemap.xml`.

## Plans

A plan sets the monthly token allowance, requests per minute, and how many keys an account can have. All keys on
an account share one allowance. The plans are placeholders: edit `PLANS` in
[server/src/domain/accounts.ts](../server/src/domain/accounts.ts) and the pricing page together.

## Usage metering

Allowances are counted in `usage_periods`, one row per account (or operator key) per UTC month. Each call
reserves its cost there before running and settles afterwards (see [API: how a call is charged](api.md#how-a-call-is-charged)).
`usage` keeps every charge as history, which feeds the dashboard charts, per-endpoint breakdowns and the admin
console. The two agree. If a crash ever loses a settlement, the counter is slightly high, in your favour, and
you can rebuild a month from the history:

```bash
npm run usage:reconcile -- 2026-11        # Docker image: node dist/cli/reconcile-usage.js 2026-11
```

It reads `DATABASE_URL` like `npm run migrate`. Run it when traffic is quiet, because reservations in flight
while it runs are dropped from the counter.

## How developers authenticate

```
 Developer's server ── nk_… secret key ──► POST /v1/auth/token
                    ◄── nkat_… token (1 hour) ──
 Developer's app    ── nkat_… token ──────► /v1/*
```

- The secret key (`nk_…`) never leaves the developer's server.
- Apps only ever hold short-lived access tokens, signed with `NUTRIKIT_TOKEN_SECRET`.
- Revoking a key also stops its tokens.

## Admin console

Open `/admin` and sign in with `NUTRIKIT_ADMIN_TOKEN`. The token stays in that browser tab only.

| Tab | What you can do |
|---|---|
| Overview | Accounts per plan, revenue, active keys, tokens this month |
| Health | Uptime, error rate, latency per route, memory, alert status ([Monitoring](monitoring.md)) |
| Payments | Every Razorpay payment; search by email |
| Accounts | Plans, usage, total paid; **change an account's plan** |
| Keys | Every key with its owner; **revoke** a key |
| Requests | Upgrade requests (Enterprise, or when payments are off) |

The same is available over the admin API (`/v1/admin/overview`, `/metrics`, `/accounts`, `/payments`, `/keys`), e.g.:

```bash
curl -X POST https://<host>/v1/admin/accounts/acct_…/plan \
  -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"plan": "starter"}'
```

## Security in place

- Passwords hashed with scrypt (asynchronously, so logins never stall the API); sessions and API keys stored
  only as SHA-256 hashes.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Portal writes require the `X-Nutrikit-Portal` header (CSRF), and no cross-origin requests are accepted.
- Failed logins limited to 5 per 15 minutes per email and 20 per client address, across all instances.
- Signups limited to 5 per hour per client address (`NUTRIKIT_SIGNUP_LIMIT`).
- Email verification and password reset use one-time links stored only as SHA-256 hashes. A reset link works once,
  for 1 hour, ends every other session and counts as verifying the address; a verification link works for 7 days.
  A new link replaces the account's earlier one. "Forgot password" answers the same whether or not an account
  exists. Emails are capped per address (3 an hour of each kind) and per client address (10 an hour).
- Verification is not required to use the API yet: the dashboard asks unverified accounts to confirm.
- Client addresses come from `X-Forwarded-For` only through trusted proxies (`NUTRIKIT_TRUST_PROXY`).
- Allowances are reserved atomically, so parallel requests can't overspend.
- Every response: `nosniff`, `Referrer-Policy`, `X-Request-Id`, and HSTS with secure cookies. Pages: a Content
  Security Policy and `X-Frame-Options: DENY`.
- Calls to AI providers (60 s), Razorpay (15 s) and Open Food Facts (8 s) have deadlines.
- JSON request logs never contain bodies, keys, tokens, cookies or passwords.

## Personal data and account deletion

The privacy policy (`/privacy`) describes what the server stores. Keep it in step when that changes:

| Data | Where | Kept |
|---|---|---|
| Name, email, password hash, plan, email confirmed | `accounts` | Until the account is deleted |
| Sessions, API keys (hashes), usage rows, email links, upgrade requests | `sessions`, `api_keys`, `usage`, `email_tokens`, `upgrade_requests` | Deleted with the account (`ON DELETE CASCADE`) |
| Monthly usage counters | `usage_periods` | Deleted with the account |
| Sign-up IPs / failed logins (email, IP) / email sends | `signup_attempts` / `login_failures` / `email_sends` | 1 hour / 15 minutes / 1 day, and deleted with the account |
| Payments (ids, plan, amount) | `payments` | Kept for accounting; the account link is cleared on deletion |
| Content sent to the API (text, photos, barcodes) | Not stored; photos and AI text go to OpenAI or Anthropic | – |

**Deleting an account:** Dashboard → Delete account, which calls `POST /portal/api/account/delete` with the
account's password. Wrong passwords count as failed logins (5 per 15 minutes per email). Deletion removes everything
above in one transaction, ends every session, and stops the account's keys at once. A running paid plan ends with it
(the dashboard warns first). The address can sign up again afterwards.

## Before a public launch

- [ ] Serve over HTTPS with `NUTRIKIT_SECURE_COOKIES=1`
- [ ] Set a fixed `NUTRIKIT_TOKEN_SECRET`
- [ ] Replace the placeholder plans and prices
- [ ] Switch Razorpay to live keys and add the webhook
- [ ] Set `BREVO_API_KEY` (free, a verified sender address) or `RESEND_API_KEY` (a verified domain), `NUTRIKIT_MAIL_FROM`, and `NUTRIKIT_PUBLIC_URL`, so verification and reset emails are sent with the right links
- [ ] Set `NUTRIKIT_ALERT_WEBHOOK_URL` in Render and the `UPTIME_SLACK_WEBHOOK_URL` repository secret ([Monitoring](monitoring.md))
- [ ] Set `CONTACT_EMAIL` (and `OPERATOR` if needed) in `web/src/legal.ts`, and have the privacy policy and terms reviewed for your business ([legal review notes](legal-review.md))
- [ ] Still to build: auto-renewing subscriptions, invoices/GST, self-serve plan changes
