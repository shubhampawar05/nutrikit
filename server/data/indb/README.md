# INDB-derived Indian dishes

When a clone of [Indian-Nutrient-Databank-INDB-](https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-)
is present under `server/data/raw/indb/` at build time:

## Published totals (preferred)

If **`INDB.xlsx`** is present, `npm run build:db` imports **~1,014 dishes** with nutrients
**per 100 g as published** in the databank (`source: indb`). These values come from the INDB
pipeline (IFCT, retention factors, cookbook recipes) — they are **not** re-summed from USDA proxies.

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
