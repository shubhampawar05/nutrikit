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
- **Public platform APIs:** the Web Speech API, the BarcodeDetector API, and the Anthropic Messages API.

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
