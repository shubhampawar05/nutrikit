# Proposal

## Why

Indian home-cooked dishes are Nutrikit's biggest data gap. The hand-written recipes that filled it were removed
because their quantities had no verifiable source. The UK Composition of Foods Integrated Dataset (CoFID 2021,
McCance and Widdowson's, Public Health England) is Crown copyright under the Open Government Licence v3.0, which
allows commercial use with attribution. Its 512 dishes (CoFID's vegetable, meat, fish and egg dish groups) include
166 South Asian dishes (rajma, chole, dals, khichdi, egg curry, aloo gobi, bhindi, biryani, samosa, pakora,
korma…) with regional and fat variants, and its energy values are internally consistent.

## What Changes

- The catalog build reads the CoFID 2021 workbook (checksum-pinned, from gov.uk) and adds the foods in CoFID's
  dish groups (user guide Appendix B: DR Vegetable dishes, MR Meat dishes, JR Fish products and dishes, CD/CDE/CDH
  Egg dishes) as foods with `source: "cofid"`.
- CoFID values are converted to Nutrikit's nutrient definitions: exactly where the definitions match or an exact
  formula exists, by a documented conversion for total carbohydrate and sugars (measured error median 0.5%, at
  most 4.3%), and left absent otherwise (folate, most vitamin D and E).
- A reviewed alias list maps Indian dish names ("rajma") to CoFID foods, each alias with a public reference.
- The search `source` filter, SDK type, OpenAPI and docs gain `cofid`; docs carry the OGL attribution.

**Out of scope:** CoFID foods outside the dish groups, household portions (CoFID has none; the existing labelled
fallback applies), and the MCP `source` filter (MCP builds against the published SDK).

## Capabilities

### Modified Capabilities

- `food-catalog`: CoFID composite dishes as a source, its conversions, and dish-name aliases.

## Impact

- **Server:** `scripts/build-db.mjs`, new `scripts/xlsx.mjs`, `scripts/cofid.mjs`, `data/aliases/cofid.json`,
  `src/domain/search.ts`, `src/routes/v1.ts`, `data/foods.db` rebuilt (new `aliases` column).
- **API:** additive (`source: "cofid"`).
- **Docs:** `docs/api.md`, website docs, `README.md` (data setup), `CLEAN-ROOM.md`.
