# Proposal

## Why

Indian dishes USDA and CoFID lack (kheer, poha, dal makhani, butter chicken, pav bhaji, masala dosa, paratha…) are
in the Indian Nutrient Databank (INDB), which has no licence. The owner uses Nutrikit personally and is seeking
permission, and wants the data now without publishing it: the repository is public and the site is live.

## What Changes

- `npm run build:db -- --personal` builds a gitignored `server/data/foods.personal.db` with USDA, CoFID and INDB
  dishes; the committed catalog is unchanged and the build refuses to write INDB into it.
- `NUTRIKIT_CATALOG` points a local server at another catalog file (default `data/foods.db`).
- INDB dishes are recomputed from their ingredient lists (hand-mapped to USDA/CoFID foods), with cooking water from
  USDA's raw/cooked protein ratio and INDB's servings as portions. INDB's own values are not used. Deep-fried dishes
  and dishes with large unmapped ingredients are skipped with a recorded reason.
- Search: a food named exactly what was searched leads; a gap source (CoFID, INDB) leads otherwise only when USDA
  has nothing matching. Public results are unchanged.
- The recipe composer accepts an empty portion list and "minor" ingredients (herb sprigs).

**Out of scope:** publishing INDB data, the API `source` filter, deep-frying absorption.

## Capabilities

### Modified Capabilities

- `food-catalog`: personal-only data packs and how INDB dishes are composed.

## Impact

- Server: `scripts/indb.mjs`, `scripts/build-db.mjs`, `scripts/recipes.mjs`, `src/domain/db.ts`,
  `src/domain/search.ts`, `data/indb/ingredients.json`, `data/aliases/indb.json`, tests.
- Docs: `docs/personal-data-pack.md`, `CLEAN-ROOM.md`, `README.md`. `.gitignore`: `foods.personal.db`.
