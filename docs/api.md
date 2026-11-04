# API and features

The full contract is served at `/openapi.json` and rendered at `/docs/reference`.
A copy is checked in at [server/docs/openapi.json](../server/docs/openapi.json) (`npm run openapi` regenerates it).

## Endpoints

| Feature | Endpoint | Tokens | How it works |
|---|---|---|---|
| Food search | `GET /v1/foods/search?q=` | 1 | Full-text search over 13,359 foods, ranked to prefer the plain form ("banana" → *Banana, raw*) |
| Food detail | `GET /v1/foods/{id}` | 1 | 33 nutrients per 100 g, plus household portions |
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
- A bare everyday word means the everyday food: "tea" and "chai" are hot black tea and "salad" is a green salad,
  while "iced tea" or "chicken salad" get what they say. Search lists that food first and keeps the other matches.
- The same food from two data sources appears once in search results.
- Diet filters work from food names, so treat them as best effort.
- Photo and label recognition are only as good as the AI provider.
