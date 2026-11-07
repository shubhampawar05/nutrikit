# Tasks

- [x] 1. `NUTRIKIT_CATALOG` in `db.ts`; `foods.personal.db` gitignored; `--personal` build that refuses the committed path
- [x] 2. `data/indb/ingredients.json`: 391 INDB ingredients mapped by hand (308 USDA, 6 CoFID ingredients, water, 49 negligible, 26 unmapped), names checked against the catalog
- [x] 3. `scripts/indb.mjs`: units, cooking water from the protein ratio, servings per piece, deep-frying skip, cited aliases (`data/aliases/indb.json`)
- [x] 4. Search: exact name leads; gap sources lead only when exact or USDA has no match; public phrase diff unchanged
- [x] 5. Tests: `test/indb.test.mjs`, `test/personal.test.mjs` (skips without the personal catalog), recipe composer changes
- [x] 6. Docs: `docs/personal-data-pack.md`, `CLEAN-ROOM.md`, `README.md`
