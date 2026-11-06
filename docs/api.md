# API and features

The full contract is served at `/openapi.json` and rendered at `/docs/reference`.
A copy is checked in at [server/docs/openapi.json](../server/docs/openapi.json) (`npm run openapi` regenerates it).

## Endpoints

| Feature | Endpoint | Tokens | How it works |
|---|---|---|---|
| Food search | `GET /v1/foods/search?q=` | 1 | Full-text search over 13,359 foods, ranked to prefer the plain form ("banana" → *Banana, raw*) |
| Food detail | `GET /v1/foods/{id}` | 1 | Up to 33 nutrients per 100 g (see [Missing data](#missing-data)), plus household portions |
| Portion nutrients | `GET /v1/foods/{id}/nutrients?quantity=&unit=` | 1 | Converts "2 medium", "1.5 cups", "12 fl oz" to grams; adds % daily value |
| Text logging | `POST /v1/log/text` | 5 | Rule-based parser; `ai: true` uses the AI provider for free-form text |
| Voice logging | `POST /v1/log/voice` | 5 | The device transcribes; the server cleans filler words and logs it |
| Photo logging | `POST /v1/log/photo` | 20 | AI lists the foods with gram estimates, then matches each to the catalog |
| Barcodes | `GET /v1/barcodes/{ean}` | 5 | Looks up Open Food Facts; cached for 30 days |
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

- Nutrients are USDA averages; branded products come from crowd-sourced Open Food Facts. Not medical advice.
- Portions fall back in order: stated unit → household portion → volume conversion → water density → 100 g.
  Each item's `portionMethod` says which was used.
- An add-on without an amount ("with sugar", "with milk") is a spoonful or a splash: at most 15 g for sugars,
  fats and sauces, 60 g for anything else (`portionMethod` `add-on-smallest-portion`, or `add-on-cap` when the
  food has no portion that small).
- Size words use real servings where the catalog has none, e.g. small, medium and large fries are 71, 117 and
  154 g (`size-serving`). Hot drinks without a size are one cup.
- A bare everyday word means the everyday food: "tea" is hot black tea, "chai" is hot tea with milk (as drunk in
  India) and "salad" is a green salad, while "iced tea" or "chicken salad" get what they say. Search lists that food
  first and keeps the other matches.
- Indian English words mean what they mean in India: "curd" and "dahi" are plain yogurt ("bean curd" is still tofu).
- Search matches whole words first, then word prefixes ("chick"), then any one word, and says which in `match`
  (`all-words`, `prefix`, `any-word`). When logging, a `prefix` or `any-word` match is used only if the food shares
  more than half of the phrase's words; otherwise the phrase is listed in `unmatched` with `reason`
  `no confident match` and `suggestions`, rather than logged as a different food ("butter chicken" is never a cup
  of butter).
- The same food from two data sources appears once in search results. When two USDA datasets list the same name,
  the catalog keeps the record with more Nutrition Facts label nutrients (newest data on a tie) and never mixes
  values from the two.

## Missing data

Nutrikit never fills a gap with a guess or a zero.

- **A nutrient a food has no value for is left out** of `per100g` and of its `nutrients`. It is not `0`.
- **Totals flag gaps.** When some foods in a meal (or a meal-plan day) have no value for a nutrient, that total
  carries `missingFrom`: how many foods lacked it. The amount is then a lower bound. A nutrient no food has is left
  out of the totals.
- **A food the catalog doesn't have** is listed in `unmatched`, never swapped for a different food. With no
  items, `totals` is `{}`.
- **Open Food Facts** values that are blank, `null` or not numbers are left out.

Coverage by source (share of foods with a value):

| Nutrients | USDA survey (FNDDS, 5,431 foods) | USDA SR Legacy (7,688) | USDA Foundation (240) |
|---|---|---|---|
| Calories, protein, fat, carbohydrate | 100% | 100% | 100% |
| Sodium, potassium, calcium, iron | 100% | 96–99% | 99% |
| Fiber, saturated fat, cholesterol | 100% | 93–96% | 22–52% |
| Sugars | 100% | 77% | 31% |
| Vitamins A, C, D, E, K, B12, folate | 100% | 64–94% | 8–32% |
| Trans fat | – | 54% | 13% |
| Added sugars | – | – | – |

Added sugars come only from Open Food Facts and nutrition labels; USDA's food tables don't report them.

### Recipes

Common dishes USDA doesn't have (rajma, chole, khichdi, poha, gulab jamun, lassi, butter chicken, pav bhaji and
others, 20 in all) are foods with `source: "recipe"`. Each is a typical home-style version written for this project
in [server/data/recipes/](../server/data/recipes/): USDA foods with their weights, the water added, the cooked
weight and household portions, plus a `basis` sentence saying what version it is. The catalog build sums the
ingredients and scales them to the cooked weight; cooked ingredients are USDA's unsalted cooked forms, so the
recipe's own salt is the only salt. A nutrient is reported only when every ingredient over 2% of the dish has a
value for it. The build fails if an ingredient is missing or renamed, if the cooked weight is implausible, or if
calories disagree with protein, carbohydrate and fat. Real dishes vary, so treat recipe values as typical, not exact.
To add one, write a recipe file and run `npm run build:db`.
- Diet filters work from food names, so treat them as best effort.
- Photo and label recognition are only as good as the AI provider.
