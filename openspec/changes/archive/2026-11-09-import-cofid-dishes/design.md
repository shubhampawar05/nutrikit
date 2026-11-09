# Design

## Context

- CoFID 2021 is one XLSX workbook (4.4 MB) with one row per food (Food Code like `15-146`) across sheets:
  *1.3 Proximates*, *1.4 Inorganics*, *1.5 Vitamins*, *1.6 Vitamin Fractions* and others. Values are per 100 g;
  `N` means "present but not determined", `Tr` means trace.
- CoFID's definitions differ from USDA's in places (user guide 2021): carbohydrate is *available* carbohydrate
  expressed as monosaccharide equivalents and excludes fibre; fibre is given as NSP and, for some foods, AOAC;
  vitamin D includes 25-hydroxy vitamin D3; vitamin E is α-tocopherol equivalents; folate is total food folate.
- The catalog build (`server/scripts/build-db.mjs`) reads USDA CSVs from `data/raw/` (gitignored), resolves
  same-name collisions by label coverage, and writes `data/foods.db` (committed).

## Goals / Non-Goals

**Goals:** every CoFID value traceable to the pinned file; conversions exact or documented with measured error;
no new runtime dependency.

**Non-Goals:** portions, non-dish CoFID foods, MCP filter.

## Decisions

### 1. Pinned source file and a small XLSX reader
The build looks for the gov.uk file under `data/raw/cofid/`, checks its SHA-256 against a constant, and fails on
any other file; it records URL, checksum and licence in `meta.cofid_source`. A missing file skips CoFID with a
warning, so a USDA-only build still works. `scripts/xlsx.mjs` reads the workbook with `node:zlib` (zip central
directory + `sharedStrings.xml` + sheet XML). *Alternative:* an npm XLSX library; rejected to avoid a dependency
for one pinned file.

### 2. Which foods
The groups CoFID itself names as dishes (user guide Appendix B, food sub-group codes): DR Vegetable dishes (309),
MR Meat dishes (151), JR Fish products and dishes (35), CD Egg dishes, CDE Savoury egg dishes, CDH Sweet egg dishes
(17): 512 foods, 166 of them South Asian. The selection is CoFID's taxonomy, not a keyword list of ours. An early
draft took every code ending in `R`; Appendix B shows BR (puddings), DAR (potato products) and BAR (milk products)
are not dishes, so they are excluded. South Asian foods CoFID files elsewhere (plain pilau AC, mixed dahl DB, a
retail tikka masala MIG, two fish curries J) stay out.

### 3. Conversions (`scripts/cofid.mjs`, pure functions)
`N` and blank → absent; `Tr` → 0.

| Key | Rule |
|---|---|
| calories, protein, fat, water, alcohol | as published (CoFID energy uses UK factors and is internally consistent) |
| carbs | exact when every component is measured: glucose + galactose + fructose + (sucrose + maltose + lactose) ÷ 1.05 + starch ÷ 1.1 + oligosaccharide ÷ 1.1 + AOAC fibre. Otherwise documented conversion: starch ÷ 1.1 + total sugars ÷ 1.05 + oligosaccharide ÷ 1.1 + fibre (AOAC, else NSP). Absent if starch, total sugars or both fibres are missing |
| sugar | exact from individual sugars when all are measured, else total sugars ÷ 1.05 |
| fiber | AOAC only; NSP never reported as fibre |
| saturatedFat, monounsaturatedFat, polyunsaturatedFat, transFat, cholesterol | as published (per 100 g food) |
| sodium, potassium, calcium, magnesium, phosphorus, iron, zinc | as published |
| vitaminA (RAE) | retinol + carotene ÷ 12 (carotene is β-carotene equivalents, so this is exact); absent if either is missing |
| vitaminD | cholecalciferol from the fractions sheet; 0 when total vitamin D is 0 or Tr; otherwise absent |
| vitaminE | α-tocopherol from the fractions sheet, otherwise absent |
| vitaminK, thiamin, riboflavin, niacin, vitaminB6, vitaminB12, vitaminC | as published (niacin is preformed niacin) |
| folate, caffeine, addedSugar | absent |

**Measured on the 110 dishes where the exact carbohydrate is computable** (across all `R` groups, before the scope
was corrected): the documented conversion is within median 0.5% and at most 4.3% of the exact value, and covered
502 of 551 dishes against 114 for exact-only. Coverage for the final 512 is recorded in `meta` by the build. Where
both fibres exist, AOAC − NSP has a median of 0.3 g. Publishing CoFID's carbohydrate as-is would be wrong by up
to 60% (no fibre, different units), so it is never used directly.

### 4. Ids and collisions
Id = 800,000,000 + prefix × 10,000 + suffix (`15-146` → 800,150,146): stable, reversible, above every FDC id.
The same-name rule ranks cofid after USDA sources on a tie.

### 5. Aliases
`data/aliases/cofid.json`: `{ alias, cofidCode, cofidName, reference }`. The build checks each code and name
against the workbook and requires a reference URL. Aliases are stored in a new `foods.aliases` column, indexed by
`foods_fts`, and a query equal to an alias scores like an exact head match. Where CoFID has several variants
(Punjabi/Gujarati, ghee/oil), the alias names one and says which.

### 6. Search and API
CoFID fills gaps in USDA's dishes, so it gets no source bonus, and after ranking a USDA food named exactly what was
searched (by head or alias) is moved before every CoFID food. A flat penalty was tried first; CoFID's short names
("Sambar, homemade") still outscored USDA's "Sambar, vegetable stew", which has real portions. Where USDA has no food
named exactly the query ("biryani": USDA only has "Biryani with meat/chicken/vegetables"), the best match wins.
`source` filter, SDK `FoodSource` and OpenAPI add `cofid`.

## Risks / Trade-offs

- **UK recipes, not Indian lab data.** Values describe UK-collected home recipes and samples. Mitigation: the
  source is visible (`source: "cofid"`) and documented; Indian data (IFCT/INDB) can replace them when licensed.
- **No portions.** A cup uses water density and a bare count uses 100 g, labelled in `portionMethod`.
- **Search changes.** New dishes can outrank existing foods. Mitigation: before/after phrase diff against main.
