# Proposal: Portion & Logging Intelligence v2

Status: prerequisites approved by the owner (2026-11-19). Implementation proceeds one increment at a time; the 31
known failures stay visible and are fixed one by one. No implementation has started; feature work is frozen until
both prerequisites are approved.

## Goal

When someone logs an Indian meal in natural language, Nutrikit identifies the foods, preserves the quantities, and
flags any amount it can't support, instead of guessing.

## Prerequisites (delivered for review)

### 1. Set D: everyday regression gate

- **Location:** `server/data/eval/sets/D.source.json` (built into `D.json` by `npm run eval:sets`).
- **Contents:** 217 phrases, each with:
  - the expected behaviour (log, suggest or flag)
  - the expected foods
  - a gram range where a cited portion or measure gives one
  - a rationale and a source
- **Regression cases:** every PR #43 regression (rissoles, roti, rasgulla, roti sabzi, bare chicken).
- **Outcomes:** correct, safely uncertain or incorrect (`npm run eval:everyday`).
- **Gate:** `test/everyday-gate.test.mjs`. It fails on any incorrect case not in `D.known-incorrect.json` and on any
  PR #43 regression.
- **Baseline** (v2 final-review revision, main at f6a23c8, 2026-11-19):

  | Outcome | Cases |
  |---|---|
  | Correct | 179 |
  | Safely uncertain | 7 |
  | Known incorrect | 31 at approval (11 matching findings, P1-8, and 20 measure and plate cases); 28 after increment 1 |
  | Unexpected incorrect | 0 |

  The gate passing means no **unexpected** incorrect case; the 31 known cases are still wrong today and are listed,
  with their reasons, in `server/data/eval/sets/D.known-incorrect.json`. A plate, bowl or katori case is correct only
  with the right food **and** a defensible amount: a cited density, a labelled assumption, or a flag.
- **Owner decisions:** bare "oil" is suggested and bare "raita" asked about (serving-reference.md D8).

### 2. Cited serving reference table

- **Location:** `serving-reference.md`.
- **Contents:** 41 entries (5 high, 24 medium, 7 low, 5 UNKNOWN) from ICMR-NIN, USDA FNDDS and Indian portion
  studies. Every FNDDS figure was checked against the catalog.
- **Adopted definitions:** §D there (katori 200 ml; provisional bowl 200 ml and glass 250 ml; density-based grams;
  no universal plate; sweet ranges as bounds only; exact food identities).

## Increments

1. **Katori = 200 ml** (done, uncommitted): `utensils.ts` takes a katori as NIN's 200 ml; a small or large katori is
   asked about (unmatched, food suggested, `note`), never guessed, and is never covered by an estimate; the nutrients
   endpoint answers 400 `unsupported_unit`. Fixed: "1 katori dal", "2 katori rice", "1 small katori dal". Set D: 182
   correct, 7 safely uncertain, 28 known incorrect, 0 unexpected.

2. **No unsupported density** (done, uncommitted): a volume is weighed only through a USDA household volume portion
   (survey, SR Legacy, Foundation). The water-density fallback is gone, and INDB, recipe, CoFID and AI-estimate
   "cup"/"glass"/"tbsp" portions are no longer used as densities. Such a phrase is unmatched as given, with the food
   suggested and a `note`; the nutrients endpoint answers 400 `unsupported_unit`; stored estimates are not used for
   it. Fixed: "1 katori kheer", "1 katori rajma", "1 glass lassi". Set D: 185 correct, 7 safely uncertain, 25 known
   incorrect, 0 unexpected.

3. **Provisional bowl** (done, uncommitted; owner chose Option 2, 2026-11-19): a bowl is a provisional 200 ml, a
   product assumption and not a measured bowl, weighed only through a USDA density and labelled `assumed-bowl`. A
   food's own "bowl" portion (USDA packaged products, INDB and recipe serving weights, AI estimate servings) is never
   a bowl size, and the one-cup bowl fallback is gone; a bowl of a food with no USDA density is asked about, from text,
   an AI parse or a stored estimate, and the nutrients endpoint answers 400 `unsupported_unit`. Fixed: "1 bowl dal",
   "1 bowl rice", "1 bowl curd", "1 bowl sambar", "1 bowl sweet corn soup", "2 roti and 1 bowl dal". Set D: 191
   correct, 7 safely uncertain, 19 known incorrect, 0 unexpected.

4. **Provisional glass and mug** (done, uncommitted): each is a provisional 250 ml, a Nutrikit assumption, weighed
   only through a USDA density and labelled `assumed-glass` / `assumed-mug`; a glass was 1 US cup and a mug 1½ cups
   before. A food's own glass serving is never the measure; an unsupported one is asked about, from text, an AI parse
   or a stored estimate, and the nutrients endpoint answers 400 `unsupported_unit`. Fixed: "1 glass milk". Set D: 192
   correct, 7 safely uncertain, 18 known incorrect, 0 unexpected.

5. **Plates** (done, uncommitted; owner corrected the earlier approval, 2026-11-19): no plate falls back to a
   food's own or default serving. Only plain cooked white rice has an assumption, 200 ml through USDA density from
   NIN's 1-cup rice serving, labelled `assumed-plate` (NIN does not define a plate). Idli, upma and every other plate
   are asked about, from text, an AI parse or a stored estimate; the nutrients endpoint answers 400
   `unsupported_unit`. Set D "1 plate idli" and "1 plate upma" changed from log to flag (owner-authorised; see
   set-d-v2-changes.md). Two data findings recorded (serving-reference.md D9): idli piece weight, upma energy.
   Set D: 199 correct, 7 safely uncertain, 11 known incorrect (all food matching, P1-8), 0 unexpected.

6. **AI grams contract, P1-1** (done, uncommitted; owner chose "photo uses the rules", 2026-11-20): the AI names
   the food and reads the quantity and unit; the portion rules alone weigh it or ask. There is no grams field in the
   shared types (`Phrase`, the estimate amount) and no `providedPortion`, so no route can pass a model's weight; the
   model isn't asked for grams, and its instructions no longer carry katori, plate or glass weights. Text, voice and
   photo go through one shared resolver (`resolveAiItem`): an invalid quantity is asked about; a photo amount the AI
   is unsure of (low confidence, or no household unit) is asked about; a logged photo item keeps "amount read from
   the photo by AI" in `portionBasis` and the lower confidence. Set D unchanged (no AI path).
   Follow-up (owner review, 2026-11-20): a weight stated in grams or kilograms is read from the original text or
   voice transcript by the rules and beats the AI's reading of that item (`resolveAiMeal`); one that can't be read or
   placed on exactly one food is listed back and the item asked about. Quantity bounds are unit-aware (10 kg, 10 L,
   1000 counted). Known limit: a Hinglish weight the AI translates ("150 g chawal" read as "rice, white, cooked")
   doesn't match and is asked about, never guessed.

7. **Food-matching review of the 11 known failures** (done, uncommitted, 2026-11-20): reviewed per-phrase entries in
   `search.ts`, no global rule changed. Pinned exact dishes: chicken fried rice, fruit salad, chicken wings, mac and
   cheese. Asked about (several foods, no default): egg roll, spring roll, oil, raita, biscuit. Not the same dish:
   chicken tikka (not tikka masala), tandoori chicken (not the CoFID curry; INDB's dish has only a whole-bird
   portion), veg spring roll (never the meat roll), enforced on every match path. Set D: 208 correct, 9 safely
   uncertain, 0 incorrect, 0 unexpected. "Tea and biscuits" and "2 paratha with raita" now expect the
   clear food logged and the ambiguous one asked, scored safely uncertain via a reviewed per-case `uncertain` flag
   (owner decisions). Set D after these: 207 correct, 10 safely uncertain, 0 incorrect, 0 unexpected. Open: "fish and chips" (splits into fish + potato crisps; needs a splitter
   change), and the CoFID-promotion ranking bug behind "chicken wings".

8. **"Chips" in context and fish and chips** (2026-11-20): the meal splitter keeps "fish and/&/with chips" whole when
   the joined phrase is a reviewed ambiguity, and records the food each phrase follows. "fish and chips" (any
   spelling, any quantity, a plate too) is asked about whole, offering fried cod, fried haddock, fried fish and french
   fries; "chips" after egg, steak, burger, fish, cod, haddock or chicken is asked about, offering french fries and potato
   chips, while the main logs as usual. Bare "chips", "chips and salsa" and "chips and dip" are unchanged. A reviewed
   ambiguity is never covered by a stored or new estimate. Tests: test/chips-context.test.mjs and 16 benchmark cases;
   Set D untouched (byte-identical).

## Frozen baseline (owner, 2026-11-20)

Set D v2 is frozen at 217 cases, sha256 `4a8b8693c1c4…` (`server/data/eval/sets/D.json`): 207 correct, 10 safely
uncertain, 0 known incorrect, 0 unexpected (`server/data/eval/results/d-baseline.json`). Expectations are not changed to
improve scores; a new case goes to the food-logging benchmark or a unit test, or into a reviewed Set D v3.

## Then (not started)

- Implement the adopted serving rules.
- All "pending v2" measure and plate cases are cleared and P1-1 is done. Next, as separate workstreams: the 11
  food-matching findings and the two data findings (idli, upma).
- Address P1-2 (plates), P1-3 (add-on caps), P1-1 (AI grams contract), the remaining bare-word ambiguity and admin
  estimate history.
- Each change passes the gate.
