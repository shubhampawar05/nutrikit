# Tasks

Each milestone ends with its exit check. The next one starts only after it passes.

**Execution rule (owner, 2026-11-19):**
- M1 and M2 are completed first, and their measured results are shared before any production estimation change.
- M3, M4 and M5 then proceed based on those findings.
- M6 stays conditional.

## 0. Audit (done)

- [x] 0.1 Audit the estimation flow, prompts, models, validation, provenance and the reference data (`design.md`)
- [x] 0.2 Owner approved the revised approach (2026-11-19)

## M1. Benchmark (eval only, no product change)

Done 2026-11-19: sets A, B, C, P under `server/data/eval/sets/` (versioned, hashed), `scripts/eval-estimates.ts`,
`scripts/eval/`, tests in `test/eval-benchmark.test.mjs`, results in `server/data/eval/results/`. Numbers and limits
in `m1-m2-final-report.md`. Set C phrases were written, not exported from production (report §1, limitation 6).

- [x] 1.1 Set A, consensus references:
  - a script lists dishes present in at least 2 independent sources (USDA FNDDS/survey, CoFID, INDB, cited
    published analyses) and keeps those agreeing within 15% on kcal
  - the rest get a reference range, kept only when both ends are sourced
  - every row records its sources, their ids and the preparation
  - no value is typed by hand or produced by an AI
- [x] 1.2 Set B: audit the 28 cited recipes and keep only those with a sourced cooked weight. Record why each one
  is dropped.
- [x] 1.3 Set C: real phrases from `food_requests` (exported locally) that resolve to an A or B reference, plus
  realistic spellings of the same dishes (Hinglish, typos, regional names, multi-item). Each phrase records its
  expected food.
- [x] 1.4 Set P: piece and bowl weights from published household-measure sources, each with its citation.
- [x] 1.5 Extend `eval-estimates.ts`:
  - `--set A|B|C|P`, `--runs 3`
  - matching accuracy (C), density metrics (A, B), portion MAE (P)
  - metrics: calorie MAE, MAPE and median; within ±10% and ±20%; over 50%; protein, carbs and fat MAE; coverage
  - mean ± spread across runs
  - per-dish rows saved
- [x] 1.6 Tests: metric arithmetic, and set integrity (every row has sources; there are no duplicates).
- [x] 1.6a Versioning, so results stay reproducible:
  - every benchmark set carries a `version` and a content hash
  - every result file records the set versions and hashes, `promptVersion` (a hash of the system prompt and
    schema), provider, models, run count, git commit and the catalog build
  - result files are committed under `server/data/eval/results/`
- [x] 1.7 **Exit check:** (before numbers and noise band: report §1-2, summarised in `docs/platform.md`) run today's pipeline (Gemini default) 3× and record the "before" numbers and the noise band
  in `docs/platform.md`.

## M2. Provider and lever experiments (each isolated, same inputs)

- [x] 2.1 Compare Gemini and gpt-5-mini, 3 runs each:
  - identical prompts, inputs, catalog candidates and output schema
  - one pinned model per provider, with no silent fallback inside a run
  - record accuracy, latency per call, token usage, and cost from a dated, cited price table
- [x] 2.2 Reference anchoring: candidates carry kcal *and* protein, carbs and fat; the prompt asks the model to
  reason from them.
- [ ] 2.3 3-sample median, as an isolated experiment, with its token cost reported. **Blocked, not run** (2026-11-20):
  the `median3` variant is implemented in `eval-estimates.ts`; the run on gpt-5-mini got no answer because the
  OpenAI account has no credit (`credit_balance_exhausted`; $0 spent). The report ranks it lowest priority, so it is
  left for when credit (or a paced free-tier Gemini run, 81 calls) is available. Nothing ships on it.
- [x] 2.4 Variant questions (run; no gain, but only on rate-limited runs, report §7): the model names the preparation choice that changes the value most; scored on dishes
  where the choice is given vs not.
- [x] 2.4a Gemini model reliability:
  - every listed Gemini model, 3 runs, one call at a time and paced, so rate limits from parallel runs don't
    distort the result
  - repeated-call failure rate, latency, accuracy and cost from a verified, dated price table
  - no routing change until the report is reviewed
- [x] 2.5 **Exit check:** (no lever kept; estimates moved to gemini-3.5-flash-lite only, report §8.2) keep a change only if its improvement exceeds the M1 noise band without lowering coverage.
  Record every result, kept or not, in `docs/platform.md`.

## M3. Portion validation

- [x] 3.0 Fix the serving-count bug (found by set P). Done 2026-11-19: `servingCount` and `estimateItem` in
  `foodrequests.ts`; tests in `test/portion-serving.test.mjs`.
  - **Cause:** `estimateItem` turns the AI serving into a portion with `amount: 1`, so "2 pieces, 80 g" becomes
    80 g per piece.
  - **Schema:** the serving gains `quantity`, the number of units in the serving. The app then distinguishes the
    serving quantity, the total serving weight and the per-unit weight.
  - **Stored estimates without `quantity`:** parse the count from the label only when it is unambiguous ("2 pieces",
    "3 idlis", "1 bowl"). Ambiguous labels ("2-3 pieces", "a few", "1 plate (2 pieces)") are flagged, never assumed
    to be one.
  - **Scope:** no change to catalog portions or to any other portion path.
  - **Regression tests:** idli, pakora, roti/chapati, puri, samosa, a bowl food, and an ambiguous old label.
- [x] 3.1 (Done: `server/src/domain/portions.ts` is the runtime module; the build's copy in `indb-totals.mjs` is kept
  in step by `test/nutrition-correctness.test.mjs`.) Move `PIECES` into a shared module, `server/src/domain/portions.ts`, used by the catalog build and by
  runtime code.
- [x] 3.2 (Done 2026-11-20: `estimateItem` checks a counted AI piece against `pieceRange`; an implausible one is
  asked about with the reason, never logged. Since P1-1 the AI gives no grams for an amount.) An AI serving outside its food's range is never accepted silently. Use the catalog's verified serving for
  that unit when one exists; otherwise flag the item (`portionMethod` / warning) and fall back to 100 g or ask.
- [x] 3.3 (Done 2026-11-20: `test/ai-portion-range.test.mjs`.) Regression tests: poori, samosa, masala vada, vegetable cutlet, gulab jamun, rasgulla, bhatura, malai
  kofta, chole, dal, roti, kulcha. Test inputs come from fake providers; expected outcomes are range checks, not
  hard-coded nutrient values.

## M4. Provenance

Done 2026-11-19: estimate JSON gains promptVersion, calcVersion, modelVersion, candidates, attempts and
previousProblems; migration 009 adds estimate_failures and estimate_reviewed_at; items gain an optional `basis`.
Tests: `test/estimate-provenance.test.mjs`.

- [x] 4.1 Store `promptVersion`, `calcVersion`, the candidates offered, the attempt number and rejection reasons in
  `estimate` (jsonb).
- [x] 4.2 Allow `sugar`, `fiber`, `saturatedFat` and `sodium` to be null; checks skip null values; totals report
  the gaps as they already do for catalog foods.
- [x] 4.3 Add an optional `basis` to logged `ai-estimate` items (`{ status, provider, model, promptVersion }`);
  update the SDK types and API docs.
- [x] 4.4 Tests: approved estimates stay `ai-estimate` and are never shown as verified; old stored estimates
  without the new fields still load.

## M5. Estimate reuse

Done 2026-11-19; 5.5 done 2026-11-20: `staleReason`,
atomic claim/replace/release in `foodrequests.ts`, migration 010; tests in `test/estimate-reuse.test.mjs`.

- [x] 5.1 Re-evaluate a pending estimate on its next `ai:true` use when it is stale (older than
  `NUTRIKIT_ESTIMATE_MAX_AGE_DAYS`, default 30), outdated (older prompt or calc version), or suspicious (fails
  today's checks, e.g. portion range). The call cap and deadline stay as they are.
- [x] 5.2 Keep the replaced estimate in `estimate.history`. Each of the last 5 entries carries its complete
  provenance: provider, model, prompt version, calc version, timestamp, the full values and serving, and the
  replacement reason.
- [x] 5.3 Make re-estimation concurrency-safe:
  - the replacing write is conditional on the row still holding the estimate that was read (compare `estimate->>'at'`
    and the status in the `UPDATE ... WHERE`)
  - two callers re-estimating at once can't both replace it or lose history
  - the write never touches `approved` or `rejected` rows
- [x] 5.4 A failed re-estimation (AI error, timeout, failed checks) keeps the previous estimate in use, unchanged.
- [x] 5.5 (Done 2026-11-20: `reestimateFoodRequest`, `POST /v1/admin/food-requests/:id/reestimate`, a Re-estimate
  button in /admin; tests in `test/operator-reestimate.test.mjs`.) Add an operator "re-estimate" action. Approved and rejected estimates are never changed automatically.
- [x] 5.6 Tests:
  - stale, outdated, suspicious and approved/rejected cases
  - failure keeps the old estimate
  - concurrent re-estimates (two at once: one wins, history intact)
  - history capped at 5 with full provenance
  - the call cap is respected

## M7. Food matching (separate from estimation accuracy; scored by set C matching)

- [x] 7.1 Fix partial-match false positives first. Done 2026-11-19: `namesHead` in `search.ts`, used by
  `resolvePhrase`; tests in `test/matching-safety.test.mjs`.
  - A prefix or any-word match may be logged only when the food's head name (before the first comma) is covered by
    the phrase. Example: "veg fried rice" must not log "Rissoles, brown rice, fried in vegetable oil".
  - Otherwise return it as a suggestion.
  - Add a regression test for the rissoles case and an audit of similar phrases.
- [x] 7.2 Keep suggestions separate from logging. Done 2026-11-19: `closestWord` consonant-loss exception. A spelling correction stays a `didYouMean` suggestion and is never
  logged automatically. Fix wrong suggestions ("panir" -> "pani").
- [x] 7.3 (Done 2026-11-19: `equivalentQueries`, `identifiedBy` in `search.ts`; `transliterationKey`,
  `catalogSpelling` in `spelling.ts`; set C v2; tests in `test/matching-hinglish.test.mjs`.) Then add normalization and synonyms, each measured on set C:
  - transliteration (aa/a, ee/i, oo/u, th/t, doubled letters, -ai and plural -e endings)
  - Hindi/regional word synonyms (murgh, gosht, kakdi, ...)
  - abbreviations (veg, mix)
  - word order ("gobi aloo")

## M6. Structured recipe estimation (conditional, not scheduled)

- [x] 6.1 Not triggered: M2 did not leave recipe assumptions as the dominant error (report §8.1). Only if M2 leaves recipe assumptions as the dominant error:
  - an eval-only experiment where the model gives raw whole-recipe ingredients plus a cooked yield range
  - the existing composer (`scripts/recipes.mjs`) computes the values
  - it is compared on sets A and B
  - it ships only if it beats the M2 result beyond noise

## Wrap-up

- [x] 7.1 Full test suite passes, including the API, SDK and MCP regression tests (2026-11-20, see the report's §11).
- [x] 7.2 Final report (`m1-m2-final-report.md`, with the 2026-11-20 wrap-up in §11):
  - files changed
  - before and after per set
  - the Gemini vs gpt-5-mini comparison
  - remaining limitations
