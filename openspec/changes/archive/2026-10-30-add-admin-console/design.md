# Design

## Context

The admin API (`routes/admin.ts`, bearer `NUTRIKIT_ADMIN_TOKEN`) already creates, lists and revokes keys, lists
upgrade requests and changes plans. Purchases live in `payments`; effective plans come from
`accounts.effectivePlan` (expired periods read as Free).

## Decisions

- **Sign-in with the existing admin token**, not new admin accounts: no new secrets, schema or session type. The
  console keeps the token in `sessionStorage` (cleared on sign-out and when the tab closes) and sends it as
  `Authorization: Bearer` to `/v1/admin/*`, like curl does. Alternative: an `is_admin` flag on accounts with portal
  sessions — better for several operators, deferred.
- **Read endpoints in `domain/admin.ts`**: single SQL queries each, capped at 200 rows, newest first, with an optional
  `q` filter (`ILIKE` on email or name). Amounts are returned in rupees.
- **Console layout**: one `/admin` page with tabs (Overview, Payments, Accounts, Keys, Requests), the site's existing
  card, table and button styles, React Query for data. Destructive actions (revoke, plan change) confirm first.
  The page is not linked from the site navigation.

## Risks / Trade-offs

- [Admin token in browser storage could be read by injected script] → session storage only, no third-party scripts on
  `/admin` (Razorpay's script loads only on payment), and the token can be rotated in `.env`.
- [Large tables] → 200-row cap with search; pagination later if needed.
