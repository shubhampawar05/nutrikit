# Tasks

## 1. Correctness fixes

- [x] 1.1 Pair AI recognition by phrase index: `resolveItems` records `phraseIndex` (internal), `aiItems` in `routes/v1.ts` reads `out.items[phraseIndex]` and strips the field; verify with an API test whose fake provider returns an unmatched item first
- [x] 1.2 `fromOpenFoodFacts` accepts only finite numbers (incl. the kJ fallback); verify with tests for a `null` nutrient and a `null` kJ value
- [x] 1.3 The AI label path returns the same ml-as-grams warning as the text path; verify with a label-image test whose serving is in ml

## 2. Catalog build

- [ ] 2.1 Clamp negative amounts to 0 and store `meta.clamped`; keep the record with more nutrients on a name collision (tie: foundation > survey > sr_legacy) and store `meta.collisions`; verify by rebuilding and checking counts and that `Broccoli, raw` is the Foundation record
- [ ] 2.2 Add `test/catalog.test.mjs`: no negative values, `meta.clamped` and `meta.collisions` present

## 3. Portions

- [ ] 3.1 `resolvePortion` ignores "yields" portions for volume lookup and conversion; verify "1 cup barley" uses the cooked cup
- [ ] 3.2 Bare counts prefer regular/medium over small/mini/thin, including head-word portions; verify "1 samosa" (regular) and "1 bagel" (90–120 g), with the golden test unchanged

## 4. Matching

- [ ] 4.1 Two-pass recall (whole tokens, then prefixes); verify "chole" no longer reaches cholesterol foods and "chick" still finds chicken
- [ ] 4.2 Inverted category names score their second segment as a head; verify "salmon" and "paneer"
- [ ] 4.3 `coated|breaded|battered` join `SPECIALTY`; `curd`/`dahi` → yogurt; `chai` → "Tea, hot, with milk"; verify "1 chicken breast", "1 cup curd", "bean curd", "a cup of chai"
- [ ] 4.4 Weak matches (fewer than half the query words in the hit's name) go to `unmatched` with `suggestions`; verify "1 cup butter chicken" before recipes exist, and the golden test unchanged

## 5. Missing nutrients and docs

- [ ] 5.1 `sumNutrients` sets `missingFrom`; meal plan day totals add it up; `NutrientMap` schema documents it; verify with unit tests for a partial and a complete total
- [ ] 5.2 `docs/api.md`: per-source coverage table, absent keys, `missingFrom`, `unmatched[].suggestions`, `source: "recipe"`; update the "33 nutrients" claim; `CLEAN-ROOM.md`: recipes are original, INDB only as a local benchmark

## 6. Recipes

- [ ] 6.1 Recipe loader and composer in `build-db.mjs` (validation, reserved ids, aliases in FTS, `source: 'recipe'`), and the `recipe` search bonus; verify the build fails on an unknown fdcId
- [ ] 6.2 Write the first batch in `server/data/recipes/`: rajma, chole, khichdi, poha, gulab jamun, sweet lassi, salted lassi, butter chicken, chicken tikka masala, egg curry, aloo paratha, aloo gobi, pav bhaji, raita, jeera rice, kadhi, bhindi masala, masala dosa, kheer, matar paneer; verify each passes the audit checks and lands in a plausible calorie band

## 7. Accuracy suite and verification

- [ ] 7.1 `npm run audit:data` runs `scripts/audit-catalog.ts`; extend `test/logging-golden.test.mjs` with the US and Indian cases above
- [ ] 7.2 `npm run typecheck`, `npm test`, `npm run build:db`, `npm run audit:data`; `curl /v1/log/text` against `npm run dev`; e2e smoke
