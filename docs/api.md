# API and features

The full contract is served at `/openapi.json` and rendered at `/docs/reference`.
A copy is checked in at [server/docs/openapi.json](../server/docs/openapi.json) (`npm run openapi` regenerates it).

## Endpoints

| Feature | Endpoint | Tokens | How it works |
|---|---|---|---|
| Food search | `GET /v1/foods/search?q=` | 1 | Full-text search over 13,870 foods (USDA plus UK CoFID dishes), ranked to prefer the plain form ("banana" → *Banana, raw*) |
| Food detail | `GET /v1/foods/{id}` | 1 | Up to 33 nutrients per 100 g (see [Missing data](#missing-data)), plus household portions |
| Portion nutrients | `GET /v1/foods/{id}/nutrients?quantity=&unit=` | 1 | Converts "2 medium", "1.5 cups", "12 fl oz" to grams; adds % daily value |
| Text logging | `POST /v1/log/text` | 5 | Rule-based parser; `ai: true` uses the AI provider for free-form text |
| Voice logging | `POST /v1/log/voice` | 5 | The device transcribes; the server cleans filler words and logs it |
| Photo logging | `POST /v1/log/photo` | 20 | AI lists the foods with gram estimates, then matches each to the catalog |
| Barcodes | `GET /v1/barcodes/{ean}` | 5 | The server's local Open Food Facts export first ([packaged foods](#packaged-foods)), then the live Open Food Facts API (cached for 30 days). Label values that contradict each other are withheld and explained in `issues` |
| Packaged-food search | `GET /v1/barcodes/search?q=&country=` | 1 | Products sold in India (`in`) or the US (`us`) by name or brand, from the local export. A product sold under several barcodes is one result, with all of them in `barcodes`. `503 packaged_foods_unavailable` where the server has none loaded |
| Nutrition labels | `POST /v1/labels/parse` | 5 (text) / 20 (photo) | Parses US FDA labels; photos are read by the AI provider |
| Meal plans | `POST /v1/meal-plans` | 20 | 1–7 days, 6 diets, exclusions, scaled to a calorie target; same seed, same plan |
| Nutrition advisor | `POST /v1/advisor` | 5 | Answers a nutrition question with the AI provider. Optional `context` (goals, today's log) tailors it and is treated as data. Medical and out-of-scope questions return `declined: true` |
| Usage | `GET /v1/usage` | – | Tokens used this month, by endpoint |
| Access tokens | `POST /v1/auth/token` | – | Swaps a secret key for a 1-hour token for apps |

AI-assisted calls also cost **1 token per 1,000 model tokens**.

### How a call is charged

1. **Reserve.** Before any work starts, the call's flat cost is reserved against the monthly allowance in one
   atomic step. If it doesn't fit, the call answers `429 quota_exceeded` and does nothing, so parallel
   requests can't overspend. `labels/parse` reserves the photo cost (20) and settles down to 5 for text.
2. **Settle.** A successful call is charged its flat cost plus its AI tokens. The AI tokens can take the balance
   past the allowance by that one call's AI usage. The next call is then refused.
3. **Failures.** A failed call releases its reservation. **If the AI provider already did work** (for example it
   refused the photo, its answer was cut off, or the image wasn't a nutrition label), **the AI tokens it used are
   charged** and the error response carries `X-Tokens-Charged`. Every other failure (validation, `ai_timeout`,
   provider unavailable) costs nothing.

> **Changed:** before this version, failed calls were never charged. Callers who repeatedly send photos the AI
> provider refuses now pay for the model tokens used (usually 1–3 tokens per call).

## Limits and errors

- Every successful metered response has `X-Tokens-Charged`, and `X-Tokens-Remaining` when the key has an
  allowance. Failed calls that were charged AI tokens carry them too.
- Out of allowance → `429 quota_exceeded`.
- Too many requests per minute → `429 rate_limited` with `Retry-After`.
- The AI provider didn't answer in time → `504 ai_timeout` (default 60 s, `NUTRIKIT_AI_TIMEOUT_MS`). Nothing is
  charged; retry.
- Every response carries `X-Request-Id`. Send your own (letters, digits, `-`, `_`, `.`, up to 128) to trace a call
  through the server logs; quote it when reporting a problem.
- The SDK retries `429`, `502` and `503` (not quota errors) and throws `NutrikitError` with `status`, `code` and `retryAfter`.

## SDK

Lives in `sdk/js/`, published as `@nutrikit/sdk`. See its [README](../sdk/js/README.md).

```js
await nk.logPhoto(file, { hint: 'restaurant portion' });
await nk.parseLabel({ text: labelText });
await nk.voiceLog();                                   // browser: Web Speech API
const code = await Nutrikit.scanBarcode(videoElement); // browser: BarcodeDetector API
```

To publish: bump `version` in `sdk/js/package.json`, check with `npm pack --dry-run -w sdk/js`, then `npm publish -w sdk/js`.

## MCP server

`mcp/` exposes the API as tools for Claude and other MCP clients. Build with `npm run build -w mcp`;
setup is in [mcp/README.md](../mcp/README.md).

## Accuracy

- Nutrients are USDA averages, or UK CoFID values for dishes USDA lacks; branded products come from crowd-sourced
  Open Food Facts. Not medical advice.
- Portions fall back in order: stated unit → household portion → volume conversion → water density → 100 g.
  Each item's `portionMethod` says which was used.
- A katori has no standard size, so it is taken in US cups: small ¾ cup, medium 1 cup (the default) and large
  1½ cups. These are Nutrikit's own conventions. It is weighed through the food's own density, from its USDA volume
  portion (`volume-conversion`: a medium katori of dal is 240 g), or as water when the food has none
  (`density-estimate`), never one weight for every food. `portionBasis` says how the katori was taken.
  A bowl has no standard size: it is the food's own bowl portion when it has one, otherwise one cup of the food
  (`portionBasis` says "bowl, taken as 1 cup"), never one of its pieces.
- An add-on without an amount ("with sugar", "with milk") is a spoonful or a splash: at most 15 g for sugars,
  fats and sauces, 60 g for anything else (`portionMethod` `add-on-smallest-portion`, or `add-on-cap` when the
  food has no portion that small).
- Size words use real servings where the catalog has none, e.g. small, medium and large fries are 71, 117 and
  154 g (`size-serving`). Hot drinks without a size are one cup.
- A bare everyday word means the everyday food: "tea" is hot black tea, "chai" is hot tea with milk (as drunk in
  India) and "salad" is a green salad, while "iced tea" or "chicken salad" get what they say. Search lists that food
  first and keeps the other matches.
- Indian English words mean what they mean in India: "curd" and "dahi" are plain, unsweetened whole-milk yogurt, and
  keep a fat level when one is given ("low fat curd", "skim dahi"); "bean curd" is still tofu.
- A food whose leading name is another word plus the food searched is a different food unless that word was searched:
  "raw rice" is white rice, not wild rice; "butter" is not peanut butter; "potato" is not sweet potato.
- "Sweetened yogurt" is USDA's sugar-sweetened flavored yogurt, never "sweetened with low-calorie sweetener" (sugar-free)
  or frozen yogurt; "sweet curd" and "sweet dahi" are its whole-milk version.
- A food named only in another name in parentheses is not matched on one word of it: USDA's "Groundcherries,
  (cape-gooseberries or poha), raw" is not "poha" (flattened rice), but "cape gooseberries" and "poha fruit" still find it.
- A plate or bowl is a cooked dish, never a dry, uncooked grain, flour or pulse: when the best match is one, the next
  match that names the phrase and isn't is used ("1 bowl oats" → oats prepared with water, "1 bowl masoor dal" → the
  dal curry). With none ("1 bowl wheat flour"), the phrase is listed in `unmatched` with a `note` instead of being
  logged at two to three times the dish's calories. A stated weight ("60 g oats") logs the dry food.
- Search matches whole words first, then word prefixes ("chick"), then any one word, and says which in `match`
  (`all-words`, `prefix`, `any-word`). When logging, a `prefix` or `any-word` match is used only if the food shares
  more than half of the phrase's words; otherwise the phrase is listed in `unmatched` with `reason`
  `no confident match` and `suggestions`, rather than logged as a different food ("butter chicken" is never a cup
  of butter).
- Misspellings get a suggestion, never a silent guess. When a search finds no food with all of its words, each word
  the catalog doesn't know is replaced by the closest catalog word (one typing mistake away, two for words of 8
  letters or more); if that finds foods, search returns them with `didYouMean` ("panner" → `paneer`). Logging never
  logs a respelling: the phrase is listed in `unmatched` with `didYouMean`, the phrase respelled ("1 cup panner" →
  "1 cup paneer"), and `suggestions`, so the app can log it once the user confirms. Amount words (bowl, katori,
  plate, glass) are never respelled.
- The same food from two data sources appears once in search results. When two USDA datasets list the same name,
  the catalog keeps the record with more Nutrition Facts label nutrients (newest data on a tie) and never mixes
  values from the two.
- Diet filters work from food names, so treat them as best effort.
- Photo and label recognition are only as good as the AI provider.

## Missing data

Nutrikit never fills a gap with a guess or a zero.

- **A nutrient a food has no value for is left out** of `per100g` and of its `nutrients`. It is not `0`.
- **Totals flag gaps.** When some foods in a meal (or a meal-plan day) have no value for a nutrient, that total
  carries `missingFrom`: how many foods lacked it. The amount is then a lower bound. A nutrient no food has is left
  out of the totals.
- **A food the catalog doesn't have** is listed in `unmatched`, never swapped for a different food. With no
  items, `totals` is `{}`.
- **Open Food Facts** values that are blank, `null` or not numbers are left out, and so are values Open Food Facts
  calculated itself rather than copied from the label (its added-sugar estimates, marked `~`).
- **Open Food Facts labels that contradict themselves are not served.** Volunteers sometimes type per-serving
  figures as per 100 g, or kJ as kcal. A product's values are withheld (`per100g` is `{}` and `issues` says why)
  when any amount is negative, energy is above 900 kcal per 100 g, protein + carbohydrate + fat weigh more than
  100 g per 100 g, sugars exceed carbohydrate or saturated fat exceeds fat, or energy is far from what the protein,
  carbohydrate and fat give. The limits allow for US label rounding (21 CFR 101.9(c)) when the label is per
  serving, and for fibre and sugar alcohols, which give less energy than other carbohydrate.
- **Liquids are per 100 ml.** Open Food Facts records drinks per 100 ml, so a barcode product says what its values
  are per in `basis` (`100g` or `100ml`), and `perServing` is given only when the serving is in the same unit.

Coverage by source (share of foods with a value):

| Nutrients | USDA survey (FNDDS, 5,431 foods) | USDA SR Legacy (7,688) | USDA Foundation (240) | UK CoFID dishes (511) |
|---|---|---|---|---|
| Calories, protein, fat, carbohydrate | 100% | 100% | 100% | 100% (carbohydrate 91%) |
| Sodium, potassium, calcium, iron | 100% | 96–99% | 99% | 97–99% |
| Fiber, saturated fat, cholesterol | 100% | 93–96% | 22–52% | 49–95% |
| Sugars | 100% | 77% | 31% | 98% |
| Vitamins A, C, D, E, K, B12, folate | 100% | 64–94% | 8–32% | 0–97% (no folate; vitamin E, K under 10%) |
| Trans fat | – | 54% | 13% | 85% |
| Added sugars | – | – | – | – |

Added sugars come only from Open Food Facts and nutrition labels; USDA's food tables don't report them.

### Packaged foods

Barcodes and packaged-food search ("parle g", "amul butter") are served from a store built from the
[Open Food Facts](https://world.openfoodfacts.org/data) export. The hosted service ships the **live set**: every
product sold in India, and the US products someone has scanned at least once on Open Food Facts (about 140,000).
Any other barcode is looked up on the live Open Food Facts API, with the same checks. A product is kept only with a
valid barcode, a name, and label values for energy, protein, carbohydrate and fat that pass the checks above;
anything else is left out rather than guessed.

- `updatedAt` says when the product was last edited on Open Food Facts.
- Search lists one result per product: the same name, brand and label values under several barcodes are one
  result, with every barcode in `barcodes`. Products named only in a script other than Latin (imports with Russian,
  Korean or Arabic labels) are found by barcode, not by name, unless they are sold in India.
- The store is a separate database under the ODbL ([licence notice](../server/data/packaged.LICENSE.md)); responses
  carry `source: "openfoodfacts"` and the attribution. See [configuration](configuration.md#packaged-foods) to
  rebuild it or to use the full set of about 750,000 products.

### UK CoFID dishes

Dishes USDA lacks, many of them South Asian home-cooked dishes (rajma, chole, dals, khichdi, aloo gobi, korma…), come
from the UK's *McCance and Widdowson's Composition of Foods Integrated Dataset 2021* (Public Health England) and have
`source: "cofid"`. Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

- **Which foods:** the groups CoFID names as dishes (vegetable, meat, fish and egg dishes), 511 foods. A USDA food
  named exactly what was searched still comes first; CoFID fills the gaps.
- **Values** are CoFID's, converted to the same definitions as USDA's:
  - published as is where they match (energy, protein, fat, fatty acids, minerals, most vitamins);
  - vitamin A as RAE (retinol + carotene ÷ 12), vitamin D as cholecalciferol and vitamin E as α-tocopherol, only
    where CoFID gives those components;
  - carbohydrate as total carbohydrate including fibre: exact from its components where all were measured,
    otherwise starch ÷ 1.1 + total sugars ÷ 1.05 + fibre (median 0.5%, at most 4.3% from the exact value);
  - fibre only from the AOAC method; folate is never given (CoFID's total folate can't be converted to DFE);
  - values CoFID marks "N" (not determined) are absent; "Tr" (trace) is 0.
- **Names:** CoFID names dishes in English ("Curry, red kidney bean, Punjabi, homemade"). Common Indian names
  (rajma, chole, masoor dal, toor dal, khichdi, aloo gobi…) are aliases from a reviewed list
  ([server/data/aliases/cofid.json](../server/data/aliases/cofid.json)), each with a public reference.
- **No household portions:** CoFID doesn't give cup or bowl weights, so "1 cup rajma" uses water density
  (`portionMethod: "density-estimate"`) and "rajma" alone is 100 g (`default-100g`). Give grams for an exact amount.
- **Rebuilding the catalog** needs the CoFID workbook from
  [gov.uk](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid) in
  `server/data/raw/cofid/`; the build checks its SHA-256 and builds without CoFID (with a warning) if it's missing.
