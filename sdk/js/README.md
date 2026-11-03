# @nutrikit/sdk

[![npm](https://img.shields.io/npm/v/@nutrikit/sdk)](https://www.npmjs.com/package/@nutrikit/sdk)

JavaScript client for the [Nutrikit](https://nutrikit.onrender.com) nutrition API: food search, nutrient
breakdowns, meal logging from text, voice and photos, barcode and nutrition-label scanning, meal plans and a
nutrition advisor.

**[Get a free API key](https://nutrikit.onrender.com/signup)** · [Docs](https://nutrikit.onrender.com/docs#sdk) ·
[API reference](https://nutrikit.onrender.com/docs/reference) ·
[Source](https://github.com/shubhampawar05/nutrikit)

- No dependencies. Works in browsers and Node 18+ (anything with `fetch`).
- TypeScript types included.
- Retries `429`, `502` and `503` responses, honouring `Retry-After`.

## Install

```bash
npm install @nutrikit/sdk
```

## Usage

```js
import { Nutrikit } from '@nutrikit/sdk';

const nk = new Nutrikit({
  apiKey: process.env.NUTRIKIT_KEY,          // nk_… secret key (server-side only)
  baseUrl: 'https://nutrikit.onrender.com',  // the hosted API, or your own Nutrikit server
});

const meal = await nk.logText('2 eggs, a slice of toast and coffee with milk');
meal.totals.calories;   // { amount: 234, unit: 'kcal', dailyValuePercent: 12 }
```

`baseUrl` defaults to the page's own origin in a browser and to `http://localhost:8787` elsewhere, so set it
whenever your API lives on another host. Nutrikit is self-hostable: point `baseUrl` at your own server instead.

### In browsers and mobile apps

Never ship the secret key to a client. Have your server exchange it for a 1-hour access token and hand that over:

```js
// server
const { access_token } = await nk.createAccessToken();

// browser
const client = new Nutrikit({ apiKey: access_token, baseUrl: 'https://nutrikit.onrender.com' });
```

## Methods

| Method | What it does |
|---|---|
| `searchFoods(q, { limit, offset, source })` | Search the food database |
| `getFood(id)` | Nutrients per 100 g and household portions |
| `getNutrients(id, { quantity, unit, grams })` | Nutrients for a portion, with % daily value |
| `listNutrients()` | Every nutrient key, unit and daily value |
| `logText(text, { ai })` | Log a meal from a description |
| `logVoice(transcript, { ai })` | Log a meal from a spoken transcript |
| `logPhoto(image, { mediaType, hint })` | Log a meal from a photo (`File`, `Blob`, `ArrayBuffer`, `Uint8Array`, data URL or base64) |
| `lookupBarcode(code)` | Packaged product by EAN/UPC |
| `parseLabel({ text })` / `parseLabel({ image })` | Read a nutrition label from text or a photo |
| `createMealPlan({ calories, proteinGrams, diet, meals, days, exclude, seed })` | 1–7 day meal plan |
| `askAdvisor(question, { context })` | Nutrition question answered by the server's AI provider (declines medical questions) |
| `getUsage()` | Tokens used this month, by endpoint |
| `createAccessToken()` | Short-lived token for client apps |

Browser-only helpers:

```js
await nk.voiceLog();                                    // speech recognition on the device, then logVoice()
const code = await Nutrikit.scanBarcode(videoElement);  // BarcodeDetector API
```

After each call, `nk.lastUsage` holds `{ charged, remaining }` from the response's token headers.

## Errors

Failed calls throw a `NutrikitError` with `status`, `code` and `retryAfter`:

```js
import { NutrikitError } from '@nutrikit/sdk';

try {
  await nk.searchFoods('banana');
} catch (e) {
  if (e instanceof NutrikitError && e.code === 'quota_exceeded') { /* out of tokens this month */ }
}
```

Quota exhaustion (`quota_exceeded`) is not retried.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | – | Secret key (`nk_…`) or access token (`nkat_…`). Required |
| `baseUrl` | page origin / `http://localhost:8787` | Your Nutrikit server |
| `fetch` | `globalThis.fetch` | Custom fetch implementation |
| `maxRetries` | `2` | Retries for `429`, `502`, `503` |
| `timeoutMs` | `60000` | Per-request timeout |

## License

MIT
