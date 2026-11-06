# Design

## Context

See proposal.md for the motivation and specs/ for the required behavior. Current state:

- **Catalog build** (`server/scripts/build-db.mjs`): reads FNDDS survey, Foundation and SR Legacy CSVs in that
  order, keeps the first record per exact lowercase name, drops foods without calories, stores nutrients as JSON
  per 100 g. 13,359 foods (survey 5,431, SR 7,619, Foundation 309); 38 Foundation records lose to a same-name record.
- **Search** (`src/domain/search.ts`): FTS5 recall with every token as a prefix (`"tok"*`), an any-word retry when the
  all-words query finds nothing (`relaxed`), then a reranker that rewards matches in the name's first segment.
- **Logging** (`src/domain/textlog.ts`): `resolveItems` takes the top search hit for each phrase. A relaxed hit is
  logged with `confidence: 'low'`. Totals come from `sumNutrients` (`src/domain/nutrients.ts`), which sums only the
  keys present.
- **AI** (`src/routes/v1.ts` `aiItems`): pairs `out.items[idx]` with `resolved.items[idx]`, but unmatched phrases are
  removed from `resolved.items`.
- **Barcode** (`src/domain/barcode.ts`): accepts any OFF field that is not `undefined` or `''`, so `null` → 0.

## Goals / Non-Goals

**Goals:**
- Every number is traceable to an open source (USDA, OFF, a printed label, or a recipe of USDA ingredients), or it
  is absent and flagged. Nothing is silently guessed or understated.
- Today's golden results (`server/test/logging-golden.test.mjs`) stay unchanged.
- API changes are additive.

**Non-Goals:**
- AI nutrient estimation, new endpoints or UI, bulk OFF import, IFCT or INDB data.

## Decisions

### 1. Resolve AI items one at a time
`textlog.ts` exposes `resolvePhrase` (one phrase → an item or an unmatched entry); `resolveItems` is a loop over it.
`aiItems` calls `resolvePhrase` per AI item and attaches that item's recognition directly, so there is no index
bookkeeping and no internal field to strip from the response.

### 2. OFF values must be finite numbers
`fromOpenFoodFacts` accepts a field only when `n[field] != null && n[field] !== '' && Number.isFinite(Number(...))`,
and the kJ fallback follows the same rule.

### 3. Build: clamp negatives, keep the better record on a name collision
- A negative amount becomes 0. USDA computes carbohydrate "by difference", and rounding can push it below zero.
  The number of clamped values is stored in `meta.clamped`.
- On a name collision, keep the record with values for more Nutrition Facts label nutrients (13 keys). On a tie,
  the order is Foundation > survey > SR Legacy (newest data first). Counting all 33 keys was tried and rejected:
  it replaced 57 FNDDS 2024 records with SR Legacy 2018 ones just because FNDDS has no trans fat. The losing
  record is not merged in, because two USDA records of the same name are different samples, and mixing their
  values would produce a food nobody measured. Counts are stored in `meta.collisions`. Measured effect: 69
  Foundation records lacking label values give way to the complete SR Legacy record; survey is unchanged.
- *Alternative considered:* fill a Foundation record's gaps from the same-name survey record. Rejected for that
  reason; per-nutrient provenance would be needed to do it honestly.

### 4. Portions
- `resolvePortion` ignores any portion whose label contains "yields" when doing volume lookup or volume conversion.
  It stays in the data and is still used when it is the only portion for a bare count.
- For a bare count, size portions are ordered regular/medium first, then large, then small/mini/miniature/thin.
  Among head-word portions ("1 bagel", "1 Bagel Thin"), a label with a size-down word ranks last.

### 5. Matching
- **Two-pass recall:** whole tokens first (`"tok"`, porter-stemmed by the tokenizer), and prefix tokens (`"tok"*`)
  only when whole tokens find nothing. "chole" no longer reaches "cholesterol"; partial typing ("chick") still works.
- **Inverted category names:** when a name's first segment is a category word (`Fish`, `Cheese`, `Beverages`,
  `Spices`, …), its second segment also counts as the head when scoring. So "Fish, salmon, baked or broiled" and
  "Cheese, paneer" score as heads for "salmon" and "paneer". The rule is data-driven, so it covers ~350 "Fish, …"
  foods, not just salmon.
- **Prepared-form penalty:** `coated`, `breaded`, `battered` join `SPECIALTY`, so a bare "chicken breast" prefers
  the plain roasted entry.
- **Regional words:** `curd`, `dahi` → `yogurt` (whole-token synonym, so "bean curd" is untouched); `chai` → bare
  default "Tea, hot, with milk". That USDA FNDDS entry is sweetened (51 kcal/100 g), which matches Indian chai.
  This replaces the earlier "chai = black tea" rule.
- **Weak matches:** search reports how it matched (`match`: `all-words`, `prefix`, `any-word`; additive). A
  `prefix` or `any-word` hit is logged only when its name contains **more than half** of the phrase's words as whole
  words, counting a word in its typed or synonym form (so "veggie burger" still matches "Veggie burger" although
  "burger" is rewritten to "hamburger"). Otherwise the phrase goes to `unmatched` (`reason: 'no confident match'`) with
  `suggestions`: the hits that share at least one word. "Half" was tried first; it let "butter chicken" log as butter.

### 6. Missing nutrients
`sumNutrients(list)` counts, for each key present in any item, how many items lack it, and sets
`missingFrom: n` on that total when n > 0. Keys present in no item stay absent. Day totals in meal plans sum meal
totals, adding their `missingFrom` counts. The OpenAPI `NutrientMap` gains an optional `missingFrom` integer.

### 7. Recipes
- **Format** (`server/data/recipes/<slug>.json`, one dish per file):
  `{ id, name, category, basis, ingredients: [{ fdcId, food, grams }], water, cookedGrams, portions: [{ label,
  amount, unit, grams }] }`. `basis` says in one sentence what version the recipe represents. Each ingredient
  repeats the catalog `food` name, and the build checks it, so an id that changes meaning in a future USDA release
  fails loudly. Other names go in the dish name's parentheses ("Chole (chana masala, chickpea curry)"), which
  search already indexes, so no alias column is needed.
- **Composition:** nutrients per 100 g = Σ(ingredient per-100 g × grams / 100) × 100 / cookedGrams. Water (which
  adds no nutrients) is listed separately, and `cookedGrams` accounts for water absorbed or cooked off. Ingredients
  are taken in the form the dish uses them, so USDA's cooked values already carry cooking losses, and a separate
  retention-factor table is unnecessary this round. Cooked bases are USDA's **unsalted** SR Legacy forms ("…,
  cooked, boiled, without salt"): FNDDS cooked foods assume salted cooking water (cooked rice 245 mg sodium per
  100 g), which would double-count the recipe's own salt.
- **Missing nutrients:** a nutrient is composed only when every ingredient that is at least 2% of the dish has a
  value; otherwise it is left out rather than understated. Spices and salt therefore never remove a nutrient.
- **Ids:** recipe ids start at 900,000,000, far above any USDA FDC id. They are stable because they are set in the
  file.
- **Validation:** the build fails if a recipe's fdcId is missing from the catalog, its id is duplicated, or its
  composed food fails the audit checks (calories within 25% of Atwater, no negatives).
- **Authorship:** recipes are written for this project from general culinary knowledge. Nothing is copied from INDB,
  cookbooks or websites. After the build, the INDB per-100 g values for the same dishes may be compared locally
  (never committed) as a sanity check.
- **Search:** `source: 'recipe'` gets the same ranking bonus as `survey`. `plate` becomes a count unit ("a plate of
  pav bhaji"); bare "lassi" defaults to sweet lassi; "dal tadka", "dal fry" and "masala chai" are rewritten to the
  USDA "Dal" and to "chai".
- **Composer module:** `scripts/recipes.mjs` (`loadRecipes`, `composeRecipe`) is separate from `build-db.mjs` so its
  checks are unit-tested without a full build.

### 8. Accuracy suite
- `scripts/audit-catalog.ts` → `npm run audit:data`: Atwater check, negatives, sugar/fiber > carbs, coverage by
  source, portion density outliers, and the spot-check phrase table.
- `test/logging-golden.test.mjs` gains cases for every fix above (US and Indian). A new `test/catalog.test.mjs`
  checks the built catalog: no negative values, recipe foods present with expected calories bands, and
  `meta.collisions`/`meta.clamped` present.

## Risks / Trade-offs

- **Weak-match change:** some phrases that used to log a low-confidence item will now be unmatched. Mitigation: the
  half-the-words rule keeps reasonable partial matches, suggestions are returned, and the golden test pins existing
  good results.
- **Recipe values are estimates of a typical home version.** Real dishes vary. Mitigation: each recipe's `basis` is
  documented, `source: "recipe"` is visible to clients, and the docs explain it.
- **Rebuilt catalog:** a name-collision winner can change id (Foundation vs survey). Mitigation: only 38 foods are
  affected, and the old id disappears only for those; `/v1/foods/{id}` returns 404 for a removed id as it does today
  for unknown ids.
