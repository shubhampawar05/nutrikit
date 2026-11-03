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
| Usage | `GET /v1/usage` | – | Tokens used this month, by endpoint |
| Access tokens | `POST /v1/auth/token` | – | Swaps a secret key for a 1-hour token for apps |

AI-assisted calls also cost **1 token per 1,000 model tokens**.

## Limits and errors

- Every response has `X-Tokens-Charged`, and `X-Tokens-Remaining` when the key has an allowance.
- Out of allowance → `429 quota_exceeded`.
- Too many requests per minute → `429 rate_limited` with `Retry-After`.
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
- Diet filters work from food names, so treat them as best effort.
- Photo and label recognition are only as good as the AI provider.
