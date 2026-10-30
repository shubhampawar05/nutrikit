# Proposal

## Why

Operators can only see purchases or revoke a developer's key by calling the admin API with curl or querying the
database, and the admin key list shows account ids instead of emails. Day-to-day admin work (who paid, who is on
which plan, cutting off a misbehaving key, handling Enterprise requests) should be possible from the browser.

## What Changes

- A web **admin console** at `/admin`, signed in with the operator's admin token (`NUTRIKIT_ADMIN_TOKEN`), with:
  overview numbers, payments, accounts (search, plan, paid-until, keys, usage, change plan), all API keys with their
  owner's email (revoke), and upgrade requests.
- New admin API endpoints: `GET /v1/admin/overview`, `GET /v1/admin/accounts?q=`, `GET /v1/admin/payments?q=`.
- `GET /v1/admin/keys` adds each key's account email and name (additive). Upgrade requests report the account's
  effective plan (an expired paid period reads as Free).

## Capabilities

### New Capabilities

- `admin-console`: the operator's view of accounts, payments and keys in the browser and the admin API behind it.

### Modified Capabilities

None.

## Impact

- **Server**: new `domain/admin.ts` queries; routes in `routes/admin.ts`; OpenAPI gains three admin paths.
- **Web**: new lazy `/admin` route and page; an admin API client using the token as a bearer credential.
- **Security**: the admin token is kept in the browser tab's session storage while signed in, and every admin call
  still requires it. Admin accounts with their own logins are out of scope.
