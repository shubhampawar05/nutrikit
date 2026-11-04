# Proposal

## Why

Nutrikit has no customers yet, so the first developers who try it decide whether it's worth using. A UX and bug
audit (browser walkthrough on desktop and mobile, plus a code review of the website) found nothing fatal. It did
find problems that cost trust: nutrition numbers that are badly wrong for common phrases, a developer note on the
public pricing page, a way to pay for a downgrade, copy that no longer matches the API, and many first-run rough
edges and accessibility gaps. This change fixes all of them in one pass, before outreach starts.

## What Changes

**Food logging accuracy**
- Unquantified add-ons ("with sugar", "with honey") use a sensible serving, never a cup of sugar: a capped,
  teaspoon-to-tablespoon portion for sweeteners and fats.
- Bare everyday words map to what people mean: "tea" and "chai" to hot black tea in a cup, "salad" to a green
  salad, not iced tea, soy chai or beef salad.
- Size words on foods without size portions ("medium fries") use realistic serving sizes.
- Hot drinks named without a size default to one cup.
- Near-duplicate search results (the same food from two data sources) collapse to one, keeping the generic entry.
- The website shows the quantity the user said ("2 eggs · 100 g"), not the portion it was sized from ("1 egg").

**Billing**
- A payment can never move an account to a cheaper plan than the one it is on, whether that plan was paid for
  or set by an operator, and the dashboard doesn't offer it.
- When confirming a payment fails after Checkout, the dashboard explains what happens next, shows the payment id,
  and refreshes the plan.

**Public site, docs and copy**
- The "Placeholder plans" developer note is removed from the pricing page, and pricing reads the plans from the
  server instead of a second hardcoded copy.
- Copy matches the API:
  - failed AI calls can be charged;
  - `X-Tokens-Charged` is on metered responses;
  - `504 ai_timeout` is documented;
  - the AI provider is named correctly, or not at all;
  - the changelog covers Phase 1.
- The home demo sends only on submit or after a longer pause, clears the label on errors, shows a busy state and
  links its limit message to signup. The curl sample uses the real server address.
- Small copy fixes: duplicated password hint, the Enterprise call to action, the customer-facing "AI not
  configured" hint, the quota hint, and consistent sentence case for every server message the site shows.

**Dashboard**
- The one-time key is hard to lose:
  - dismissing an uncopied key asks first;
  - the key survives a refresh until it is dismissed;
  - the first-request snippet uses it;
  - a failed copy selects it.
- Loading, error and empty states for the account and keys. "Create key" is disabled at the plan limit with the
  reason. Revoke and upgrade requests can't be sent twice. The usage number and chart agree.
- Dates for billing periods are shown in UTC, so the reset date is right everywhere.

**Playground**
- "Use another key" really uses the pasted key, and the session can be restored.
- No duplicate sends while a request is in flight.
- Signed-in users without a key are sent to create one.
- The preview fallback no longer claims the API is unreachable.

**Admin console**
- Search waits for a typing pause and keeps results visible; a rejected token returns to sign-in.

**Accessibility and mobile**
- Form errors linked to their fields.
- One announced toast region with no overlap.
- WAI-ARIA tabs.
- A keyboard-reachable photo upload.
- A skip link, and a mobile menu that closes on Escape.
- Named Revoke buttons.
- Table headers in `<thead>`.
- A visible focus ring.
- 44 px touch targets on touch screens.
- Sticky-header-safe anchors.
- A text alternative for the usage chart.

**Out of scope:** password reset (it waits for an email service), the cold start of the free Render plan, and
new features.

## Capabilities

### New Capabilities

- `food-logging`: how free-text meals become matched foods with quantities, portions and grams.
- `developer-dashboard`: the signed-in developer's account, keys, usage and plan page.
- `api-playground`: trying API endpoints in the browser with a session or a pasted key.
- `public-site`: the home page demo, pricing page and documentation that visitors see before signing up.
- `web-accessibility`: accessibility and touch requirements that every website page meets.

### Modified Capabilities

- `billing`: "Starting a payment" refuses any plan cheaper than the current one, including plans set by an
  operator (today it only refuses while a paid period runs). Adds a requirement for a clear outcome when payment
  confirmation fails.
- `admin-console`: admin search waits for a typing pause and keeps results visible; a rejected admin token returns
  to sign-in.

## Impact

- **Server**:
  - `domain/textlog.ts`, `domain/search.ts` and `domain/units.ts`: add-on portions, synonyms, size words, drink
    defaults, duplicate collapsing.
  - `domain/billing.ts`: the downgrade rule.
  - `routes/portal.ts`: a public `GET /portal/api/plans`.
- **Web**: `pages/Pricing.tsx`, `Docs.tsx`, `Dashboard.tsx`, `Playground.tsx`, `Auth.tsx`, `Admin.tsx`,
  `home/Demo.tsx`, `home/CodeSamples.tsx`, `playground/*`, `dashboard/UsageChart.tsx`, `components/Toast.tsx`,
  `Tabs.tsx`, `Layout.tsx`, `api/client.ts`, `styles/site.css`.
- **API**: search may return fewer near-duplicate rows, and some portions change (the point of the fix).
  `GET /portal/api/plans` is new and needs no sign-in. No breaking changes to response shapes.
- **Tests**: new server tests for logging accuracy and the downgrade rule; Vitest coverage for every UI fix.
