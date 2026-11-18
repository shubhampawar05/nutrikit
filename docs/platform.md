# Developer platform

Besides the API, the server hosts everything other developers need to sign up and use it.

## Pages

| Page | What it is |
|---|---|
| `/` | Homepage |
| `/pricing` | Plans and token costs |
| `/docs`, `/docs/reference` | Guides and the live API reference |
| `/signup`, `/login` | Sign up and log in. Signup creates a team on the Free plan, owned by the new user |
| `/forgot-password`, `/reset-password`, `/verify-email` | Password reset and email confirmation, reached from links in emails |
| `/dashboard` | Team switcher, members and invitations, live and test keys, usage charts, upgrades, and deleting the account |
| `/invite` | Accepting a team invitation, reached from the invitation email |
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

## Teams

People and teams are separate. A **user** (email, password) signs in; a **team** (the `accounts` table) owns the
plan, keys, usage and payments. A user belongs to one or more teams through a **membership** with a role:

| | Owner | Admin | Developer |
|---|---|---|---|
| See keys, usage and members | ✓ | ✓ | ✓ |
| Create, revoke, regenerate test keys | ✓ | ✓ | ✓ |
| Create, revoke, regenerate live keys | ✓ | ✓ | |
| Invite, remove and change roles of admins and developers | ✓ | ✓ | |
| Make, demote or remove owners; rename the team; change the plan | ✓ | | |

- A team always keeps an owner: the last owner can't leave, be removed or be demoted (`409 last_owner`).
- **Invitations** are emailed links (`/invite?token=…`) that work once, for 7 days, and only for a signed-in user
  with the invited email. Someone without a login signs up first, then accepts. Accepting confirms their email.
- A team holds at most its plan's `maxMembers` people, pending invitations included.
- One person can own up to `NUTRIKIT_TEAMS_PER_USER` teams (default 3), since each team gets its own Free allowance.
  Invitations have their own limits (`NUTRIKIT_INVITE_LIMIT` per team per hour, 3 per address per hour), separate
  from the per-network limit on verification and reset emails.
- Keys belong to the team and record who created them; they keep working when that person leaves.
- The dashboard works in one team at a time (stored on the session). A user removed from the team they are viewing
  falls back to another of their teams, or to a new one named after them.

## Live and test keys

| | Live (`nk_live_…`) | Test (`nk_test_…`) |
|---|---|---|
| Allowance | The team's plan | `NUTRIKIT_TEST_TOKENS` a month per team (default 5,000), separate from the plan |
| Rate limit | The plan's | `NUTRIKIT_TEST_RATE_LIMIT` per minute (default 30) |
| Catalog endpoints | Real data | Real data |
| AI endpoints (photo, label photo, AI text, advisor) | The AI provider | Fixed sample answers (`provider: "test"`), no AI charges |
| Header | – | `X-Nutrikit-Mode: test` |

Keys made before test keys existed are plain `nk_…` and are live. The plan's key limit counts live and test keys
separately. Live usage figures (dashboard, admin console) leave test keys out.

## Plans

A plan sets the monthly token allowance, requests per minute, how many keys of each kind a team can have and how
many people it can hold. All live keys of a team share one allowance. The plans are placeholders: edit `PLANS` in
[server/src/domain/accounts.ts](../server/src/domain/accounts.ts) and the pricing page together.

## Usage metering

Allowances are counted in `usage_periods`, one row per team (`acct:`), team test allowance (`test:`) or operator
key per UTC month. Each call
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
| Missing foods | Foods people tried to log that the catalog lacks, most asked first, with any AI estimate; **approve or reject** an estimate, **resolve** or **ignore** a food |

The same is available over the admin API (`/v1/admin/overview`, `/metrics`, `/accounts`, `/payments`, `/keys`,
`/food-requests`), e.g.:

```bash
curl -X POST https://<host>/v1/admin/accounts/acct_…/plan \
  -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"plan": "starter"}'
```

## Missing foods

Text, voice, photo and homepage-demo logging count every food the catalog couldn't match, under its food words
("2 bowls sabudana khichdi" → `sabudana khichdi`). Nothing else from the request is kept: no account, key or IP.
Test keys are never counted. The list holds up to `NUTRIKIT_FOOD_REQUESTS_MAX` foods (default 5,000); after that
only foods already on it are counted.

When a call uses AI (`ai: true`, or a photo), a missing food is estimated by the AI provider, logged as
`ai-estimate`, and its estimate is stored as **to review**. In **Missing foods**:

- **Approve** an estimate you've checked: from then on every caller logging that food gets it, rule-based logging
  included, without an AI call.
- **Reject** a wrong one: it stops being used and the food isn't estimated again; it stays unmatched.
- An estimate shown as **Same as** a catalog food means the AI judged them the same dish and that food is logged
  with its own values; adding the request's words as its alias makes the match permanent.
- Once the catalog covers the food (an alias in `server/data/aliases/recipes.json` or a cited recipe in
  `server/data/recipes/`, then `npm run build:db`), mark it **Resolved**. **Ignore** text that isn't a food.

```bash
curl https://<host>/v1/admin/food-requests?status=open -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN"
curl -X PATCH https://<host>/v1/admin/food-requests/12 -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"estimateStatus": "approved"}'
```

### Measuring AI estimates

`npm run eval:estimates -w server -- --label <name>` asks the configured AI provider to estimate 100 INDB dishes as if
the catalog lacked them, through the same code logging uses, and scores the answers against INDB's published values
(results in `server/data/eval/<name>.json`). Run it before and after changing the prompt, model or method. Two
identical runs differ by about 3-4 points, and INDB is one home recipe per dish (often lighter than typical), so
compare large differences only.

| Run (gpt-5-mini) | Median calorie error | Within 20% | Notes |
|---|---|---|---|
| `baseline` | 30.7% | 35% | estimates only |
| `validated` | 34% | 30% | + arithmetic checks; none failed in this run |
| `near-match` | 35.8% | 28% | + catalog matches: 11 dishes matched at 20% median error, vs 38% for estimated ones |
| `recipe` (not kept) | 38.7% | 30% | AI's ingredients composed from USDA values: 34.5% vs the AI's own 32.6% on the same 54 dishes |

Against our cited recipes (`--source recipe`, 28 dishes) the AI's own figures were 17.4% off at the median and
the composed recipes 20.1%. Both methods' errors correlate at 0.98-0.99, because both come from the model's idea of
the recipe, so composing from ingredients was dropped; it also made answers long enough to time out. The AI is much
closer to typical recipes (about 17%) than to INDB's lighter home recipes (about 33%).

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
| Name, email, password hash, email confirmed | `users` | Until the user deletes their login |
| Team name, plan | `accounts` | Until the team is deleted (with its last member) |
| Team memberships, invitations (email, role, inviter) | `memberships`, `invitations` | Until the member leaves or the invitation is used, revoked or its team deleted |
| Sessions, email links | `sessions`, `email_tokens` | Deleted with the user |
| API keys (hashes, creator), usage rows, upgrade requests | `api_keys`, `usage`, `upgrade_requests` | Deleted with the team; a key's creator is cleared when they delete their login |
| Monthly usage counters | `usage_periods` | Deleted with the team |
| Sign-up IPs / failed logins (email, IP) / email sends | `signup_attempts` / `login_failures` / `email_sends` | 1 hour / 15 minutes / 1 day, and deleted with the account |
| Payments (ids, plan, amount) | `payments` | Kept for accounting; the account link is cleared on deletion |
| Content sent to the API (text, photos, barcodes) | Not stored; photos and AI text go to OpenAI or Anthropic | – |

**Deleting an account:** Dashboard → Delete account, which calls `POST /portal/api/account/delete` with the
user's password. Wrong passwords count as failed logins (5 per 15 minutes per email). It deletes the user and every
team where they are the only member (with its keys, usage and a running paid plan; the dashboard warns first), in one
transaction. It is refused (`409 sole_owner`) while they are the only owner of a team that has other members: they
make another member an owner first. The address can sign up again afterwards.

## Before a public launch

- [ ] Serve over HTTPS with `NUTRIKIT_SECURE_COOKIES=1`
- [ ] Set a fixed `NUTRIKIT_TOKEN_SECRET`
- [ ] Replace the placeholder plans and prices
- [ ] Switch Razorpay to live keys and add the webhook
- [ ] Set `BREVO_API_KEY` (free, a verified sender address) or `RESEND_API_KEY` (a verified domain), `NUTRIKIT_MAIL_FROM`, and `NUTRIKIT_PUBLIC_URL`, so verification and reset emails are sent with the right links
- [ ] Set `NUTRIKIT_ALERT_WEBHOOK_URL` in Render and the `UPTIME_SLACK_WEBHOOK_URL` repository secret ([Monitoring](monitoring.md))
- [ ] Set `CONTACT_EMAIL` (and `OPERATOR` if needed) in `web/src/legal.ts`, and have the privacy policy and terms reviewed for your business ([legal review notes](legal-review.md))
- [ ] Still to build: auto-renewing subscriptions, invoices/GST, self-serve plan changes, deleting a team on its own
