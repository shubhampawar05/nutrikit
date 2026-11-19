# Design: audit of AI nutrition estimates, and the plan

Stage 1 of this change is this audit. No code has changed. Every number below was measured on the repository as of
2026-11-19 (`server/data/foods.db`, `server/data/eval/baseline.json`, commits 76facd2 and d02097e).

## 1. Current estimation flow

```
text / voice / photo
  └─ textlog.logText()            rules-based match against foods.db
       └─ unmatched phrases ──► foodrequests.recordMisses()          counted in food_requests (no user data)
            └─ coverUnknowns()
                 ├─ stored estimate for this phrase? approved (all callers) / pending (ai:true callers) ──► reuse
                 ├─ rejected by an operator? ──► stays unmatched
                 └─ else requestEstimates() ──► provider.estimateFoods()   (≤5 foods per call, one 60 s deadline)
                        ├─ catalogCandidates(): top 5 search hits, with kcal/100 g, offered as "maybe the same dish"
                        ├─ estimateProblem(): sanity checks; failures asked once more, then dropped
                        ├─ sameAs accepted only if the model's own kcal agrees with the catalog food within 30%
                        └─ saved to food_requests.estimate (jsonb) as 'pending'
                 estimateItem(): portion = the person's amount, else the AI's grams, else the AI's one serving;
                                 nutrients = per100g × grams; source 'ai-estimate', confidence 'low'
```

Files: `server/src/domain/foodrequests.ts` (all of the above), `server/src/domain/providers/prompts.ts`
(`ESTIMATE_SYSTEM`, `FOOD_ESTIMATES_SCHEMA`), `server/src/domain/providers/openai.ts` (Gemini and OpenAI routing),
`server/src/routes/v1.ts` (photo/text callers), `server/src/routes/admin.ts` (approve/reject).

## 2. Prompts and models

- One prompt, `ESTIMATE_SYSTEM`. In a single step, the model returns per-100 g values for 8 nutrients (calories,
  protein, fat, carbs, fiber, sugar, saturated fat, sodium), one serving, a self-reported confidence and an
  optional `sameAs`. It is told to assume "the most common home-style recipe".
- Models: with `GEMINI_API_KEY`, `gemini-3.5-flash`, then the flash-lite models; OpenAI `gpt-5-mini` is the fallback.
  Anthropic wins when its key is set. Overrides come from `NUTRIKIT_<GEMINI|OPENAI>_MODEL_ESTIMATE`.
- **Gemini has never been evaluated.** Every recorded run (`docs/platform.md`) used gpt-5-mini.
- There is no prompt version anywhere, so a stored estimate can't be traced to the prompt that made it.

## 3–5. Ingredient quantities, serving sizes and nutrient values

- **Ingredient quantities: none.** The model's per-100 g figures are taken directly. No recipe exists at runtime.
- **Serving size:** the model's `serving.grams`, accepted anywhere from 5 to 2000 g. Food-specific piece ranges
  already exist (`PIECES` in `scripts/indb-totals.mjs`: roti 20–100 g, jamun 15–80 g, …), but only the catalog
  build uses them. Runtime estimates are never checked against them.
- **Nutrient values:** the model's numbers, checked by `estimateProblem()`:
  - Atwater agreement within max(30 kcal, 25%)
  - kcal ≤ 900
  - macros ≤ 100 g
  - sugar ≤ carbs and saturated fat ≤ fat
  - serving between 5 and 2000 g

  There is no check against what that kind of food usually contains (density per category), and every nutrient
  must be a number, so the model can't say "unknown" (null) for sodium or sugar.

## 6. Why the USDA ingredient experiment did not help (76facd2, reverted in d02097e)

What was tried: the model listed what 100 g of the finished dish is made of (ingredients in eaten form, with grams).
Each ingredient was mapped to USDA, and the nutrients were summed.

Measured results:

| Reference | Ingredients composed from USDA | The model's own figures |
|---|---|---|
| INDB (54 dishes) | 34.5% median calorie error | 32.6% |
| Our 28 cited recipes | 20.1% | 17.4% |

The two methods' errors correlated at **0.98–0.99**.

**Root cause:** both methods read the same thing, the model's idea of the recipe. Composing from USDA only replaced
the model's nutrient arithmetic, and that arithmetic was never the problem. The error is in the assumptions:

- how much oil or ghee ends up in the dish
- how much sugar
- how much water is left after cooking (thin lassi vs thick lassi, soup vs gravy)

Asking for ingredients "per 100 g as eaten" also folded the cooking yield into the model's guess, so the
deterministic step had nothing left to correct.

**Implication for the proposed Stage B–D pipeline:** splitting the work into ingredient decomposition, matching
and deterministic calculation is the same experiment with more structure. It adds traceability (we can see which
assumption was wrong) and explicit yield, but nothing measured so far suggests it will improve accuracy. It also
made answers long enough that 37 of 100 dishes timed out at 60 s. It should not be the first thing built. See §9.

## 7. Validation and confidence today

- Arithmetic checks as listed above, with one retry.
- `sameAs` is accepted only when two independent figures agree within 30%. This is good, and the most effective
  lever measured so far: 11 catalog matches had 20% median error, against 38% for foods the model estimated itself.
- Confidence is the model's self-report and isn't used for anything except display. Items are always logged as
  `low`, or `medium` for a catalog match.
- **Provenance is mostly right but thin:**
  - Approval does not make an estimate verified: approved estimates are still `source: 'ai-estimate'`,
    `confidence: 'low'`.
  - Catalog nulls are preserved (`nutrients.ts`).
  - Each stored estimate keeps only the name, values, serving, confidence, provider, model, time and `sameAs`.
    There is no prompt version, no record of the candidates offered, and no rejection reasons.
- **The first answer sticks.** A pending estimate is reused for every later `ai:true` caller until an operator
  acts. One bad sample therefore becomes the answer for everyone, and there is no second opinion.

## 8. Can we trust the reference (INDB)? Not as ground truth.

Measured on `foods.db` and the baseline eval:

1. **Internal consistency.**
   - 34 of 881 INDB dishes fail Atwater by more than 25%. For comparison: CoFID 1 of 467, cited recipes 0 of 28,
     USDA Foundation 0 of 239.
   - 3 of the 94 scored truths in the baseline fail the same check the AI's answers must pass. Almond soup, for
     example, is listed at 79 kcal while its own macros add up to 179.
2. **Implausible values among the worst-scored dishes**, all per 100 g:

   | Dish | INDB value | Typical |
   |---|---|---|
   | Milk cake | 127 kcal | ~350 |
   | Shrikhand | 107 kcal | ~250 |
   | Sweet lemon pickle | 69 kcal | high-sugar food, 200+ |
   | Potato nests (deep-fried) | 111 kcal | — |
   | Wheat flakes | 112 kcal | ~350 dry |
   | Vegetable yakhni | 406 kcal, 44 g fat | a yogurt broth |

   The pattern suggests cooking water and moisture loss are inconsistently accounted for in the published per-100 g
   totals. That is the yield problem, sitting in the reference itself.
3. **It disagrees with independent sources on staples**, in both directions (kcal per 100 g):

   | Dish | INDB | Independent source |
   |---|---|---|
   | Chapati | 202 | 297 (USDA) |
   | Idli | 206 | 128 (USDA survey) |
   | Sambar | 97 | 49 (CoFID), 86 (USDA survey) |

4. **The eval is easier and narrower than real use:**
   - Queries are INDB's full names with variant hints ("Lassi (salted)").
   - Portions are never scored.
   - Deep-fried dishes were excluded from the catalog, so they are absent from the sample. That covers poori,
     bhatura, gulab jamun and kofta, which are exactly the regression foods the brief lists.
   - Two identical runs differ by 3–4 points.

**So "30.7% median error" is mostly a statement about the AI and INDB together, not about the AI.** The same AI
scores 17.4% against our cited recipes. Removing the 3 internally inconsistent truths only moves the median from
30.7% to 29.9%, so most of the gap is recipe variance, not obvious data errors. Neither number is trustworthy enough
to steer prompt work.

The 28 cited recipes are not independent ground truth either. Several use INDB ingredient amounts composed with
USDA values, and their `cookedGrams` is not separately sourced.

## 9. Root causes, ranked by what they cost us

1. **No trustworthy yardstick.** Every past decision was measured against an unreliable reference with ±3–4 points
   of noise. This has to be fixed first, or every later change is a guess.
2. **The dish is underspecified, and the model guesses the variant** (water, oil and sugar content). This is the
   dominant real error, and it can't be fixed by better arithmetic.
3. **The catalog doesn't cover enough, so the AI is asked too often.** Matches are about 2× more accurate than
   estimates.
4. **Portion weight is never validated or measured.** For a logged meal, a 2× serving error matters as much as a
   2× density error.
5. **A single sample, cached forever.** There is no consistency check and no second opinion.
6. **Thin provenance:** no prompt version, candidates or rejection reasons, and nutrients that can't be null.

## 10. Proposed design for Stage 2

**Milestone 1. A benchmark we can trust (no product changes).**
- Reference by consensus, not by a single source. A dish enters set A only when at least 2 independent sources
  (USDA FNDDS/survey, CoFID, INDB, a cited published analysis) agree within 15% on kcal. Otherwise it gets a
  reference *range*, and we score whether the estimate falls inside it.
- Every row carries its sources and preparation details. No values are written by hand or by an AI.
- Set B: cited recipes with ingredient grams and a **sourced** cooked weight. We audit the existing 28 and keep only
  those whose yield is documented.
- Set C: real input phrases (Hinglish, typos, regional names, multi-item meals). The most frequent phrases come from
  the production `food_requests` table, with their reference taken from A or B. Food matching and nutrition are
  scored separately.
- Portion set: piece and bowl weights from published household-measure tables, scored separately from density.
- Metrics:
  - calorie MAE, MAPE and median error
  - share within ±10% and ±20%, and count over 50%
  - protein, carbs and fat MAE
  - portion-weight MAE
  - coverage
- Each configuration is run 3× and reported with its spread.
- The target is 150–200 cases. It will be smaller if consensus references don't exist; we'll report the real count
  rather than pad it.

**Milestone 2. Measure before changing (cheap, about $1 of API calls).**
- Gemini vs gpt-5-mini on the new benchmark: same prompt, same inputs, 3 runs each.
- Then cheap levers, one at a time, each kept only if it beats the noise:
  - **Reference anchoring:** offer 3–5 similar catalog foods *with their macros* as context. Candidates are already
    offered, but only with kcal and only as "same dish?".
  - **Self-consistency:** 3 samples, take the median.
  - **Ask for the variant** ("thick or thin? fried or not?") when the model reports that variant drives most of
    the value.

**Milestone 3. Portions.**
- Move `PIECES` from the build script into a shared runtime table and check AI servings against it.
- When a serving is out of range: use a catalog serving for the same unit, or flag the item. Never accept it
  silently.

**Milestone 4. Provenance (no migration: `estimate` is jsonb).**
- Store `promptVersion`, `calcVersion`, the candidates offered, retry and rejection reasons, and, when built,
  ingredient hypotheses.
- Let `sugar`, `fiber`, `saturatedFat` and `sodium` be null when the model can't support them.
- Keep the existing statuses. Approval stays "AI estimate, reviewed", never "verified".
- API change: one additive optional field (`estimate.basis`) in the logged item. Nothing is removed.

**Milestone 5 (only if Milestone 2 leaves recipe error dominant). Structured recipe estimation.**
- The model gives raw ingredient amounts *for the whole recipe*, plus a cooked yield with a range. Ingredients are
  matched to USDA/CoFID/IFCT raw foods, and the existing deterministic composer (`scripts/recipes.mjs`, which
  already handles `cookedGrams`) does the arithmetic.
- This differs from 76facd2 in one way that matters: yield is a separate, checkable number instead of being hidden
  inside "per 100 g as eaten".
- Kept only if it beats Milestone 2 on sets A and B. Otherwise it stays as provenance (an explanation of the
  estimate), not as the source of the values.

**Out of scope:** hosting, migrations, billing, and unrelated features.

## 12. Estimate reuse (added after review)

How it works today:

- `coverUnknowns()` never asks the AI again for a phrase that has a stored pending or approved estimate.
- `saveEstimate()` only overwrites a pending estimate when a new one is made, which never happens once one exists.
- So the first answer is permanent for every `ai:true` caller unless an operator rejects it.
- Nothing records when it was last checked, what replaced what, or why.

Plan (M5):

- A pending estimate is re-evaluated on its next use when it is any of:
  - **stale**: older than a configurable age
  - **outdated**: made by an older `promptVersion` or `calcVersion`
  - **suspicious**: fails a check that exists now but didn't when it was made, such as the portion ranges
- Re-evaluation stays inside the existing per-call cap (5 foods) and the AI deadline, so it can't run up cost or
  latency.
- The replaced estimate goes into `estimate.history`: the last 5, each with its provenance and the reason it was
  replaced.
- Approved and rejected estimates are never changed automatically. Operators get an explicit "re-estimate" action
  that makes a new pending estimate and keeps the old one in history.
- **Storage:** history lives inside the existing `estimate` jsonb column, so no migration is needed and old rows
  still load. A separate history table would be cleaner for queries. If the owner prefers it, it is a small additive
  migration, but it is not required.

## 11. Decisions (resolved 2026-11-19)

1. Order approved: benchmark first; structured recipes conditional (M6). See `proposal.md`.
2. The eval budget is covered by the approval to run the experiments. Both GEMINI_API_KEY and OPENAI_API_KEY are
   set locally.
3. INDB redistribution permission remains open. It doesn't block the benchmark (INDB is one of several sources and
   is used locally), but it still matters for the catalog.

## Original decision list (for reference)

1. Approve the order: benchmark first, structured recipes only if the data justifies them. This differs from the
   brief's Stage A–E rewrite.
2. Budget for evaluation API calls: Gemini and OpenAI, about 100k tokens per full run, × 3 runs × configurations.
3. INDB redistribution permission is still unconfirmed (`server/data/indb/README.md`). This matters if INDB stays
   one of the consensus references.
