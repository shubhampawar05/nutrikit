# Tasks

## 1. Correctness fixes

- [x] 1.1 Resolve AI items one at a time: add `resolvePhrase` in `textlog.ts` (`resolveItems` loops over it), and `aiItems` in `routes/v1.ts` attaches each item's own recognition; verify with an API test whose fake provider returns an unmatched item first
- [x] 1.2 `fromOpenFoodFacts` accepts only finite numbers (incl. the kJ fallback); verify with tests for a `null` nutrient and a `null` kJ value
- [x] 1.3 The AI label path returns the same ml-as-grams warning as the text path; verify with a label-image test whose serving is in ml

## 2. Catalog build

- [x] 2.1 Clamp negative amounts to 0 and store `meta.clamped`; keep the record with more label nutrients on a name collision (tie: foundation > survey > sr_legacy) and store `meta.collisions`; verify by rebuilding and comparing every swapped record with the previous build
- [x] 2.2 Add `test/catalog.test.mjs`: no negative values, `meta.clamped` and `meta.collisions` present, and the pear, kiwifruit and broccoli collision outcomes pinned

## 3. Portions

- [x] 3.1 `resolvePortion` ignores "yields" portions for volume lookup and conversion; verify "1 cup barley" uses the cooked cup
- [x] 3.2 Bare counts prefer regular/medium over small/mini/thin, including head-word portions; verify "1 samosa" (regular) and "1 bagel" (90–120 g), with the golden test unchanged; "1 naan" uses the whole naan via the shared `names.ts` head segments

## 4. Matching

- [x] 4.1 Two-pass recall (whole tokens, then prefixes); verify "chole" no longer reaches cholesterol foods and "chick" still finds chicken
- [x] 4.2 Inverted category names score their second segment as a head; verify "salmon" and "paneer"
- [x] 4.3 `coated|breaded|battered` join `SPECIALTY`; `curd`/`dahi` → yogurt; `chai` → "Tea, hot, with milk"; verify "1 chicken breast", "1 cup curd", "bean curd", "a cup of chai"
- [x] 4.4 Weak matches (prefix or any-word hits sharing no more than half the phrase's words) go to `unmatched` with `suggestions`; verify "1 cup butter chicken" before recipes exist, the golden test unchanged, and a before/after diff of ~90 US and Indian phrases against `main`; search results report `match`; OpenAPI and SDK types updated

## 5. Missing nutrients and docs

- [ ] 5.1 `sumNutrients` sets `missingFrom`; meal plan day totals add it up; `NutrientMap` schema documents it; verify with unit tests for a partial and a complete total
- [ ] 5.2 `docs/api.md`: per-source coverage table, absent keys, `missingFrom`, `unmatched[].suggestions`, `source: "recipe"`; update the "33 nutrients" claim; `CLEAN-ROOM.md`: recipes are original, INDB only as a local benchmark

## 6. Recipes

- [ ] 6.1 Recipe loader and composer in `build-db.mjs` (validation, reserved ids, aliases in FTS, `source: 'recipe'`), and the `recipe` search bonus; verify the build fails on an unknown fdcId
- [ ] 6.2 Write the first batch in `server/data/recipes/`: rajma, chole, khichdi, poha, gulab jamun, sweet lassi, salted lassi, butter chicken, chicken tikka masala, egg curry, aloo paratha, aloo gobi, pav bhaji, raita, jeera rice, kadhi, bhindi masala, masala dosa, kheer, matar paneer; verify each passes the audit checks and lands in a plausible calorie band

## 7. Accuracy suite and verification

- [ ] 7.1 `npm run audit:data` runs `scripts/audit-catalog.ts`; extend `test/logging-golden.test.mjs` with the US and Indian cases above
- [ ] 7.2 `npm run typecheck`, `npm test`, `npm run build:db`, `npm run audit:data`; `curl /v1/log/text` against `npm run dev`; e2e smoke
