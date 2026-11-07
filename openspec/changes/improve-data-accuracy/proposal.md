# Proposal

## Why

Nutrikit's focus is now data accuracy, for US and Indian users alike. A read-only audit of the food catalog and of
how every data source flows into responses found that the stored USDA values are mostly sound, but users still get
wrong or silently incomplete answers:

- **Wrong matches.** Prefix matching turns "chole" into reduced-calorie mayonnaise (via "cholesterol-free"). An
  any-word fallback logs "1 cup butter chicken" as a cup of butter (1,664 kcal). "curd" matches tofu, "poha" matches
  groundcherries, and "salmon" and "paneer" miss their USDA entries because USDA names them "Fish, salmon, …" and
  "Cheese, paneer".
- **Wrong portions.** "1 samosa" picks the 25 g small size over the 100 g regular one, and "1 bagel" picks a 46 g
  Bagel Thin. "1 cup, dry, yields" portions weigh the cooked result (barley 740 g) and can feed volume conversion.
- **Dropped or corrupted values.** When two USDA datasets share a food name, the build keeps the first dataset
  rather than the better record. Some Foundation meats have negative carbohydrate (a by-difference artifact). An
  Open Food Facts `null` becomes 0.
- **Silent gaps.** A food without a nutrient leaves it out, and meal totals then add up only the items that have it,
  with no sign that the total is short. `addedSugar` is advertised but present for no catalog food, and the docs
  claim 33 nutrients for every food.
- **Misattributed AI output.** On photo and text logging, the AI's label and confidence are paired with items by
  array position, so one unmatched item shifts every later label.
- **Missing foods.** Common Indian dishes (rajma, chole, khichdi, poha, gulab jamun, lassi, butter chicken, …) are
  not in the catalog.

## What Changes

- **Correctness fixes:** AI recognition is paired with its own item; Open Food Facts `null` stays missing; the
  AI label path returns the same warnings as the text path.
- **Catalog build:** negative values are clamped to 0, and same-name collisions keep the record with the most
  nutrients (ties go to Foundation). Values from two different foods are never mixed. Build statistics are recorded
  in `meta`.
- **Portions:** "dry, yields" portions are never used for volume conversion; a bare count prefers the regular or
  medium size over small, mini or thin.
- **Matching:** whole-word recall comes before prefix recall; USDA's inverted names ("Fish, salmon", "Cheese,
  paneer") match their food; regional words map to the right food (curd → yogurt, chai → tea with milk). A weak
  any-word match is no longer logged as the meal. It is listed as unmatched with suggestions.
- **Missing nutrients are flagged:** every total says how many items lacked a value (`missingFrom`), and the docs
  state the real per-source coverage.
- **Recipe support, no recipe data:** the build can compose dishes from USDA foods, but only from recipe files that
  name a licensed source. Twenty hand-written recipes were added and then removed (`fix/remove-handwritten-recipes`)
  because their quantities had no verifiable source; Indian dishes USDA lacks stay unmatched until licensed data
  (e.g. INDB, with permission) is imported.
- **Accuracy suite:** a catalog audit script (`npm run audit:data`) and extended golden tests covering every case
  above.

**Out of scope:** AI-estimated nutrients, new endpoints or UI, bulk Open Food Facts import, and IFCT 2017 or INDB
data. IFCT is © ICMR-NIN, and INDB has no license and is built on IFCT and two copyrighted cookbooks; INDB is used
only as a private sanity benchmark, and nothing from it enters the repository.

## Capabilities

### New Capabilities

- `food-catalog`: how the read-only catalog is built from open sources, how sources are combined, how gaps and
  invalid values are handled, and how recipes are composed.

### Modified Capabilities

- `food-logging`: unmatched phrases carry suggestions and weak matches are no longer logged; totals flag missing
  nutrients; "chai" means tea with milk; inverted USDA names and regional words match; bare counts prefer regular
  sizes.

## Impact

- **Server**: `scripts/build-db.mjs`, new `scripts/recipes.mjs`, `src/domain/{search,units,textlog,nutrients,
  barcode,label,mealplan,types}.ts`, `src/routes/v1.ts`, `src/schemas.ts`, new `scripts/audit-catalog.ts` and a
  `package.json` script, tests in `test/`.
- **Data**: `data/foods.db` is rebuilt. Food ids are unchanged for every USDA food that is kept.
- **API**: additive only (`match`, `missingFrom`, `unmatched[].suggestions`). A weak match that used to
  be logged now appears in `unmatched`.
- **Docs**: `docs/api.md` (coverage, missing data), `CLEAN-ROOM.md` (recipe support; INDB analysed, not used).
