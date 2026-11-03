# Developer platform

Besides the API, the server hosts everything other developers need to sign up and use it.

## Pages

| Page | What it is |
|---|---|
| `/` | Homepage |
| `/pricing` | Plans and token costs |
| `/docs`, `/docs/reference` | Guides and the live API reference |
| `/signup`, `/login` | Accounts. New accounts start on Free |
| `/dashboard` | Keys, usage charts, upgrades |
| `/playground` | Try any endpoint in the browser |
| `/admin` | Operator console (not linked from the site) |

## Plans

A plan sets the monthly token allowance, requests per minute, and how many keys an account can have. All keys on
an account share one allowance. The plans are placeholders: edit `PLANS` in
[server/src/domain/accounts.ts](../server/src/domain/accounts.ts) and the pricing page together.

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
| Payments | Every Razorpay payment; search by email |
| Accounts | Plans, usage, total paid; **change an account's plan** |
| Keys | Every key with its owner; **revoke** a key |
| Requests | Upgrade requests (Enterprise, or when payments are off) |

The same is available over the admin API (`/v1/admin/overview`, `/accounts`, `/payments`, `/keys`), e.g.:

```bash
curl -X POST https://<host>/v1/admin/accounts/acct_…/plan \
  -H "Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"plan": "starter"}'
```

## Security in place

- Passwords hashed with scrypt; sessions and API keys stored only as SHA-256 hashes.
- Session cookies are `HttpOnly` and `SameSite=Lax`.
- Portal writes require the `X-Nutrikit-Portal` header (CSRF), and no cross-origin requests are accepted.
- Failed logins limited to 5 per 15 minutes per email, across all instances.
- Pages sent with `X-Frame-Options: DENY`.

## Before a public launch

- [ ] Serve over HTTPS with `NUTRIKIT_SECURE_COOKIES=1`
- [ ] Set a fixed `NUTRIKIT_TOKEN_SECRET`
- [ ] Replace the placeholder plans and prices
- [ ] Switch Razorpay to live keys and add the webhook
- [ ] Still to build: email verification, password reset, auto-renewing subscriptions, invoices/GST, self-serve plan changes
