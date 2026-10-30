# Tasks

## 1. Admin API

- [x] 1.1 Add `domain/admin.ts` (overview, accounts, payments, keys with owner) and routes `GET /v1/admin/{overview,accounts,payments}`; enrich `GET /v1/admin/keys`; upgrade requests use the effective plan; verify with a new `admin.test` (numbers after a payment, filters, expired plan on Free, 401 without token) and the OpenAPI coverage test

## 2. Admin console

- [x] 2.1 Add the `/admin` route: token sign-in, tabs for overview, payments, accounts (search, change plan), keys (search, revoke with confirmation) and upgrade requests; verify with Vitest (wrong token refused, data shown, revoke calls DELETE, plan change calls POST)
- [x] 2.2 Document the console in the README; verify typecheck, unit tests, the smoke test and a browser check of `/admin` against the dev server

## Workflow follow-up

- Archive with `/opsx:archive` after review.
