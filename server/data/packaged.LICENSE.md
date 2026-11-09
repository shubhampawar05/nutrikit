# packaged.db: Open Food Facts licence

`packaged.db` is a database derived from [Open Food Facts](https://world.openfoodfacts.org)
(© Open Food Facts contributors). It is made available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); its contents under the
[Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).

It is a separate database from `foods.db` (USDA and UK CoFID) and is not covered by this repository's code licence.
If you redistribute it or a database derived from it, keep this notice, credit Open Food Facts, and share it under
the ODbL. Apps that show its data should display "Data from Open Food Facts contributors" (every API response
carries this in `license`).

**What it holds:** products sold in India, and products sold in the US that someone has scanned at least once on
Open Food Facts, whose label energy, protein, carbohydrate and fat pass Nutrikit's consistency checks. Only values
printed on the label are kept. How it is built: `server/scripts/build-packaged.mjs`; which export and how many
products were kept or skipped, and why: the `meta` table (`source`).
