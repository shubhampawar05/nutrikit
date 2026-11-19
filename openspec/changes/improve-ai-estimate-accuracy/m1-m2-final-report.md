# Nutrikit AI estimates: M1 + M2 final report

Date: 2026-11-19. Prepared from existing results only: no API call was made to write this report.

Each section labels its statements:

- **Measured:** computed from the saved result files.
- **Assumption:** a judgement or an inference the data does not prove.
- **Missing:** an experiment not run, or not run cleanly.

Every number comes from `server/data/eval/results/*.json` and can be regenerated locally:

```bash
node --import tsx scripts/eval/report.ts <baseline-label> <label>...
```

## 0. Summary

| Question | Answer |
|---|---|
| Is the old "30.7% median error" real? | No. It mixed AI error with INDB reference error. On consensus references the AI's error is much smaller (see §1). |
| Best model measured | `gemini-3.5-flash-lite`: more accurate, ~10x faster and ~2.5x cheaper than gpt-5-mini on the same inputs. |
| Production's first Gemini model | `gemini-3.5-flash` failed 16 of 18 calls for this key. Production pays a failure and a wait before every estimate. |
| Prompt levers | Reference anchoring showed no improvement beyond noise. The variant question showed none either, but only on confounded data. The 3-sample median was not run. |
| Portions | Confirmed bug: a multi-piece AI serving is logged as one piece. Separately, AI piece weights are about 35% off a single-source reference. |
| Matching | 66% of set C phrases matched with no AI. One silent wrong match ("veg fried rice" -> rissoles), one wrong suggestion ("panir" -> "pani"). |
| OpenAI spend | About $0.41 of the $5 credit (§6). No more OpenAI calls will be made. |
| Production code | Not changed in behaviour (§9). |

## 1. Benchmark and its accuracy

### What was built (measured)

| Set | Content | Version / hash |
|---|---|---|
| A | 63 dishes found in 2+ independent sources (USDA, CoFID, INDB). 22 *point* (sources agree within 15%), 19 *range* (15%–1.5x apart), 22 *excluded* (sources disagree more than 1.5x; not scored). | v1 / `3142dbe067f3` |
| B | Cited recipes whose cooked weight needs no yield assumption: 3 of 28 (two lassis, chana chaat). The other 25 rely on an assumed cooking loss. | v1 / `672847ee435d` |
| C | 48 phrases: typos, Hinglish, regional names, multi-item meals. Each points to a set A dish. | v1 / `16f0014957ba` |
| P | 13 piece weights from USDA FNDDS / SR Legacy portions. | v1 / `faf0ed667906` |

- Sets are built by `npm run eval:sets` from source files that hold only ids, codes and reasons. Every value is read
  from `foods.db` and the pinned CoFID workbook.
- The pinned catalog build is `2026-11-19T10:19:26Z`.
- Prompt versions: baseline `f2d48adc5786`, anchored `c979d0186f8e`.

**Measured finding:** for 22 of 63 dishes (35%), the published sources themselves disagree by more than 1.5x. Examples:

| Dish | Values (kcal/100 g) |
|---|---|
| Kulfi | CoFID 457 vs INDB 98 |
| Lentil soup | 31–121 |
| Chole | 107 vs 163 |
| Gajar halwa | 173 vs 354 |
| Sambar | 49–97 |

For these dishes no single "correct" value exists; the recipe decides it.

### Limitations (read before using any number below)

1. **Training-data overlap (assumption, likely).**
   - Set A references are public database entries (USDA FNDDS, CoFID, INDB) that the models have very likely seen.
   - Low error here shows agreement with published tables, not accuracy on an unfamiliar home recipe.
   - The real-world error is probably higher. Against INDB alone, the same pipeline scored about 30% median error
     (`baseline.json`).
2. **The scored dishes are the easy ones (measured).**
   - The 22 dishes where sources disagree most are excluded by design.
   - Those are exactly the dishes where users get the most variable answers.
3. **Ranges are lenient (measured design choice).**
   - Any estimate inside a range scores 0 error.
   - So the overall "median error" is pulled down. The point-only figures below are the stricter measure.
4. **Small sets.**
   - 22 point dishes, 19 ranges, 3 recipes in B, 13 portions in P.
   - Run-to-run spread of the point median is about 3–5 points, so smaller differences are noise.
5. **Set P is single-source and US-sized (measured).**
   - Naan reference is 177 g (a 10" restaurant naan); chapati 68 g (commercial).
   - A home chapati of ~40 g is plausible, so P "errors" partly reflect the reference.
6. **Set C phrases were written, not taken from production logs (measured).**
   - The production `food_requests` table was not read (no approval to access production).
   - The local table has only 3 test phrases.
7. **"Missing food" is simulated.** Every catalog food whose name matches the dish is hidden from the model's
   candidates.
8. **Proxy model (measured).** Production tries `gemini-3.5-flash` first and falls back to flash-lite. These runs
   pinned flash-lite, which is what actually answers today (§3).

## 2. Model comparison (measured; same prompt, inputs, candidates and schema)

All runs below are 3 runs, with spread shown as min–max:

- Gemini: one call at a time, paced 4 s apart.
- OpenAI: concurrency 2 (no rate limits observed).

### Set A: density accuracy

| Metric | gemini-3.5-flash-lite | gpt-5-mini | Difference |
|---|---|---|---|
| Coverage | 100% | 100% | 0 |
| **Point dishes: median error** | **8.8%** (6.7–10.2) | 14.3% (11.2–16.9) | +5.5 pts |
| Point dishes: within ±20% | 80.3% (77.3–81.8) | 68.2% (59.1–77.3) | −12.1 pts |
| Range dishes: inside range | 40.4% (36.8–42.1) | 38.6% (36.8–42.1) | −1.8 pts |
| All scored: median error | 5.6% (5.4–5.7) | 12.4% (10.5–13.7) | +6.8 pts |
| All scored: within ±20% | 82.9% | 69.9% | −13.0 pts |
| Dishes off by more than 50% (per run) | 1 | 2 (1–3) | +1 |
| Calorie MAE (point dishes) | 20.1 kcal | 29.2 kcal | +9.1 |
| Fat MAE | 1.9 g | 2.3 g | +0.4 |

**Paired, on the same 41 dishes:**
- Gemini median 4.9% vs OpenAI 12.2%.
- OpenAI was worse on 22, better on 4, within 2 points on 15.

### Set C: density for real-world spellings

| | Gemini flash-lite | gpt-5-mini |
|---|---|---|
| Point median error | 7.3% (5.1–8.6) | 15.6% (12.2–19.8) |
| All scored within ±20% | 80.5% | 60.2% |
| Off by more than 50% (per run) | 0.3 | 2.7 |

Paired on 41: 4.2% vs 14.0%; OpenAI worse on 30, better on 3.

### Set B (3 dishes, indicative only)

- Gemini: 4.2% median.
- OpenAI: 15.4% median, and one of its three runs timed out entirely (coverage 67%).

### Direction of error, pooled set A runs

| | Above reference | Below reference | Median signed error |
|---|---|---|---|
| Gemini | 65 | 35 | +4.8% |
| gpt-5-mini | 91 | 10 | +15.0% |

- Both overestimate. gpt-5-mini does so systematically.
- The worst dishes for both are rich, recipe-dependent dishes: palak paneer, mooli paratha, chicken korma, moong
  dals, pulao.
- **Assumption:** the model assumes more oil or ghee than the published recipes.

### Not only median error

Gemini flash-lite also wins on:
- latency (3.3 s vs 37.6 s median; 8 s vs 48 s p90)
- cost (§6)
- tail errors (fewer dishes off by more than 50%)

gpt-5-mini wins only on portion MAE (§4).

## 3. Reliability and coverage

| Model | Conditions | Calls | Failed | Median latency | Notes |
|---|---|---|---|---|---|
| gemini-3.5-flash-lite | paced, 1 at a time (5 configs × 3 runs) | 93 | **0** | 2.9–3.3 s | max 11.2 s |
| gemini-3.5-flash-lite | concurrency 2, key shared with other runs | 120 | 33 | ~4 s | 429 rate limits and 503s |
| gemini-3.5-flash (production's first model) | concurrency 2 | 18 | **16** | 10 s on the 2 that answered | 503, 429, timeouts |
| gemini-3.1-flash-lite | concurrency 2, 1 run | 9 | 0 | 3.2 s | 7.7% median error (1 run only) |
| gemini-3.6-flash | concurrency 2, 1 run | 9 | 9 | – | all 429: **inconclusive** (ran while other runs used the key) |
| gemini-3.8-flash | – | 0 | – | – | **missing**: the probe was stopped before it ran |
| gpt-5-mini | concurrency 2 (4 sets × 3 runs) | 66 | 1 | 29–38 s | the failure was the 60 s timeout; p90 48–50 s, max 56 s |

**Measured:**
- On the free tier, flash-lite is fully reliable when calls are spaced out. Concurrent calls hit rate limits:
  28% failed.
- gpt-5-mini runs dangerously close to production's 60 s deadline.

**Assumption:** production traffic on a free-tier key will see 429s under any concurrency. A paid Gemini tier, or
serialized estimate calls, would be needed for real traffic.

**Availability (measured 2026-11-19):**
- The Gemini API still lists `gemini-3.5-flash` (it is not removed), but it failed 16 of 18 calls for this key.
- Google's pricing page no longer lists 3.5 Flash. It lists 3.5 Flash-Lite, 3.1 Flash-Lite, 3.6 Flash and 3.8 Flash.

## 4. Portion findings

### Bug (measured, root cause confirmed in code)

- `estimateItem` (`server/src/domain/foodrequests.ts`) turns the AI serving into a portion with `amount: 1`.
- The serving schema is `{label, unit, grams}`, with no count. So "2 pieces, 80 g" becomes 80 g per piece.

Reproduced without AI:

| Logged | AI serving | Recorded | Should be |
|---|---|---|---|
| "1 idli" | 2 pieces, 80 g | 80 g | 40 g |
| "3 roti" | 2 rotis, 80 g | 240 g | 120 g |
| "1 pakora" | 3 pieces, 75 g | 75 g | 25 g |

Bowl servings are unaffected.

**Frequency (measured on set P):**
- Gemini returned a multi-piece serving in 6 of 39 answers (idli and pakora, in every run).
- gpt-5-mini returned none.

**Effect of the fix (local recomputation, dividing by the count):**
- Gemini's "more than 2x off" cases drop from 6 to 3: idli is fixed.
- Pakora is still about 2x: 25 g vs a 12 g reference.
- The median is unchanged at 33.3%. The fix removes the worst errors rather than moving the median.

### Piece weights in general (measured)

| | Gemini | gpt-5-mini |
|---|---|---|
| Median relative error | 35.6% | 35.8% |
| Within ±25% | 33% | 36% |
| MAE | 34.6 g | 24.1 g |

- Both underestimate large items against the US references: naan 90 vs 177 g, masala dosa 150–180 vs 267 g.
- **Assumption:** part of this is the reference (§1.5). The portion set needs a second, Indian-measure source
  before it can be trusted for precise numbers.

## 5. Food matching findings (rules-based, no AI; separate from estimation)

**Measured on set C:** 66% matched to the right dish.

| Kind | Matched |
|---|---|
| Multi-item meals | 11/11 |
| Hinglish | 11/14 |
| Regional names | 8/13 |
| Variants | 3/5 |
| Typos | 2/10 |

The 18 misses break down as follows:

| Outcome | Count | Detail |
|---|---|---|
| **Wrong food logged silently** | **1** | "veg fried rice" -> "Rissoles, brown rice, fried in vegetable oil". The partial-match rule accepted it because "veg" prefixes "vegetable", although the dish noun "rissoles" isn't in the phrase. |
| Spelling suggestion, right dish | 6 | chapathi, plain prantha, masala dosai, masaala dosa, chiken korma, chicken chowmin. Correctly returned as `didYouMean`, not logged. |
| Spelling suggestion, wrong dish | 1 | "panir" -> "pani" (pani puri) |
| Nothing found | 10 | murgh korma, gosht biryani, kakdi raita, gobi aloo sabzi, yellow moong daal, samose, aloo samosa, mix veg pulao, palak panir, nan |

**Recommendations, in priority order:**
1. **False positives first.** A prefix or any-word match may be logged only when the food's head name (before the
   first comma) is covered by the phrase. Otherwise return it as a suggestion. Then audit the catalog for similar
   cases.
2. **Suggestions stay suggestions.** Keep `didYouMean` as suggest-only, never auto-logged. Stop "panir" -> "pani":
   for example, require the correction to keep the word's length class, or prefer the more common food word.
3. **Then normalization and synonyms, each measured on set C:**
   - transliteration: aa/a, ee/i, oo/u, th/t, doubled letters, Tamil -ai, Hindi plural -e
   - word synonyms: murgh = chicken, gosht = mutton, kakdi/kheera = cucumber, aloo = potato, gobi = cauliflower
   - abbreviations: veg, mix
   - word order: "gobi aloo" = "aloo gobi"

## 6. Cost analysis

### Spend so far

| | Amount | How known |
|---|---|---|
| OpenAI: 4 baseline sets × 3 runs | $0.380 | measured from tokens × list price |
| OpenAI: one earlier smoke run | $0.017 | measured |
| OpenAI: lever run stopped on request, likely 2–4 calls | ~$0.01 | **estimate**: no result file was written |
| **OpenAI total** | **≈ $0.41 of $5** | |
| Gemini | $0 charged (free tier) | The same calls at paid prices would be ≈ $0.42. |

### Projected cost per 1,000 foods estimated (measured tokens × list prices checked 2026-11-19)

| Model | Tokens per food (in / out) | $ per 1,000 foods |
|---|---|---|
| gemini-3.1-flash-lite | 113 / 173 | **0.29** (1 run only) |
| gemini-3.5-flash-lite | 113 / 183 | 0.49 |
| gemini-3.5-flash-lite, anchored prompt | 144 / 183 | 0.50 |
| gpt-5-mini | 180 / 617 | 1.28 |
| gemini-3.6 / 3.8-flash | not measured | list price $0.75 in / $3.75 out per 1M until 2026-12-31, doubling from 2027-01-01 |

- gpt-5-mini costs more mainly because it writes ~3.4x the output tokens (reasoning).
- Estimates are cached per food, so the cost is per *new* food, not per log.

## 7. M2 lever experiments

| Lever | Baseline | New | Difference | Spread across runs | Coverage | Latency | Cost per pass | Verdict |
|---|---|---|---|---|---|---|---|---|
| Reference anchoring (catalog macros in the prompt), Gemini, set A | point median 8.8% | 7.8% | −1.0 pts | 6.7–10.2 → 5.9–10.1 (overlap) | 100% → 100% | 3.3 s → 3.0 s | $0.0202 → $0.0205 | **No measurable gain.** Paired: better 9, worse 6, same 26. Not worth shipping. |
| Variant question (query states the preparation), Gemini, set A | median 5.3%* | 5.1%* | −0.2 pts* | – | *confounded* | – | – | **No evidence of gain**, but only from rate-limited runs (*). Paired: better 11, worse 9. |
| 3-sample median | – | – | – | – | – | – | 3x cost | **Missing**: not run. |
| Same levers on gpt-5-mini | – | – | – | – | – | – | – | **Missing**: stopped to save OpenAI credit. |

\* From the superseded, rate-limited runs in `results/superseded/`. Indicative only.

## 8. Recommended production architecture

Each item is a recommendation; none is applied.

1. **Estimates: keep today's single-step prompt.**
   - No lever beat it beyond noise.
   - Structured recipe estimation (M6) stays unscheduled. The remaining large errors are oil and fat assumptions on a
     handful of rich dishes, which it previously failed to fix (76facd2).
2. **Gemini routing** (change only after your approval and, ideally, the optional check in §10):
   - First: `gemini-3.5-flash-lite` (measured best).
   - Fallback: `gemini-3.1-flash-lite` (0 failures, cheapest, similar accuracy in its single run).
   - Drop `gemini-3.5-flash`: it failed 16 of 18 calls and costs every estimate a wait before the fallback.
   - Keep gpt-5-mini only as a last resort, or remove it. It is the least accurate and the slowest (near the 60 s
     deadline), and it overestimates by +15% on average.
3. **Rate limits:**
   - The free tier fails concurrent calls (28% in our runs).
   - For real traffic: a paid Gemini key, or serialize or queue estimate calls.
   - **Assumption:** current traffic is low enough that cached estimates absorb most of this.
4. **Portions:** add the serving count. Old stored labels are parsed only when unambiguous and flagged otherwise.
5. **Matching:** false-positive guard, and suggestions kept separate from logging (§5).
6. **Provenance and reuse:** prompt and calc versions, re-estimation of stale or suspicious pending estimates with
   history (M4, M5 as specified).
7. **Confidence:** keep AI estimates labelled `ai-estimate` / low confidence. The training-overlap caveat (§1.1)
   means benchmark accuracy should not be shown to users as a guarantee.

## 9. State of the code

- **Added (evaluation only):**
  - `server/scripts/eval/` (set builder, metrics, variants, price table, report)
  - the rewritten `server/scripts/eval-estimates.ts`
  - `server/data/eval/sets/` and `server/data/eval/results/`
  - `server/test/eval-benchmark.test.mjs` (9 tests)
  - the `eval:sets` npm script
  - `.gitignore` entries to keep the sets and results
- **Touched in production files, additively:**
  - The providers' `estimateFoods` and `requestEstimates` accept an optional `prompt` override, used only by the
    eval.
  - `CatalogCandidate` gained optional macro fields.
  - Logging passes neither, so behaviour is unchanged. The typecheck and all 428 server tests passed after the change.
  - It can be reverted if you prefer production files untouched until approval.
- **Not mine:**
  - The working tree also shows changes to `foods.db`, `build-db.mjs`, `indb-totals.mjs`, the recipe aliases, the
    food-catalog spec and three tests. They come from outside this session and were left alone.
  - If `foods.db` is rebuilt again, run `npm run eval:sets`. A hash test will fail until then, by design.
- Nothing is committed.

## 10. Implementation roadmap (for approval)

| Order | Work | Why this order | API calls |
|---|---|---|---|
| 1 | **Portion serving count** (M3.0), with back-compatible label parsing and an ambiguity flag; regression tests for idli, pakora, roti, puri, samosa, a bowl food and an ambiguous label | Confirmed bug, silent wrong grams | 0 (tests use fake providers) |
| 2 | **Matching false positives and suggestion separation** (M7.1–7.2) | A silent wrong food is the worst kind of error | 0 |
| 3 | **Provenance** (M4): prompt and calc versions, candidates, rejection reasons, nullable nutrients, optional `basis` in responses | Needed before reuse logic can reason about versions | 0 |
| 4 | **Estimate reuse** (M5): concurrency-safe re-estimation, failure keeps the old one, history of 5 | Stops one bad answer being permanent | 0 in tests |
| 5 | **Gemini routing change** (§8.2), after approval | Measured; small config change | Optional check below |
| 6 | **Normalization and synonyms** (M7.3), measured on set C | Improves coverage once false positives are fixed | 0 |
| 7 | **Portion range validation** (M3.1–3.2) | Needs a second portion source first | 0 |
| – | M6 structured recipes | Not justified by the data | – |

**Optional free-tier Gemini checks** (only with your approval; paced one call at a time, 4 s apart; $0 on the free
tier; no OpenAI calls):

| Check | Why | Calls |
|---|---|---|
| gemini-3.1-flash-lite, set A, 3 runs | Confirm it as the fallback (now 1 run, unpaced) | 27 |
| gemini-3.6-flash and gemini-3.8-flash, set A, 1 run each | Verify availability and accuracy on the free tier before ruling them in or out | 18 |
| gemini-3.5-flash, set A, 1 run, paced | Confirm the failures aren't only from concurrency | 9 |
| Variant question, clean, 3 runs | The only lever not measured cleanly | 27 |
| 3-sample median, 3 runs | Lowest priority: anchoring showed prompt-side levers move little | 81 |
| **Recommended minimum** | the first three checks | **54** |
