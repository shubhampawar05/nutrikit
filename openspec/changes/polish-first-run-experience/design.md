# Design

## Context

See proposal.md for the motivation and specs/ for the required behavior. The current state that shapes the
approach:

- **Food logging** (`server/src/domain/textlog.ts`): unquantified add-ons take "the smallest portion of at least
  10 g". Sugar's portions are 1 cup (200 g), 1 tsp (4.2 g), 1 packet (3.5 g) and 1 cube (2.3 g), so it gets a
  cup. French fries only have per-fry portions (2–9 g) and 1 cup (60 g), so "medium fries" falls back to a cup.
- **Search** (`domain/search.ts`): FTS5 recall plus a reranker with `SYNONYMS` (token rewrites) and
  `STAPLE_DEFAULTS`. The catalog has `Tea, hot, leaf, black` (portions: 1 cup = 240 g, medium = 480 g) but no chai
  and no generic green salad among survey foods, so bare "salad" ranks "Beef salad" first. Near-duplicates exist
  across sources: "Yogurt, Greek, whole milk, plain" (survey) and "Yogurt, Greek, plain, whole milk" (foundation).
- **API shape**: logged items already carry `quantity: 2, unit: "egg"`. The website shows `portionBasis`
  ("1 egg") instead, so the "2 eggs" bug is display-only.
- **Billing** (`domain/billing.ts:createOrder`): a cheaper plan is refused only when `account.planExpiresAt` is
  set. `rank()` uses price, and Enterprise's price is `null`, so it ranks 0. The dashboard's `selectable()` copies
  the same expiry-based rule.
- **Pricing** (`web/src/pages/Pricing.tsx`): a hardcoded copy of the plans plus a notice rendered for every
  visitor. Plans are only available at `/portal/api/me`, which needs a session.
- **Web conventions**: React Query, react-hook-form, a small `Toast` component, a shared `Tabs` component (used
  by Playground and Admin), `api/client.ts` formatters, plain CSS in `styles/site.css`, Vitest and Testing
  Library tests next to each page.

## Goals / Non-Goals

**Goals:**
- Every audit finding except password reset is fixed and covered by a test.
- Food logging fixes are rule-based and data-driven, with no AI calls, and keep today's good results
  ("2 rotis and dal", "rice with ghee", "a handful of almonds") unchanged.
- No breaking changes to API response shapes.

**Non-Goals:**
- Password reset, email, the Render cold start, new endpoints beyond `GET /portal/api/plans`.
- Rebuilding the food catalog or adding foods (chai stays mapped to black tea; there is no chai entry to add).
- A design-system overhaul. Visual style stays as it is except where accessibility needs it (focus ring, touch
  sizes).

## Decisions

### 1. Add-on sizing: a cap by food type, then the largest fitting household portion

Classify the matched food by name:
- **Rich add-ons** (15 g cap): sugar, syrup, honey, jam, jelly, butter, ghee, margarine, oil, mayonnaise, cream,
  dressing, sauce.
- **Everything else**: 60 g cap.

Among the food's portions, take the largest per-unit portion that is at least 3 g and no more than the cap. That
gives sugar 1 tsp, honey 1 tsp or tbsp, milk 1 fl oz (30.5 g), and blueberries the smallest portion within 60 g.
If no portion fits, use the cap in grams (unit `g`, method `add-on-cap`). Stated amounts ("2 tbsp sugar") skip
this rule, as today.

*Alternative:* a hand-written add-on grams table per food. That is more precise for a few foods but brittle; the
cap and portion data generalise.

### 2. Bare-word defaults, applied only to whole queries

Add `BARE_DEFAULTS`: a map applied only when the entire normalised query equals the key, so "iced tea" and
"chicken salad" are untouched.
- `tea` and `chai` map to `tea hot leaf black`.
- `salad` maps to the catalog's generic lettuce or green-salad entry, chosen at implementation by name search
  (e.g. "Lettuce, salad with assorted vegetables", or "Lettuce, raw" as the fallback). The chosen entry is pinned
  in a test.
- `coffee` keeps its existing synonym.

Token-level `SYNONYMS` would rewrite "iced tea" too, which is why these are whole-query only.

### 3. Hot drinks default to a cup

In `resolvePortion`, for a bare count with no unit, foods whose name starts with `Tea, hot`, `Coffee` or
`Hot chocolate`/`Cocoa` choose the `cup` portion first. The existing drink rule already avoids a café "medium" for
coffee; this extends it to tea, whose `medium` is 480 g.

### 4. Size words: a small serving table, then ordered fallbacks

A `SIZE_SERVINGS` table maps a food-name pattern to `{ small, medium, large }` grams for foods sold in sizes
without matching portions: french fries 71 / 117 / 154 g, based on USDA FNDDS fast-food sizes. Without a table
entry, a size word uses the food's own size portions if it has them; otherwise the default portion for all three
sizes, which keeps the required ordering. The table starts with fries; adding a food is one line and a test.

### 5. Collapse near-duplicate search results

After reranking, compute a key per result: the lowercased name with punctuation removed, words sorted, brand words
(all-caps tokens) dropped. Keep the first result for each key, which is the higher-ranked and usually the generic
survey entry. `total` is unaffected; this only filters the returned page, and requests one extra row so a page
stays full.

### 6. Show the quantity the user said

The previews (playground `previews.tsx`, home `Demo.tsx`) render `${quantity} ${pluralise(unit, quantity)} ·
${grams} g` and keep `portionBasis` as secondary text ("from 1 egg = 50 g") where there's room. No API change.

### 7. Public plans endpoint, one source for prices

`GET /portal/api/plans` (no session; `Cache-Control: public, max-age=300`) returns `{ plans, currency }`, built
from `PLANS` with only display fields. `Pricing.tsx` reads it with React Query, shows skeleton cards while
loading, and drops the hardcoded copy and the notice. `/portal/api/me` keeps returning plans for the dashboard.
The CSRF hook only guards non-GET requests, so a public GET fits the portal routes.

### 8. One plan rank for server and dashboard

`planRank(plan)` returns `free` = 0, then the plan's price, with `enterprise` = Infinity. It lives in
`accounts.ts` and is exported to the web through the plans payload as a `rank` field, so the two can't drift.
`createOrder` refuses whenever `planRank(plan) < planRank(account.plan)`, using the account's effective plan,
with no expiry condition. The dashboard's `selectable()` uses the same `rank`.

### 9. Payment confirmation failure

When verify fails after Checkout, the dashboard shows a persistent notice, not a toast: "We couldn't confirm the
payment yet. If you were charged, your plan will switch on within a few minutes. Payment id pay_…". It then
invalidates `['me']` after 5 s and again after 30 s. The webhook already applies payments the browser couldn't
confirm.

### 10. Dashboard state and safety

- **The new key** stays in `sessionStorage['nutrikit-new-key']` until dismissed, not just until the first
  render. A `copied` flag drives a `confirm()` before dismissing; `confirm()` matches the existing revoke
  confirmation.
- **Copying**: on failure, select the input's text (`input.select()`).
- **The curl snippet** reads the revealed key when present.
- **Loading and errors**: skeletons for `/me` and `/keys`, and errors as a sentence-case message plus a Retry
  that calls `refetch()`.
- **Buttons** are disabled by `isPending` (per row for revoke).
- **Upgrade request success** records `{plan, sentAt}` in component state and replaces the form for that plan.
- **On mount**, the dashboard invalidates `['me']` so the headline usage matches the chart's fresh query.
- **Logging out** clears the playground's saved key.

### 11. One message formatter, one number locale, UTC periods

`api/client.ts` gains:
- `sentence(msg)`, which capitalises and adds a full stop if missing. It is used by every place that shows a
  server message: Dashboard, Demo, Playground and toasts. Auth and Admin already do this and switch to the shared
  helper.
- `fmt` formats tokens with the `en-US` locale on every page. Rupee prices keep `en-IN`, which is correct for
  INR.
- `fmtPeriodDate` formats with `timeZone: 'UTC'` and is used for reset and paid-until dates.

### 12. Playground credential state

`auth.current` becomes explicit state: `{ mode: 'session' | 'manual', value }`.
- Entering manual mode clears the session value, so a send without a pasted key asks for one.
- "Use my account" mints a new playground token.
- `sendLatest`, `pickExample` and the submit handler return early while `busy`.
- The `no_key` view checks `useMe()`: signed-in users get "Create a key in your dashboard".
- Error hints in `endpoints.ts` are rewritten for customers.

### 13. Home demo

The debounce goes from 650 ms to 1500 ms. Submit and example chips still send immediately. Any error clears the
totals and items. A `pending` flag disables "Log it" and shows a busy label. The 429 message renders as a sentence
with a `<Link to="/signup">`. `CodeSamples.tsx` uses `window.location.origin`.

### 14. Accessibility building blocks

- **Toasts**: `Toast.tsx` becomes a provider with one `role="status" aria-live="polite"` container. Toasts append
  as a flex column.
- **Tabs**: `Tabs.tsx` implements the WAI-ARIA pattern (a labelled `role="tablist"`, `aria-controls` and ids,
  roving `tabIndex`, Left/Right/Home/End keys). Playground and Admin pass labels.
- **Layout**: `Layout.tsx` adds a skip link to `#main`, `aria-controls` and `aria-expanded` on the menu button,
  and Escape-to-close with focus returning to the button.
- **Forms**: fields get `aria-invalid` and `aria-describedby` through one small `fieldProps(name)` helper in
  `Auth.tsx`.
- **Photo upload**: the file input becomes `.sr-only` (visually hidden, still focusable) instead of `hidden`.
- **CSS**:
  - `:focus-visible` gets a 2 px outline.
  - `@media (pointer: coarse)` sets `min-height: 44px` on `.btn`, `.chip` and `.copy`.
  - `[id] { scroll-margin-top: 88px }`.
- **Tables**: header rows move into `<thead>` with `scope="col"`.
- **Usage chart**: a visually hidden `<table>` of daily values.
- **The key reveal**: no longer `role="status"`. Focus moves to its heading, and the toast region announces
  "New key created".
- **Labels**: `aria-label` divs get `role="region"` or `role="group"`. In the docs nav, the group titles become
  `<p>` instead of `<h4>`.

### 15. Admin console

Search inputs are debounced by 300 ms through a `useDebouncedValue` hook, and queries use
`placeholderData: keepPreviousData`. A shared `admin()` fetch wrapper clears the token on 401 and emits an event;
the page listens for it and returns to sign-in with "That admin token is no longer accepted."

### 16. Copy

Pricing FAQ and Docs:
- Failed calls are free except AI usage already consumed.
- "Every metered response" carries the token headers.
- Add `504 ai_timeout` to the errors table.
- Note that `labels/parse` reserves the photo cost and settles to 5 for text.
- Name the AI generically ("the server's AI provider").
- Changelog entry v1.3 for Phase 1.

Enterprise call to action: "Contact us". Signed-out visitors go to `/signup?next=/dashboard%23upgrade`; signed-in
developers go to `/dashboard#upgrade`.

Auth:
- Drop the duplicate password hint.
- "log in instead" becomes a link to `/login?email=…`, and the login form prefills from `?email`.
- `next` is carried through both links.

## Risks / Trade-offs

- **Portion rules change results for phrases that used to "work".** A golden test pins today's good results
  (rotis and dal, rice with ghee, almonds, oatmeal with blueberries, toast with jam, the docs examples) before any
  rule changes, and every rule change must keep it green.
- **Duplicate collapsing hides a result someone wanted** (for example the foundation entry). Only exact
  word-set matches collapse, the rest stay, and `source=` filtering still reaches every entry.
- **The `salad` default is a judgement call on catalog data.** The chosen entry is recorded in the test and is a
  one-line change.
- **The public plans endpoint exposes prices.** They are already public on the pricing page. It returns display
  fields only.
- **`confirm()` dialogs are plain.** They are consistent with revoke, and a custom dialog is out of scope.
- **The bigger debounce makes the demo feel less live.** Submit and examples stay instant. 1.5 s still feels
  responsive and keeps a curious visitor well under 20 requests a minute.

## Migration Plan

There are no data or schema changes. Deploying is a normal merge to `main`. The changes are reversible by
redeploying, and the API response shapes are unchanged. The only new route is `GET /portal/api/plans`.
