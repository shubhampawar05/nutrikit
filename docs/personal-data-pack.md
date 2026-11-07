# Personal data pack (INDB)

The Indian Nutrient Databank (INDB) has about 1,000 Indian dishes with full ingredient lists, but **no licence**.
Until written permission exists, its dishes can be used only on your own machine. They are built into a separate,
gitignored catalog, `server/data/foods.personal.db`, which is never committed or deployed. The committed
`server/data/foods.db`, the Docker image and the live site stay USDA + CoFID only.

## Build and run it

1. Put INDB's `recipes.xlsx`, `recipes_servingsize.xlsx` (and optionally `recipes_names.xlsx`, `Units.xlsx`) from
   [github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-](https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-)
   in `server/data/raw/indb/` (gitignored). The CoFID workbook should be in `server/data/raw/cofid/` too.
2. Build the personal catalog (the committed one is untouched):

   ```bash
   npm run build:db -w server -- --personal
   ```

3. Run the API against it:

   ```bash
   NUTRIKIT_CATALOG=data/foods.personal.db npm run dev
   ```

The build refuses to write INDB into `data/foods.db`, and the server uses `data/foods.db` unless
`NUTRIKIT_CATALOG` says otherwise. `server/test/personal.test.mjs` runs only where the personal catalog exists.

## How the dishes are calculated

INDB's own nutrient values are **not** used: they come from the IFCT 2017 tables (not distributed) and, for many
dishes, ignore cooking water (rajma 144 kcal per 100 g). Each dish is recomputed instead:

- **Ingredients:** each of INDB's 391 ingredients is mapped by hand to a USDA or UK CoFID food in
  [server/data/indb/ingredients.json](../server/data/indb/ingredients.json). A few have a documented proxy
  (jaggery → brown sugar, garam masala → curry powder). Colours and essences are negligible. 26 Indian ingredients
  USDA lacks stay unmapped.
- **Amounts:** grams as listed; cups are INDB's 240 ml; spoons use the food's own household portions; a sprig uses
  INDB's mint definition (about 3.5 g).
- **Cooking water:** dry pulses and grains absorb water. The cooked weight comes from USDA's own raw and cooked
  forms (protein is conserved in boiling: cooked = dry × protein raw ÷ protein cooked), unless the recipe already
  lists more water. Rajma becomes 110 kcal per 100 g (CoFID's is 106).
- **Servings:** each dish gets INDB's serving as a portion ("1 bowl", "1 parantha"); a serving of several pieces is
  divided. Liquid boiled off (e.g. kheer reduction) isn't modelled, so **per-serving values are the reliable ones**;
  per 100 g can be low for reduced dishes.
- **Skipped, not guessed:** deep-fried dishes (the recipe lists the whole pan of oil, of which the food absorbs an
  unknown share: INDB's own poori is 738 kcal per 100 g), dishes where an unmapped ingredient is 2% or more, and
  dishes whose calories disagree with their protein, carbohydrate and fat (mostly spice mixes). The reasons are in
  the catalog's `meta.indb_source`.
- **Names:** INDB names carry the Hindi name ("Kidney bean curry (Rajmah curry)"). A cited alias list
  ([server/data/aliases/indb.json](../server/data/aliases/indb.json)) picks the plain dish for "kheer" and "poha".
  A USDA food named exactly what was searched still comes first.

## When permission arrives

Record the permission (who granted it, what it covers, the attribution wanted) in `CLEAN-ROOM.md`, then move the
INDB step from the `--personal` build into the normal build and add `indb` to the API's `source` filter.
