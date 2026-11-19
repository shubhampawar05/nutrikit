# INDB-derived Indian dishes

When a clone of [Indian-Nutrient-Databank-INDB-](https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-)
is present under `server/data/raw/indb/` at build time:

## Published totals (preferred)

If **`INDB.xlsx`** is present, `npm run build:db` imports **~1,014 dishes** with nutrients
**per 100 g as published** in the databank (`source: indb`). These values come from the INDB
pipeline (IFCT, retention factors, cookbook recipes) — they are **not** re-summed from USDA proxies.

### Deep-fried dishes are left out

INDB's cookbook recipes list the whole frying medium ("Fat 480 ml", "Oil 2 C") as an ingredient, and the published
totals count all of it as eaten: a poori comes out at 78 g fat per 100 g (USDA's puri: 25 g). The build reads
`recipes.xlsx` (required alongside `INDB.xlsx`) and leaves out every dish whose recipe has at least 200 ml of oil or
ghee **and** whose published fat is at least 30 g per 100 g (`countsFryingOil` in `scripts/indb-totals.mjs`), about
127 dishes. Pickles, dressings and tadkas keep their oil in the food and stay. USDA and CoFID foods of the same
names (samosa, puri, vada, pakora, fried fish) take their place; dishes no other source has (gulab jamun, bhatura,
kofta curries) are unmatched until a cited recipe adds them. The count is stored as `excludedFried` in the
`indb_source` meta row.

### Piece weights

INDB's per-serving weight is the cooked recipe divided by the cookbook's serving count, so "1 rasgulla" can be 342 g
(several pieces with syrup). A serving named after a piece is kept only inside a believable range for that piece
(`PIECES` in `scripts/indb-totals.mjs`); otherwise it stays "1 serving" and is listed in the build output.

## Compose fallback

If `INDB.xlsx` is **missing** but `recipes.xlsx` exists, the build falls back to composing dishes
from USDA ingredients (`source: recipe`) via `scripts/indb.mjs`. That mode is for coverage only;
macro accuracy is weaker than `INDB.xlsx` totals.

## Manual cited recipes

`server/data/recipes/*.json` adds only **hand-cited** dishes that are still missing or need a
pinned name (e.g. OSR URLs). The build does **not** add a row when the same name is already in the
catalog from a more authoritative source.

## Redistribution

INDB files on GitHub do not state SPDX terms. For a **public or commercial** deployment, confirm
permission with [Anuvaad](https://www.anuvaad.org.in/indian-nutrient-databank/) before shipping.

`ingredient-map.json` is only used for the compose fallback.
