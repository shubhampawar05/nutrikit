# Clean-room record

Nutrikit offers capabilities comparable to commercial nutrition-AI platforms, but it was
designed and written independently. This file records what informed it.

## Inputs used

- **The public list of capabilities on passio.ai's marketing pages**, as captured in
  `../investigation/` during the earlier website study: food logging from photos, voice and text;
  barcode and nutrition-label scanning; semantic food search; macro- and micronutrient
  breakdowns; meal plans; token-metered API usage; SDK plus REST access. These are generic
  product-category features, and only the feature list was used.
- **Open data and public standards:** USDA FoodData Central, Open Food Facts, the FDA
  Nutrition Facts format and its daily values, and GS1 GTIN check digits.
- **Public platform APIs:** the Web Speech API, the BarcodeDetector API, the Anthropic Messages API and the OpenAI Chat Completions API.
- **UK CoFID 2021** (McCance and Widdowson's Composition of Foods Integrated Dataset, Public Health England, from
  gov.uk): the dishes in its vegetable, meat, fish and egg dish groups, converted to the catalog's nutrient
  definitions (`server/scripts/cofid.mjs`). Crown copyright, Open Government Licence v3.0; the workbook's SHA-256 is
  pinned. Its user guide was read for definitions. Quadram Institute's CoFID API (a separate, non-commercial
  product) was not used.
- **Open Food Facts export** (world.openfoodfacts.org/data, ODbL 1.0 database, DbCL 1.0 contents): products sold in
  India or the US are built into a separate database (`server/scripts/build-packaged.mjs`): the live set,
  `server/data/packaged.db`, is committed under the ODbL with its notice (`server/data/packaged.LICENSE.md`); the
  full set stays local. Only label values that pass consistency checks are kept. Open Food
  Facts' public API and data documentation were read for field meanings; the label checks use US label rounding
  rules (21 CFR 101.9(c)) and Atwater energy factors.
- **ICMR-NIN Dietary Guidelines for Indians 2024** (nin.res.in), Annexure I (printed page 111): the volumes of its four
  standard measuring katoris (360, 200, 155 and 115 ml), used as facts with a citation (`server/src/domain/utensils.ts`).
  Nothing else from the publication is used. Its notice asks for written permission to reproduce its material
  electronically in a product, so confirm with ICMR-NIN before relying on these values commercially.
- **Dish-name aliases** (`server/data/aliases/cofid.json`): each maps a common Indian name to a CoFID dish and cites a
  public reference page that uses the name.
- **Recipes:** the catalog build can compose dishes from USDA foods (`server/scripts/recipes.mjs`), but only from a
  recipe file that names its licensed source; none are shipped. Twenty hand-written recipes were briefly added and
  then removed, so that every value has a verifiable source.
- **Indian Nutrient Databank (INDB)** (github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-): its method
  (composing dishes from ingredients) was read, and its spreadsheets were analysed locally to judge whether a
  licence would be worth asking for. Nothing from it is in this repository: it has no licence, and it is built on
  the © ICMR-NIN Indian Food Composition Tables 2017 and two copyrighted cookbooks. IFCT 2017 itself was not used.

## Inputs deliberately not used

- No Passio SDK, library, app binary, model, or package was downloaded, decompiled, or inspected,
  and REA was not run against any Passio software.
- No Passio API was called, and no Passio account, key, or documentation portal (passio.gitbook.io)
  was used.
- No Passio endpoint names, request or response shapes, field names, error codes, or data were
  copied. Every API shape here (`/v1/log/text`, `nutrients` maps, `portionMethod`, token costs, …)
  was designed for this project.

Passio's licence and Terms of Use prohibit reverse engineering their SDKs and APIs and using
their tools to build competing products. That is why the SDK analysis was declined and this route
taken. Anyone who has accepted Passio's licence terms should review its non-compete clause before
deploying this commercially.
