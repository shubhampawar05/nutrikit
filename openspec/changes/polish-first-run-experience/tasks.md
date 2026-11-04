# Tasks

## 1. Food logging accuracy

- [x] 1.1 Add a golden test (`server/test/logging-golden.test.mjs`) pinning today's good results ("2 rotis and dal", "rice with ghee", "a handful of almonds", "a bowl of oatmeal with blueberries", "toast with jam", "1 cup rice, chicken curry", and the docs' log/text examples): matched food names and grams within ±10%; verify it passes before any rule changes
- [x] 1.2 Replace the add-on rule in `textlog.ts` with the 15 g / 60 g cap and the largest fitting portion of at least 3 g (method `add-on-cap` when none fits); verify with tests for sugar in tea and coffee (3–15 g), milk in coffee (15–60 g), "tea with 2 tbsp sugar" (two tablespoons), and the golden test
- [x] 1.3 Add whole-query `BARE_DEFAULTS` in `search.ts` (tea and chai to hot black tea, salad to the chosen generic lettuce or green-salad entry); verify with tests for "tea", "a cup of chai", "a salad", plus "iced tea" and "chicken salad" keeping their variants
- [x] 1.4 Default bare hot drinks to the cup portion in `units.ts`; verify "tea" is about 240 g and "coffee" is unchanged
- [x] 1.5 Add `SIZE_SERVINGS` (french fries 71 / 117 / 154 g) and the ordered fallback for size words; verify "medium fries" is 100–140 g and small < medium < large
- [x] 1.6 Collapse near-duplicate search results by normalised word-set key, keeping the higher-ranked entry; verify "greek yogurt" lists the whole-milk plain yogurt once and a full page is still returned
- [x] 1.7 Note the portion improvements in the Docs changelog entry (group 4) and in `docs/api.md` → Accuracy; verify by reading the text back

## 2. Billing

- [x] 2.1 Add `planRank()` to `accounts.ts` (enterprise = Infinity) and make `createOrder` refuse any cheaper plan regardless of expiry; verify with billing tests for an operator-set Growth account buying Starter (409), Enterprise buying Growth (409), an operator-set Starter extending or moving up (201), and the existing scenarios
- [x] 2.2 Add `GET /portal/api/plans` (public, display fields plus `rank` and currency, 5-minute cache), hidden from OpenAPI like the other portal routes; verify with a test for the 200 shape, no session needed, and no extra fields
- [x] 2.3 Dashboard `selectable()` uses `rank`; on a verify failure show the persistent notice with the payment id and refetch `['me']` after 5 s and 30 s; verify with Vitest for an operator-set plan (no cheaper option offered) and a failed verify (notice, payment id, refetch)

## 3. Shared web helpers and accessibility building blocks

- [x] 3.1 Add `sentence()`, `fmtPeriodDate()` (UTC) and an `en-US` token `fmt` to `api/client.ts`, and use them in Dashboard, Demo, Playground, Auth, Admin and toasts; verify with unit tests (capitalisation and full stop, a UTC−5 reset date, "1,000,000")
- [x] 3.2 Rebuild `Toast.tsx` as a provider with one live region and stacked toasts; verify with Vitest that two toasts both render in one `role="status"` container
- [x] 3.3 Rebuild `Tabs.tsx` as WAI-ARIA tabs (label, `aria-controls`, roving tabindex, Left/Right/Home/End) and pass labels from Playground and Admin; verify with Vitest keyboard tests
- [x] 3.4 `Layout.tsx`: skip link, menu `aria-controls`/`aria-expanded`, Escape closes the menu and returns focus; `site.css`: `:focus-visible` ring, 44 px coarse-pointer targets, `[id] { scroll-margin-top }`; verify with Vitest (skip link first in tab order, Escape) and a mobile browser check of chips, copy buttons and the /#how anchor

## 4. Public site and docs

- [x] 4.1 `Pricing.tsx` reads `/portal/api/plans` with skeletons, drops the hardcoded plans and the placeholder notice, and fixes the FAQ copy and the Enterprise call to action; verify with Vitest (plans rendered from the API, no "placeholder" text, FAQ wording, Enterprise link for signed-in and signed-out visitors)
- [x] 4.2 `Docs.tsx`: failed-call charging, "every metered response", `504 ai_timeout` in the errors table, the `labels/parse` reservation note, a generic AI provider name, changelog v1.3, and nav group titles as `<p>`; verify with Vitest assertions on the new text and that the page's first heading is the `<h1>`
- [x] 4.3 Home demo: 1500 ms debounce, busy state, clear the totals on error, sentence-case limit message with a signup link; `CodeSamples.tsx` uses the page origin; verify with Vitest using fake timers (one request after typing, cleared label after a 429, link present)
- [x] 4.4 Auth: single password hint, "log in instead" link with the email prefilled, `next` carried through both links, `aria-invalid`/`aria-describedby` on fields; verify with Vitest

## 5. Dashboard

- [x] 5.1 New-key safety: key kept until dismissed (survives a refresh), confirm before dismissing an uncopied key, select the text on copy failure, real key in the curl snippet, focus on the reveal heading with no `role="status"`; verify with Vitest for each case
- [x] 5.2 Loading, error (with Retry) and empty states for `/me` and `/keys`; "Create key" disabled at the plan limit with the reason; verify with Vitest for slow, failing and empty responses and a 2-of-2 Free account
- [x] 5.3 Pending-safe actions (revoke per row, create, upgrade request, pay), "Request sent" after an upgrade request, `['me']` invalidated on mount, playground key cleared on logout, named Revoke buttons, `<thead>` tables, an accessible usage-chart table; verify with Vitest (double-click sends once, request-sent state, logout clears storage, accessible names)

## 6. Playground

- [x] 6.1 Explicit credential state: manual mode never sends with the session, "Use my account" restores the session, and sending without a pasted key asks for one; verify with Vitest checking the `Authorization` header in each mode
- [x] 6.2 No duplicate sends while busy (button, Ctrl/⌘+Enter, example chips); verify with Vitest that three quick presses cause one fetch
- [x] 6.3 Context-aware guidance (signed in without a key → dashboard), customer-facing `ai_provider_unavailable` and `quota_exceeded` hints, "see the JSON tab" preview fallback; verify with Vitest
- [x] 6.4 Previews show "2 eggs · 100 g", units on per-100 g label values, a keyboard-reachable photo upload (`.sr-only` input), and a live region only on the status line; verify with Vitest and a keyboard check in the browser

## 7. Admin console

- [x] 7.1 Debounced search (300 ms) with `keepPreviousData` and a loading indicator; a 401 on any admin call clears the token and returns to sign-in with a message; verify with Vitest using fake timers and a 401 response

## 8. Integration check

- [x] 8.1 Run `npm run typecheck` and `npm run test:unit`, then walk the audit path again in the browser on desktop and mobile: home demo, pricing, docs, signup, dashboard (keys, upgrade), playground (text, barcode, another key) and admin. Re-run the audit phrases ("a cup of tea with sugar", "medium fries", "tea", "a salad", "2 eggs") and confirm each finding is resolved, with no console errors; record the results in the PR
  - Done: typecheck clean; unit tests 126 server, 101 web, 5 MCP, all passing. Browser on desktop and mobile: pricing (plans from the API, no placeholder note, corrected FAQ, Contact us), the home demo ("2 eggs · 100 g", tea with sugar 160 kcal for the meal), signup and the dashboard (key survives a refresh, confirm on an uncopied dismiss, Create key disabled at 2 of 2 with the reason, named Revoke buttons, curl snippet with the real key), the playground (quantity preview, status-line live region, focusable photo input, ARIA response tabs), docs (504, v1.3, h1 first), 44 px touch targets and the /#how anchor; no console errors. The audit phrases are all resolved. The admin console was covered by its Vitest tests only (no browser sign-in, to avoid using the .env admin token). Results go in the PR description.

## Workflow follow-up

- Review the PR and merge to `main`; check the pricing page and the demo on the live site.
- Archive with `/opsx:archive`, which creates the `food-logging`, `developer-dashboard`, `api-playground`, `public-site` and `web-accessibility` main specs and updates `billing` and `admin-console`.
