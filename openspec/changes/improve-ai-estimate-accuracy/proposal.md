# Proposal: improve AI nutrition estimate accuracy

Status: audit approved 2026-11-19; milestone plan awaiting approval.

## Why

AI estimates cover foods the catalog lacks. Recorded accuracy is poor (30.7% median calorie error, 35% within ±20%
against INDB), but the audit in `design.md` shows the measurement itself can't be trusted:

- INDB, the only reference, has internally inconsistent and implausible values.
- INDB disagrees with USDA and CoFID by 40–60% on staples.
- The same AI scores 17.4% against our cited recipes.
- A previous attempt to compute estimates from USDA ingredients (76facd2) measured no better than the model's own
  figures, because both depend on the model's guess of the recipe.

On top of that, an estimate's portion weight is never validated, and the first answer for a food is reused for
everyone until an operator acts.

## Decisions (approved by the owner)

- **Benchmark first.** No estimation change ships without a measured improvement beyond run-to-run noise.
- **Structured recipe estimation is not implemented** in this change. It is tested only if, after M2, recipe
  assumptions remain the dominant error, and kept only if it measurably helps.
- **References are never fabricated.** The benchmark is as large as the real references allow; 150–200 cases is not
  a target to force.
- **Reviewed AI estimates are never verified records.**
- **No hosting, infrastructure, billing or unrelated work, and no breaking API or SDK changes.**

## What changes

| Milestone | Delivers | Product change? |
|---|---|---|
| M1 Benchmark | Consensus references (set A), audited cited recipes (set B), real phrases (set C), portion set (set P); matching, density and portion scored separately; 3 runs with spread; "before" numbers for today's pipeline | No (eval only) |
| M2 Provider and lever experiments | Gemini vs gpt-5-mini; then reference anchoring, 3-sample median and variant questions, each in isolation; keep only what beats noise | Only the winners |
| M3 Portion validation | `PIECES` moved to shared runtime logic; AI servings checked; verified catalog serving used, or the item flagged | Yes |
| M4 Provenance | `promptVersion`, `calcVersion`, candidates, retries and rejection reasons stored; nullable unsupported nutrients; optional `basis` on logged estimate items | Yes, additive |
| M5 Estimate reuse | Stale, outdated or suspicious pending estimates re-evaluated under control; history kept; operator re-estimate | Yes |
| M6 (conditional) Structured recipes | Experiment only, behind the eval, if M2 leaves recipe error dominant | No, unless it wins |

## Out of scope

Hosting, deployment, production infrastructure, billing, unrelated features, and any change to verified catalog
records.

## Impact

- **Code:**
  - `server/src/domain/foodrequests.ts`
  - `server/src/domain/providers/prompts.ts` and `openai.ts`
  - `server/scripts/eval-estimates.ts` and `indb-totals.mjs` (`PIECES` moves out)
  - a new shared portion-range module
  - `server/src/routes/admin.ts` (re-estimate action)
  - `sdk/js/nutrikit.d.ts` (one optional field)
- **Data:** new benchmark files under `server/data/eval/`. `food_requests.estimate` (jsonb) gains fields and a
  history list. No migration is needed (see design §12).
- **API:** additive only. Logged `ai-estimate` items gain an optional `basis`; admin food requests gain history and
  a re-estimate action. Existing fields, statuses and fallback behaviour are unchanged.
