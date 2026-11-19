# Nutrikit nutrition pipeline audit

Date: 2026-11-19. Scope: the working tree after M3.0, M4, M5, M7.1, M7.2 and M7.3 (uncommitted).

Method:

- No code changes, migrations or commits.
- No API calls; no production access.
- Every example was reproduced locally with `logText` / `searchFoods` / `estimateItem` against `server/data/foods.db`
  (catalog build `2026-11-19T10:19:26Z`). Probe scripts were kept outside the repository.
- Test status at audit time: 475/475 server, 157/157 web, typecheck clean.

**Headline:** the benchmark (set C v2, 66/72 correct, 0 wrong) is not representative of everyday input. A broader
probe of about 150 common phrases found **silent wrong-food and wrong-amount logging in staples**:

- roti (2.8x calories)
- chicken
- rasgulla
- fried rice
- chips
- "roti sabzi", where **the sabzi is silently dropped. This is a regression introduced by M7.3.**

These are P0.

---

## 1. Architecture and data flow

```
 text ──┐                                   voice transcript ─┐ (filler removed on server)
        ├─ ai:false ─► splitMealText ──► resolvePhrase ───────┤
        │              (and / with / ,)   │                    │
        │                                 ▼                    │
        │                searchFoods: 1 as typed (all-words / prefix / any-word)
        │                             2 M7.3 equivalent forms (spellings, connectors, Hindi→English) + identity guard
        │                             3 fuzzy respelling → didYouMean (suggest only, never logged)
        │                                 │
        │                resolvePhrase guards: fallback match must cover >50% of words AND name the head (M7.1);
        │                                 dry-staple rule; add-on caps (15 g rich / 60 g other)
        │                                 │
        │                     matched ────┴──── unmatched ──► recordMisses (food_requests.count)
        │                        │                               │
        │                resolvePortion                 rules path: coverUnknowns(provider=null)
        │                (mass / volume→density /        → APPROVED estimates only, no AI call
        │                 count portion / default)
        │                        │
 photo ─┴─ ai:true ─► provider.recognizeMeal / parseMeal → items {food, quantity, unit, grams (AI), confidence}
                      │  each item → resolvePhrase(grams = AI grams → providedPortion, overrides catalog portions)
                      │  unmatched → coverUnknowns(provider, store=live, pending=true)
                      │     stored approved|pending estimate ─► stale? (M5) ─► claim → requestEstimates → replace+history
                      │     rejected → stays unmatched                          └► fail → release + back-off + failures
                      │     none → requestEstimates (validate, 1 retry, sameAs ±30%) → saveEstimate (first writer)
                      │     estimateItem: sameAs → catalog values (basis kind catalog-match, confidence medium)
                      │                   else per100g × grams (serving count M3.0; nulls left out), source ai-estimate
                      ▼
               scaleNutrients (per 100 g × grams) → sumNutrients (totals; missingFrom when a food lacks a nutrient)
                      ▼
               LogResult { items[ food, quantity, unit, grams, portionBasis, portionMethod, confidence, nutrients,
                                  basis? (M4), recognition? ], unmatched[ suggestions, didYouMean ], totals }

 barcode ─► Open Food Facts (local export / live) → BarcodeProduct (per 100 g or per 100 ml; label checks)
 label photo ─► readLabel → per serving (+ per 100 g when servingGrams); ml-serving warning   (not logged as items)
```

The estimate lifecycle (`food_requests`):

```
none ──(AI estimate passes checks)──► pending ──(operator)──► approved   (served to all callers; never auto-replaced)
  │                                    │  ▲                   rejected   (never served; never re-estimated)
  └─(every answer rejected)──► estimate_failures   └─ stale (age > 30 d, prompt/calc version, fails checks)
                                                      → one claimed re-estimate → replace + history (5) | back-off 60 min
```

## 2. Findings

Priority:

- **P0:** incorrect nutrition data or silent wrong-food logging.
- **P1:** significant accuracy or reliability.
- **P2:** coverage or usability.
- **P3:** future.

Every fix below needs **no API spending**. The only exceptions are the optional checks marked "optional, free tier".

### P0: incorrect nutrition data or silent wrong-food logging

**P0-1. "roti sabzi" logs only the roti; the sabzi is silently dropped. (Regression from M7.3)**

- **Evidence:** `logText('roti sabzi')`:
  - `items: [Bread, chapati or roti …]`, `unmatched: []`
  - `searchFoods('roti sabzi').matchedAs === 'roti'`
  - Files: `server/src/domain/search.ts` (`CONNECTORS`, `equivalentQueries`).
- **User impact:** a whole food disappears from the log, with no unmatched entry and no warning. Any "X sabzi"
  phrase without a separator is affected ("roti sabzi", "chawal sabzi").
- **Root cause:**
  - M7.3 treats `sabzi` as a connector word and drops it on its own in the last equivalent forms.
  - "roti sabzi" is two foods, not a dish name.
  - The identity guard passes because "roti" does name the chapati. The guard checks what remains, not what was
    dropped.
- **Fix:** drop connectors only as the genitive pair `ki|ka|ke + sabzi|sabji|subzi` after a food word ("matar ki
  sabzi" → "matar"), never a standalone `sabzi`. "gobi aloo sabzi" then becomes a suggestion: lower coverage,
  correct behaviour.
- **Tests:**
  - "roti sabzi" is not logged as roti alone; it is split or left unmatched
  - "matar aloo ki sabzi" still → pea potato curry
  - "aloo ki sabzi" still → potato curry
  - "gobi aloo sabzi" may become a suggestion
- **API:** none.

**P0-2. Exact (all-words) matches can name a different food; `vegetable fried rice` → Rissoles is one of several.**

- **Evidence:**

  | Phrase | Logged as | Note |
  |---|---|---|
  | vegetable fried rice | Rissoles, brown rice, fried in vegetable oil | |
  | egg fried rice | Roll with meat and/or shrimp, vegetables and rice paper, not fried | |
  | plain rice | Snacks, rice cracker brown rice, plain | 9 g |
  | bread butter | Peanut butter sandwich | |
  | tortilla chips, corn chips | Sweet potato chips | |
  | french toast | Bread, French or Vienna, toasted | |
  | apple pie | Apple pie filling | |
  | chicken fried rice | Chicken, stir-fried with rice and vegetables (CoFID) | while FNDDS "Rice, fried, with chicken" exists |

  Files: `search.ts` (`searchOnce` all-words pass, `SYNONYMS.chips`), `textlog.ts` (`resolvePhrase` only guards
  fallback matches).
- **User impact:** a confident-looking catalog item for a different food. Calories can be badly off (9 g of rice
  crackers instead of a plate of rice). Nothing warns the user.
- **Root cause:**
  1. The all-words pass only needs every typed word somewhere in the name, including descriptive tails ("fried in
     vegetable oil") and other dishes' components ("rice paper").
  2. The M7.1 head guard is applied only to fallback matches, and M7.3's identity guard only to equivalent forms.
  3. `SYNONYMS.chips = 'potato chips'` rewrites "corn chips" to "corn potato chips".
- **Measured** (local probe of a candidate rule, not applied): the rule "every typed word must be in the food's first
  two name segments, a bracketed name or an alias":
  - flags 5/5 of the known wrong matches
  - flags 22 of 3,867 exact matches across catalog phrases:
    - **~5 are also wrong** (corn/tortilla chips, french toast, …)
    - **~17 are correct** and need exemptions: bare defaults (daal, palak, chai), phrase rewrites (curd →
      yogurt), USDA descriptor order ("Tea, hot, leaf, green"; "Rice, …, raw"), and singular forms ("cookies")
  - A blanket "name the head" rule would refuse 234 correct matches. **Do not** apply M7.1 to exact matches as-is.
- **Fix:** an identity check on exact matches with explicit exemptions:
  - reviewed (pinned) aliases and `BARE_DEFAULTS`
  - compare the normalized query
  - split hyphens consistently with name tokenization
  - allow a short list of USDA descriptor words (raw, cooked, plain, green, boiled, toasted, …) anywhere in the name

  On failure, don't log: return the alternatives that pass as suggestions. Separately, restrict `chips → potato chips`
  to the bare word "chips".
- **Tests:**
  - each phrase in the table: never its wrong food
  - the 17 exempted correct matches still match
  - the logging benchmark and set C unchanged
  - a catalog-wide audit test: an exact match whose words appear only in a description is refused
- **API:** none.

**P0-3. "roti" / "chapati" resolve to USDA *commercially prepared* chapati: about 2.8x the calories of a home roti.**

- **Evidence:**
  - `logText('2 roti')` → "Bread, chapati or roti, plain, commercially prepared" (SR 171844: 297 kcal/100 g,
    68 g/piece) = **136 g, 404 kcal**.
  - `logText('1 phulka')` → INDB "Chapati/Roti" (202 kcal/100 g, 36 g/piece) = 73 kcal.
  - Set A ranges chapati 202–297 (CoFID "made without fat" 202 = INDB 202; USDA 297).
  - Files: `search.ts` (ranking prefers USDA/survey), the catalog aliases.
- **User impact:** the most common Indian food is overestimated: 2 roti ≈ 404 kcal vs ~146 kcal. Daily totals for
  Indian users can be off by hundreds of kcal.
- **Root cause:**
  - The ranking prefers a USDA name match.
  - The USDA entry is a commercial product with a heavier piece.
  - "phulka" happens to hit the INDB entry through its alias.
- **Fix (owner decision on the reference):** pin "roti", "chapati" and "rotis" to the INDB/CoFID home roti with a
  reviewed alias. Two independent sources agree at 202 kcal/100 g; the piece weight is 36 g (INDB). Keep the USDA
  entry reachable as "commercial chapati".
- **Tests:** "2 roti" ≈ 2 × 36 g at ~202 kcal/100 g; "roti" and "chapati" agree; "1.5 roti" scales.
- **API:** none.

**P0-4. Bare "chicken" logs ground raw chicken, 28 g.**

- **Evidence:** "chicken", "1 piece chicken" and "chicken and rice" → "Chicken, ground, raw", 28.3 g, 40 kcal. File:
  `search.ts` (no bare default for chicken).
- **User impact:** wrong food (raw, ground) and a fraction of a real portion. "chicken and rice" undercounts the
  chicken about 5x.
- **Root cause:** no `BARE_DEFAULTS` entry. The ranking picks a short generic name, and its default portion is "1 oz
  crumbled".
- **Fix:** a reviewed bare default for cooked chicken (e.g. FNDDS "Chicken, NS as to part and cooking method" or a
  cooked breast entry, with a piece portion). Or, if no single default is defensible, refuse and suggest.
- **Tests:** "chicken", "1 piece chicken" and "chicken and rice" never log a raw ground entry.
- **API:** none.

**P0-5. A count of a piece food uses a recipe-yield "serving": "1 rasgulla" = 342 g / 406 kcal.**

- **Evidence:**

  | Phrase | Logged |
  |---|---|
  | 1 rasgulla | 342 g, 406 kcal; "2 rasgulla" 684 g |
  | 1 plate manchurian | 740 g |
  | handvo | "1 cake" 697 g |
  | pav bhaji | 581 g |
  | paneer tikka | "1 plate" 439 g |
  | sweet corn soup | "1 bowl" 392 g |

  Files: `scripts/indb-totals.mjs` (`indbServing`, `PIECES`), `units.ts` (`resolvePortion`).
- **User impact:** one sweet is logged as ~3–4 pieces with syrup. Several dishes are logged at 1.5–3x a single
  serving.
- **Root cause:**
  - INDB's serving weight is the cooked recipe divided by the cookbook's serving count.
  - The build relabels an implausible piece as "1 serving", but at runtime a bare count ("1 rasgulla") still resolves
    to that serving.
  - There is no runtime piece-weight range (M3.1, not done).
- **Fix:**
  1. Runtime piece ranges (M3.1). A count of a piece food whose only portion is a non-piece serving outside the
     range is flagged and not logged at that weight.
  2. Cap INDB default servings at a plausible single-person size, or prefer a cited piece weight.
  3. Add cited piece weights for the top sweets.
- **Tests:**
  - "1 rasgulla" is never > 100 g unflagged
  - "1 plate manchurian" is within a single-plate range
  - existing piece foods (idli 38 g, samosa 100 g) unchanged
- **API:** none.

### P1: significant accuracy or reliability

**P1-1. The AI meal parse's `grams` contract is ambiguous (total vs per piece).**

- **Evidence:**
  - `prompts.ts` `FOOD_ITEMS_SCHEMA.grams` says "Best estimate of the edible weight in grams". The rules list
    *per-piece* weights ("1 roti 35-40 g").
  - `resolvePhrase` / `estimateItem` use `grams` as the total for the whole quantity (`providedPortion`).
- **Impact:** if a model returns per-piece grams for "3 idli", the item is logged at a third of its weight.
- **Root cause:** the schema description doesn't say "for the whole quantity", and nothing checks grams against the
  quantity.
- **Fix:**
  - state "grams is the total for the whole quantity (2 roti: both)"
  - check `grams / quantity` against the food's piece range; flag outliers
- **Tests:** mocked parse "3 idli, 40 g" is flagged; "3 idli, 120 g" is logged at 120 g.
- **API:** none. Optional, free tier: about 10 Gemini calls to see what the current model actually returns.

**P1-2. "plate" and "bowl" fall back to one item or one cup.**

- **Evidence:**

  | Phrase | Logged | Why |
  |---|---|---|
  | 1 plate idli | 38 g | one idli |
  | 1 plate biryani | 196 g | 1 cup |
  | 1 plate rice | 158 g | 1 cup |
  | dal chawal | 33 g | INDB porridge, wrong dish |

  File: `units.ts` (`resolvePortion` portion-fallback).
- **Impact:** large dishes are underestimated by 2–3x.
- **Root cause:** there is no plate measure. An unknown count unit falls back to the food's default portion (a cup or
  a single piece).
- **Fix:**
  - a plate measure (a documented range, e.g. 250–400 g for rice dishes, or "4 idli")
  - or flag `portionMethod: portion-fallback` as low-confidence in the response
- **Tests:** "1 plate idli" ≥ 3 pieces or flagged; "1 plate biryani" ≥ 250 g or flagged.
- **API:** none.

**P1-3. "with" add-on caps apply to main foods.**

- **Evidence:** "egg curry with rice" → rice 60 g; "idli with sambar" → sambar 60 g. File: `textlog.ts`
  (`addOnPortion`).
- **Impact:** rice or sambar served with a main is undercounted 2–3x.
- **Root cause:** every unquantified "with X" is treated as an add-on, so X is capped at 60 g.
- **Fix:** apply caps only to known condiments and add-ons (sugar, milk, butter, chutney, ketchup …). A staple or dish
  after "with" gets its own serving.
- **Tests:** "coffee with sugar" still 1 tsp; "egg curry with rice" rice ≥ 1 serving.
- **API:** none.

**P1-4. Production still tries `gemini-3.5-flash` first, and OpenAI is still a fallback.**

- **Evidence:** `openai.ts` `GEMINI_HEAVY = ['gemini-3.5-flash', …]`; the OpenAI endpoint is added whenever
  `OPENAI_API_KEY` is set (M1/M2 report §3: 3.5-flash failed 16/18 calls).
- **Impact:**
  - every estimate waits for a failing model (up to 20 s) before the fallback
  - with an OpenAI key in production, failures spend the $5 credit, and gpt-5-mini takes ~38 s, close to the 60 s
    deadline
- **Root cause:** the routing decisions you approved (primary flash-lite, no paid OpenAI) were deliberately not
  implemented under the "do not change routing" restrictions.
- **Fix:**
  - `GEMINI_MODELS.estimateFoods = ['gemini-3.5-flash-lite']` (and review the other tasks)
  - no OpenAI unless explicitly enabled (e.g. `NUTRIKIT_OPENAI_FALLBACK=1`)
  - check production env vars
- **Tests:** provider routing unit tests (order, no OpenAI without opt-in).
- **API:** none.

**P1-5. Approving can approve an estimate the operator never saw.**

- **Evidence:** the admin UI calls `PATCH /v1/admin/food-requests/:id {estimateStatus:'approved'}` by id
  (`MissingFoodsTab.tsx`). `updateFoodRequest` doesn't check which estimate is current. Since M5, a pending estimate
  can be replaced between page load and click.
- **Impact:** a replaced (unreviewed) estimate becomes "approved" and is served to every caller.
- **Root cause:** no optimistic concurrency on review.
- **Fix:** PATCH sends the reviewed estimate's `at`. The server approves only if it matches (409 otherwise); the UI
  reloads. This is additive: without `at`, the current behaviour stays for API clients.
- **Tests:** approve with a stale `at` → 409; approve with the current `at` → ok; a concurrent re-estimate plus
  approve.
- **API:** none.

**P1-6. Catalog values with known reliability problems are served as catalog data.**

- **Evidence (M1 audit):**
  - 34 of 881 INDB dishes fail Atwater by more than 25%
  - INDB kulfi 98 kcal vs CoFID 457; INDB milk cake 127
  - "kulfi" logs INDB, 270 g
  - INDB fried dishes were excluded at build, but other recipe-yield artefacts remain
- **Impact:** some "verified" catalog items are wrong. They look more trustworthy than an AI estimate.
- **Root cause:** published totals are imported as-is; there is no consistency gate in the build.
- **Fix:** a build-time report plus a quarantine list. Drop or flag INDB entries that fail Atwater or disagree more
  than 1.5x with an independent source (set A excluded list). A reviewed decision per dish, not automatic.
- **Tests:** a catalog test: no served entry fails Atwater by more than 25% unless listed with a reason.
- **API:** none.

**P1-7. "chips" means potato crisps: "fish and chips" logs crisps.**

- **Evidence:** "fish and chips" → Fish 270 g + "Potato chips, NFS" 57 g.
- **Impact:** in Indian and UK English, chips are fries. The wrong food has different fat and calories per gram.
- **Fix:** handle the phrase "fish and chips" (fries), and revisit the bare-"chips" default with the owner.
- **Tests:** "fish and chips" → fries.
- **API:** none.

**P1-8. Bare-word defaults that name an arbitrary variant.**

- **Evidence:**
  - "curry" → "Curry, almond, homemade"
  - "spring roll" → meat spring rolls
  - "fruit salad" → "with marshmallows"
  - "butter naan" / "garlic naan" → plain naan (modifier dropped through an alias)
- **Fix:** reviewed `BARE_DEFAULTS` for curry (or refuse and suggest), spring roll (veg), and fruit salad (plain).
  Butter and garlic naan need their own entries or a flag.
- **API:** none.

### P2: coverage and usability

- **P2-1. Operator visibility.**
  - The admin UI shows none of the M4/M5 data: provenance, history, failures, serving quantity, `basis`.
  - It shows the model's self-reported "high confidence" next to AI values, which can read as verified.
  - `web/src/api/admin.ts` types are stale: optional nutrients are typed as numbers, and `estimateFailures`,
    `estimateHistory` and `estimateReviewedAt` are missing.
  - Fix: show versions, history and failures. Replace "{confidence} confidence" with "AI estimate, not verified
    (model said: high)".
- **P2-2. No operator "re-estimate" action (M5 task 5.5).** Rejected and approved estimates can't be refreshed without
  SQL. Old approved estimates with unclear serving labels stay flagged forever.
- **P2-3. Concurrent first estimates of a new food:** two requests can serve different values; first writer wins in
  storage (M5). This is acceptable but inconsistent. A short claim for fresh estimates (like M5) would fix it.
- **P2-4. Units not recognised:**
  - "1 litre milk" (but "1 l" works)
  - "1 spoon sugar" (an Indian usage)
  - "1 can coke"
  - "1 bottle water" → 240 g
- **P2-5. Quantity sanity:** "0 roti" logs a 0 g item; "1000 roti" logs 68 kg. Refuse non-positive quantities; flag
  extreme ones.
- **P2-6. Common dishes missing or unmatched:**
  - paneer butter masala, gulab jamun (no source), chole bhature, kachori, bhel/sev/dahi puri, veg/chicken burger,
    black coffee, boiled/roasted chana, muesli, red sauce pasta, egg biryani
  - "2 roti 1 dal" (no separator) is unmatched entirely
- **P2-7. Estimate keys depend on the AI's food name.** "paneer butter masala" and "butter paneer masala" become
  separate requests and estimates.
- **P2-8. `catalog-match` items carry the catalog's `source` and `confidence: "medium"`.** Only `basis.kind` shows
  that the AI chose the match. Document this, or lower the confidence when the AI and catalog values differ by more
  than 15%.
- **P2-9. Set C is too small and too clean** to guard regressions (it missed P0-1 and P0-2). Add the ~150 everyday
  phrases from this audit as set D, with exact expected foods and amounts. Include production `food_requests` phrases
  only with owner approval.

### P3: future

- **P3-1.** `server/docs/openapi.json` (committed) is stale: no `basis` or `matchedAs`. The live `/openapi.json` is
  generated at runtime and is current. Regenerate on release.
- **P3-2.** Estimate density checks per food category (sweets vs dals vs drinks), not only Atwater and ≤ 900 kcal.
- **P3-3.** Per-provider back-off: today it's per food. During an outage, each stale food still costs one failed call
  per hour.
- **P3-4.** A background re-estimation queue (deliberately absent today).
- **P3-5.** A second portion source for set P (Indian household measures).

## 3. Area-by-area notes

- **Matching** (exact, aliases, normalization, suggestions, partial, multi-item):
  - **Partial and fuzzy paths are guarded:** M7.1 head rule; M7.2 suggestions never logged; M7.3 forms identity-checked.
  - **The exact path is not guarded (P0-2)**, and M7.3's connector drop is too broad (P0-1).
  - Multi-item parsing is reliable with separators (and / with / comma; 12/12 in set C). It fails without one ("2 roti
    1 dal").
  - Ambiguous bare words depend on hand-picked defaults (P0-4, P1-8).
- **Estimation:**
  - Prompts and schemas are strict. Optional nutrients are nullable since M4; required ones are validated (Atwater
    ±25%/30 kcal, ≤ 900 kcal, parts ≤ whole, serving 5–2000 g, quantity 0–50).
  - One retry; a `sameAs` catalog match only within 30%.
  - **Measured bias:** +5% (flash-lite) to +15% (gpt-5-mini), from richer recipe assumptions.
  - **No food-specific density or portion checks** (P3-2, P0-5).
  - **"Looks verified" risks:**
    - approved estimates: `basis.status: "approved"`, documented as reviewed, not verified
    - catalog-match items (P2-8)
    - the admin "high confidence" label (P2-1)
    - INDB catalog values (P1-6)

    Items logged from AI are always `ai-estimate` with `confidence: "low"`. That held in every probe.
- **Portions:**
  - **Correct:** mass, volume via the food's density (200 ml milk = 206 g), katori sizes, spoons through portions,
    serving counts (M3.0), user grams.
  - **Weak:** plates (P1-2), recipe-yield servings (P0-5), add-on caps (P1-3), AI grams contract (P1-1).
  - **No double multiplication found:** user and AI grams are always used as totals (`providedPortion`); counts
    multiply a per-unit weight once.
- **Lifecycle (M4 + M5):**
  - **Safe:** atomic claim and replace (verified with 6 concurrent requests), old estimate served on failure,
    back-off, history 5, failures 5, approved and rejected never auto-changed, legacy estimates re-made once.
  - **Risks:** the review race (P1-5), no re-estimate action (P2-2), first-writer inconsistency (P2-3), and the
    one-time post-deploy burst of legacy re-estimates.
- **API / SDK / docs:**
  - **Consistent:** `basis` (SDK, schema, docs); `matchedAs` (SDK, schema, docs); nullable estimate nutrients (docs;
    items leave them out). The response serializer never strips fields, so additions are safe.
  - **Gaps:** the admin web types (P2-1), the committed openapi.json (P3-1), and the MCP server, which passes items
    through unchanged.

## 4. Production data safety: the legacy-estimate query

`server/scripts/eval/legacy-estimates.sql` was reviewed.

- **It is read-only:** a single `SELECT`, with no columns from migrations 009/010, so it runs before deploying.
- **Caveats:**
  1. `(estimate->>'at')::timestamptz` errors if any row has a malformed `at`. All code paths write ISO strings, but a
     hand-edited row would stop the query.
  2. `last_seen` is also updated by rules-only logging, which never re-estimates. So `legacy_seen_*` is an **upper
     bound**.
  3. A legacy pending food that the catalog now covers is never re-estimated, which is also an over-count. The upper
     bound is the safe direction for a quota estimate.
- I did **not** run it against production. Please run it yourself and share the numbers, as you said:

```bash
psql "$DATABASE_URL" -x -f server/scripts/eval/legacy-estimates.sql
```

## 5. Existing strengths (keep)

- **Evidence-based evaluation:** versioned and hashed sets, cited prices, paired comparisons, and results that can
  be reproduced offline.
- **AI output never presented as catalog data:** `ai-estimate` and `confidence: "low"` on every AI item; `basis` with
  versions; approval is "reviewed", not "verified".
- **Unknown nutrients are never zero:** catalog nulls are kept, estimate nulls are left out, and totals report
  `missingFrom`.
- **The M5 lifecycle is concurrency-safe and failure-safe,** and covered by 15 tests, including concurrency.
- **Suggestions are separate from logging** (didYouMean); the M7.1 head guard on fallback matches; the M7.3 identity
  guard on equivalent forms.
- **Portion arithmetic:** mass, density-based volume, katori sizes and serving counts are correct, and nothing is
  multiplied twice.
- **Test depth:** 475 server and 157 web tests, all using mocked providers.

## 6. Known limitations

- **Accuracy figures are against public references** that models probably saw in training (M1/M2 report §1).
- **The Hindi word table is small and hand-made** (about 30 words). The catalog's Indian coverage depends on INDB,
  whose values have known problems (P1-6).
- **No user-facing uncertainty for portions:** `portionMethod` says how the grams were derived, but there is no
  confidence on the amount.
- **Matching is lexical.** Combination dishes, word order beyond all-words matching, and unseparated multi-item text
  rely on rules.

## 7. Prioritized roadmap (proposed; nothing implemented)

| # | Work | Findings | Effort | API |
|---|---|---|---|---|
| 1 | Revert the standalone "sabzi" drop; keep only "ki/ka/ke sabzi" | P0-1 | small | none |
| 2 | Identity check on exact matches with exemptions; narrow the "chips" synonym | P0-2, P1-7 | medium | none |
| 3 | Reviewed defaults and aliases: roti/chapati → home roti; chicken; curry; spring roll; fruit salad | P0-3, P0-4, P1-8 | small (owner decisions) | none |
| 4 | Runtime piece ranges and a cap on recipe-yield servings (M3.1–3.2) | P0-5 | medium | none |
| 5 | Set D: ~150 everyday phrases with exact expected foods **and amounts**, as a regression gate | P2-9 | medium | none |
| 6 | Review concurrency on approve (`at` check) | P1-5 | small | none |
| 7 | Grams contract and quantity sanity checks | P1-1, P2-5 | small | none (optional ~10 free-tier calls) |
| 8 | Plate measure and add-on scope | P1-2, P1-3 | medium | none |
| 9 | Routing: flash-lite first, OpenAI opt-in only; check production env | P1-4 | small | none |
| 10 | Catalog quarantine report for INDB inconsistencies | P1-6 | medium | none |
| 11 | Admin UI provenance and history; re-estimate action; types | P2-1, P2-2 | medium | none |
| 12 | Units (litre, spoon, can, bottle) and the missing-dish list | P2-4, P2-6 | small to medium | none |

Order rationale:

- Items 1–4 stop silent wrong data.
- Item 5 makes the next changes measurable on realistic input before anything else is tuned.
- Before deploying M4/M5, run the legacy query (§4) and decide on item 9.

## 8. Do not change

- **The suggest-only rule:** a fuzzy respelling (didYouMean) is never logged.
- **The M7.1 fallback guard** (head named, more than 50% coverage) and the M7.3 identity guard on equivalent forms.
- **`ai-estimate` source, `confidence: "low"`** and approval meaning "reviewed, not verified".
- **Null-not-zero** for unknown nutrients, and `missingFrom` in totals.
- **The M5 atomic claim / replace / release,** the back-off, and "never auto-replace approved, never regenerate
  rejected".
- **Additive-only API changes**, and the plain JSON serializer that never strips fields.
- **The evaluation discipline:**
  - versioned sets and results
  - no fabricated references
  - paired comparisons
  - coverage reported alongside accuracy
- **No bulk re-estimation job, and no paid API use** without explicit approval.

---

## Phase 1 status (2026-11-19): P0-1 to P0-5 implemented, uncommitted

| Finding | Change | Where |
|---|---|---|
| P0-1 | "sabzi" is dropped only after ki/ka/ke; "roti sabzi" is never logged as roti alone | `search.ts` (`GENITIVES`, `SABZI`) |
| P0-2 | Exact matches must name the food (`namesFoodExactly`), with documented exemptions; "chips" and "toast" are rewritten only as bare words | `search.ts`, `textlog.ts` |
| P0-3 | roti / rotis / chapati(s) / chapathi / phulka(s) → INDB "Chapati/Roti" (202 kcal per 100 g, 36 g); the commercial chapati stays searchable | `search.ts` (`BARE_DEFAULTS`, provenance in code) |
| P0-4 | Bare "chicken" is asked about, with 5 reviewed cooked suggestions, and never AI-estimated | `search.ts` (`AMBIGUOUS_BARE`), `textlog.ts`, `foodrequests.ts` |
| P0-5 | A count of a sweet (and kulfi) whose only weight can't be one piece is flagged, not logged | `portions.ts` (new), `textlog.ts` |

`namesFoodExactly` exemptions:

- reviewed aliases and `BARE_DEFAULTS`
- a bracketed name or alias
- USDA descriptor words anywhere in the name
- reviewed phrase rewrites, checked against the full name
- link words ignored
- light stems

Everyday phrases (144, scratch evaluation), before → after:

| | Before | After |
|---|---|---|
| Correct | 125 | 124 |
| **Wrong food** | **12** | **3** |
| **Silently dropped** | **2** | **0** |
| Unmatched or flagged | 5 | 14 (+2 correctly not logged, 1 partial) |
| Portions in plausible range | 27/36 | 33/33 |

The 3 remaining wrong foods are P1-8 / out of Phase 1 scope: "chicken fried rice", "chicken tikka", "fruit salad".

Other checks:

- **Set C v2:** 65/72 matched, 0 wrong.
- **Catalog-wide (3,907 exact matches):** 7 refused, all wrong foods.
- **M7.1 refusals** (3) and **M7.3 equivalences** (18) unchanged.
- **Tests:** 486/486 server, 157/157 web, typecheck clean.
