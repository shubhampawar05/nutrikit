# Tasks

## 1. Reader and mapping

- [x] 1.1 `scripts/xlsx.mjs`: dependency-free XLSX reader; verify with `test/xlsx.test.mjs` on a workbook built in the test
- [x] 1.2 `scripts/cofid.mjs`: checksum check, dish selection, id mapping and every conversion rule in design §3; verify with `test/cofid.test.mjs` on fixture rows (N/Tr, exact and documented carbs and sugars, AOAC-only fibre, RAE, vitamin D/E fractions, folate absent)

## 2. Catalog build

- [x] 2.1 `build-db.mjs` adds cofid dishes (skips with a warning when the file is absent), `foods.aliases` column indexed by FTS, `meta.cofid_source` and conversion stats; rebuild: 511 cofid foods (one, "Sauerkraut", loses the same-name rule to USDA's survey record)
- [x] 2.2 `test/catalog.test.mjs`: cofid count, id range, spot values equal to the workbook for a few codes

## 3. Aliases and search

- [x] 3.1 `data/aliases/cofid.json` with references, validated by the build; alias equality scored as an exact head; a USDA food named exactly what was searched comes before CoFID dishes (no flat source bonus)
- [x] 3.2 `test/logging.test.mjs`: "1 cup rajma", English names, golden phrases unchanged; before/after phrase diff against main

## 4. API, SDK, docs

- [ ] 4.1 `source` filter, SDK `FoodSource`, OpenAPI add `cofid`
- [ ] 4.2 `docs/api.md`, website docs (data sources, changelog), `README.md` data setup, `CLEAN-ROOM.md`: OGL attribution, conversions and measured error, no portions

## 5. Verification

- [ ] 5.1 `npm run typecheck`, `npm run test:unit`, `npm run build:db`, `npm run audit:data`, `npm run test:e2e`, live `curl /v1/log/text`
