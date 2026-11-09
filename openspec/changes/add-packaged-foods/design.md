# Design

## Context

- The Open Food Facts JSONL export is ~80 GB, one product per line (4.9 M lines). Newer records carry
  `nutrition.aggregated_set` with a `source` per nutrient (`packaging`, `manufacturer`, `estimate`) and a basis
  (`per`: `100g`/`100ml`, `preparation`: `as_sold`/`prepared`); older records only the flat `nutriments`
  (`<nutrient>_100g`), where computed values carry the `~` modifier. The live API (v2) returns the flat form.
- India: 26,005 products tagged as sold in India, 10,610 with energy, protein, carbohydrate and fat. US: 999,107 and
  836,507. ("Sold in" includes imports.)

## Decisions

1. **Label values only.** Export: nutrients whose source is `packaging` or `manufacturer`, in g/kcal/kJ. Flat form
   (export and live API): values with the `~` modifier are dropped. `<` values (e.g. "<0.5 g") are kept as printed.
2. **Consistency checks** (`labelIssues`), each with its basis: no negative amounts; energy at most 900 kcal per
   100 g (pure fat at 9 kcal/g); protein + carbohydrate + fat + alcohol at most 101 g per 100 g; sugars within
   carbohydrate, saturated within total fat (1 g rounding); energy within 20% + 20 kcal of the Atwater range
   [4P + 9F, 4P + 4C + 9F + 7A] (the low end allows all carbohydrate to be fibre or polyols). When the label was
   entered per serving, US rounding (21 CFR 101.9(c): 5 kcal, 0.5 g) scaled to 100 g is added to each limit.
   A failure withholds all values: which one was mistyped is unknowable.
3. **Basis.** Export: `aggregated_set.per`. Flat form: `100ml` when the serving (else package) unit is ml, as Open
   Food Facts stores liquids per 100 ml. No density conversion is attempted.
4. **Store.** SQLite, one row per barcode (latest edit wins) in plain columns: nutrients as a JSON array in a fixed
   key order (`meta.nutrient_keys`), the image as "<language>.<revision>", no per-serving copy (computed on read).
   The JSON-object layout was 477 MB for 748k products; the compact one is 141 MB. FTS5 over name and brand,
   `meta.source` with counts by skip reason. Separate from `foods.db`: ODbL share-alike applies to a derived
   database, so it carries its own licence notice.
5. **Live set.** 82% of checked products (610k) have never been scanned on Open Food Facts; 555k have no photo.
   The committed set keeps every product sold in India (9.6k) and US products with at least one unique scan (131k):
   ~140k products, 33 MB, small enough for git and the Docker image. The rest stay reachable through the live API.
6. **Search duplicates.** 45k products repeat another's name, brand and label values under a different barcode;
   search shows one result per product with all barcodes, while each barcode keeps its own row for lookups.
   2,056 names have no Latin letters (imports tagged as sold in the US); they are left out of name search unless
   sold in India, whose labels may use Indian scripts.
7. **Lookup order.** Local store, then Postgres cache, then live API. 12-digit UPC matches its 13-digit form.

## Risks

- Crowd-sourced data: the checks catch inconsistent labels, not consistent ones that are wrong (per-serving values
  entered per 100 g pass if all are scaled together).
- The store is a snapshot; `updatedAt` and `meta.source.newestEdit` show its age.
