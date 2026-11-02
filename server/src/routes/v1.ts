// Public API: /v1 food search, nutrients, meal logging, barcodes, labels, meal plans, usage and tokens.
// Routes with `config.cost` are authenticated and metered by plugins/metering.ts.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HttpError, bad, jsonBody, readImage, imageFromJson, IMAGE_BODY_LIMIT, type ImageInput } from '../http.ts';
import { ok, errors, cost } from '../schemas.ts';
import { getFood } from '../domain/db.ts';
import { searchFoods } from '../domain/search.ts';
import { NUTRIENTS, scaleNutrients } from '../domain/nutrients.ts';
import { resolvePortion } from '../domain/units.ts';
import { logText, resolveItems } from '../domain/textlog.ts';
import { isValidGtin, lookupBarcode } from '../domain/barcode.ts';
import { parseLabelText } from '../domain/label.ts';
import { generateMealPlan, DIETS } from '../domain/mealplan.ts';
import { getProvider, type AIProvider, type AICapability, type MealRecognition, type LabelReading } from '../domain/providers/index.ts';
import { COSTS, usageSummary, issueAccessToken } from '../domain/auth.ts';

const DISFLUENCIES = /\b(um+|uh+|erm|hmm+|like|you know|i mean|basically|actually)\b[,]?\s*/gi;
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const nonBlank = (maxLength?: number) => Type.String({ minLength: 1, pattern: '\\S', ...(maxLength ? { maxLength } : {}) });
const FoodId = Type.Object({ id: Type.Integer({ minimum: 0 }) });

const imageBody = Type.Object({
  image: Type.String({ description: 'Base64 image or data URL (max 5 MB decoded)' }),
  mediaType: Type.Optional(Type.String({ enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] })),
  hint: Type.Optional(Type.String({ maxLength: 500 })),
});

// Photo and label bodies may be raw image/* bytes, so their schemas document the API but the
// handlers validate (readImage); the per-route validator accepts everything.
const documentOnly = () => () => true;

async function requireProvider<C extends AICapability>(capability: C): Promise<AIProvider & Required<Pick<AIProvider, C>>> {
  const provider = await getProvider();
  if (typeof provider[capability] !== 'function') {
    throw new HttpError(501, 'ai_provider_unavailable', 'this endpoint needs an AI provider; set ANTHROPIC_API_KEY or OPENAI_API_KEY (or NUTRIKIT_AI_PROVIDER) on the server');
  }
  return provider as AIProvider & Required<Pick<AIProvider, C>>;
}

async function aiItems(provider: AIProvider, run: () => Promise<MealRecognition>) {
  const out = await run();
  const resolved = resolveItems(out.items.map((i) => ({ food: i.food, quantity: i.quantity, unit: i.unit, grams: i.grams, text: `${i.quantity} ${i.unit} ${i.food}` })));
  const items = resolved.items.map((item, idx) => ({ ...item, recognition: { label: out.items[idx]?.food, confidence: out.items[idx]?.confidence } }));
  return { meal: out.meal ?? null, ...resolved, items, notes: out.notes, provider: provider.name, usage: out.usage };
}

function labelFromProvider(out: LabelReading) {
  if (!out.isNutritionLabel) throw new HttpError(422, 'not_a_label', 'no nutrition facts panel found in the image');
  const perServing: Record<string, { amount: number; unit: string }> = {};
  for (const n of NUTRIENTS) {
    const v = out.perServing?.[n.key];
    if (v != null) perServing[n.key] = { amount: v, unit: n.unit };
  }
  const per100g = out.servingGrams
    ? Object.fromEntries(Object.entries(perServing).map(([k, v]) => [k, Math.round((v.amount / out.servingGrams!) * 10000) / 100]))
    : null;
  return { servingSize: out.servingSize, servingGrams: out.servingGrams, servingsPerContainer: out.servingsPerContainer, perServing, per100g, warnings: [] };
}

// The provider is checked before the image, so a server without one answers 501 whatever was sent.
async function labelImage(readInput: () => ImageInput) {
  const provider = await requireProvider('readLabel');
  const img = readInput();
  const out = await provider.readLabel({ image: img.image, mediaType: img.mediaType });
  return { body: { source: 'image', provider: provider.name, ...labelFromProvider(out) }, usage: out.usage };
}

export async function v1Routes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const v1 = (cost?: keyof typeof COSTS | 'dynamic') => ({ allow405: true, ...(cost ? { cost } : {}) });

  app.get('/v1/health', {
    config: v1(),
    schema: { summary: 'Service health', security: [], response: { 200: { description: 'OK', type: 'object', properties: { status: { type: 'string' }, provider: { type: 'string' } } } } },
  }, async () => ({ status: 'ok', provider: (await getProvider()).name }));

  app.get('/v1/nutrients', {
    config: v1(),
    schema: {
      summary: 'Nutrient catalog with units and daily values', description: 'Public and free.', security: [],
      response: { 200: { description: 'OK', type: 'object', properties: { nutrients: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' }, dailyValue: { type: ['number', 'null'] }, group: { type: 'string' } } } } } } },
    },
  }, () => ({ nutrients: NUTRIENTS.map(({ key, name, unit, dv, group }) => ({ key, name, unit, dailyValue: dv, group })) }));

  app.get('/v1/foods/search', {
    config: v1('search'),
    schema: {
      summary: 'Search foods', description: cost('search'),
      querystring: Type.Object({
        q: nonBlank(),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000, default: 0 })),
        source: Type.Optional(Type.String({ enum: ['survey', 'foundation', 'sr_legacy'] })),
      }),
      response: { ...ok({ $ref: 'SearchResult#' }), ...errors(400, 401, 429) },
    },
  }, (req) => {
    const { q, limit, offset, source } = req.query;
    return searchFoods(q, { limit, offset, source });
  });

  app.get('/v1/foods/:id(^\\d+$)', {
    config: v1('food'),
    schema: { summary: 'Food detail with per-100 g nutrients and household portions', description: cost('food'), params: FoodId, response: { ...ok({ $ref: 'Food#' }), ...errors(401, 404) } },
  }, (req) => {
    const food = getFood(req.params.id);
    if (!food) throw new HttpError(404, 'not_found', 'food not found');
    return food;
  });

  app.get('/v1/foods/:id(^\\d+$)/nutrients', {
    config: v1('foodNutrients'),
    schema: {
      summary: 'Nutrients for a portion',
      description: `${cost('foodNutrients')}. Give \`grams\`, or \`quantity\` + \`unit\` (g, oz, cup, tbsp, tsp, fl oz, ml, slice, piece, medium, large, ...).`,
      params: FoodId,
      querystring: Type.Object({
        grams: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 10000 })),
        quantity: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1000 })),
        unit: Type.Optional(Type.String({ maxLength: 50 })),
      }),
      response: { ...ok({ $ref: 'FoodNutrients#' }), ...errors(400, 401, 404) },
    },
  }, (req) => {
    const food = getFood(req.params.id);
    if (!food) throw new HttpError(404, 'not_found', 'food not found');
    const { grams: g, quantity, unit } = req.query;
    const portion = g != null
      ? { grams: g, quantity: g, unit: 'g', portion: null, method: 'mass' }
      : resolvePortion(food, quantity ?? null, unit ?? null);
    const grams = Math.round(portion.grams * 10) / 10;
    return { food: { id: food.id, name: food.name }, quantity: portion.quantity, unit: portion.unit, grams, portionBasis: portion.portion, portionMethod: portion.method, nutrients: scaleNutrients(food.per100g, grams) };
  });

  app.post('/v1/log/text', {
    config: v1('logText'),
    schema: {
      summary: 'Log a meal from free text', description: `${cost('logText')}. Set \`ai: true\` to parse with the AI provider.`,
      body: Type.Object({ text: nonBlank(2000), ai: Type.Optional(Type.Boolean()) }),
      response: { ...ok({ $ref: 'LogResult#' }), ...errors(400, 401, 429, 501) },
    },
  }, async (req) => {
    const { text, ai } = req.body;
    if (ai) {
      const provider = await requireProvider('parseMeal');
      return aiItems(provider, () => provider.parseMeal({ text }));
    }
    return { ...logText(text), provider: 'rules' };
  });

  app.post('/v1/log/voice', {
    config: v1('logVoice'),
    schema: {
      summary: 'Log a meal from a speech transcript', description: `${cost('logVoice')}. Transcription happens on the device; filler words are removed.`,
      body: Type.Object({ transcript: nonBlank(2000), ai: Type.Optional(Type.Boolean()) }),
      response: { ...ok({ $ref: 'LogResult#' }), ...errors(400, 401, 429, 501) },
    },
  }, async (req) => {
    // Speech-to-text runs on the device (see the SDK); the API receives the transcript.
    const text = req.body.transcript.replace(DISFLUENCIES, '').replace(/\s+/g, ' ').trim();
    let result;
    if (req.body.ai) {
      const provider = await requireProvider('parseMeal');
      result = await aiItems(provider, () => provider.parseMeal({ text }));
    } else {
      result = { ...logText(text), provider: 'rules' };
    }
    return { transcript: text, ...result };
  });

  app.post('/v1/log/photo', {
    config: v1('logPhoto'),
    bodyLimit: IMAGE_BODY_LIMIT,
    validatorCompiler: documentOnly,
    schema: {
      summary: 'Recognize foods in a meal photo', description: `${cost('logPhoto')} + AI usage. Requires an AI provider. Body: JSON or a raw image/* body.`,
      body: imageBody,
      response: { ...ok({ $ref: 'LogResult#' }), ...errors(400, 401, 413, 422, 429, 501, 502, 503) },
    },
  }, async (req: FastifyRequest) => {
    const provider = await requireProvider('recognizeMeal');
    const { image, mediaType, fields } = readImage(req);
    const hint = typeof fields.hint === 'string' ? fields.hint.slice(0, 500) : undefined;
    return aiItems(provider, () => provider.recognizeMeal({ image, mediaType, hint }));
  });

  app.get('/v1/barcodes/:code(^[0-9]+$)', {
    config: v1('barcode'),
    schema: {
      summary: 'Packaged food by EAN/UPC barcode', description: cost('barcode'),
      params: Type.Object({ code: Type.String({ pattern: '^[0-9]{8,14}$', description: 'EAN/UPC with a correct check digit' }) }),
      response: { ...ok({ $ref: 'BarcodeProduct#' }), ...errors(400, 401, 404, 502) },
    },
    // The check-digit rule needs its own error code, so the handler validates the code.
    validatorCompiler: documentOnly,
  }, async (req) => {
    const { code } = req.params as { code: string };
    if (!isValidGtin(code)) throw bad('not a valid EAN/UPC barcode (8, 12, 13 or 14 digits with a correct check digit)', 'invalid_barcode');
    const r = await lookupBarcode(fastify.sql, code);
    if (!r.found) throw new HttpError(404, 'not_found', r.offline ? 'barcode not cached and server is offline' : 'no product found for this barcode');
    return { ...r.product, cached: r.cached };
  });

  app.post('/v1/labels/parse', {
    config: v1('dynamic'),
    bodyLimit: IMAGE_BODY_LIMIT,
    validatorCompiler: documentOnly,
    schema: {
      summary: 'Read a Nutrition Facts label',
      description: `Text: ${COSTS.labelText} tokens. Image: ${COSTS.labelImage} tokens + AI usage (requires an AI provider).`,
      body: Type.Union([Type.Object({ text: Type.String() }), imageBody]),
      response: { ...ok({ $ref: 'LabelResult#' }), ...errors(400, 401, 422, 501) },
    },
  }, async (req: FastifyRequest) => {
    // Cost depends on the input kind: the handler returns { costKey, body, usage }.
    const type = String(req.headers['content-type'] || '');
    if (type.startsWith('image/') || type.includes('json')) {
      if (type.startsWith('image/')) return { costKey: 'labelImage', ...(await labelImage(() => readImage(req))) };
      const body = jsonBody(req);
      if (typeof body.text === 'string') {
        if (!body.text.trim()) throw bad('`text` is empty');
        return { costKey: 'labelText', body: { source: 'text', ...parseLabelText(body.text.slice(0, 5000)) } };
      }
      if (body.image) return { costKey: 'labelImage', ...(await labelImage(() => imageFromJson(body))) };
    }
    throw bad('send {"text": "..."} or {"image": "...", "mediaType": "image/jpeg"} (or a raw image body)');
  });

  app.post('/v1/meal-plans', {
    config: v1('mealPlan'),
    schema: {
      summary: 'Generate a meal plan', description: cost('mealPlan'),
      body: Type.Object({
        calories: Type.Optional(Type.Number({ minimum: 1000, maximum: 5000, default: 2000 })),
        proteinGrams: Type.Optional(Type.Integer()),
        diet: Type.Optional(Type.String({ enum: DIETS })),
        meals: Type.Optional(Type.Array(Type.String({ enum: MEALS }))),
        days: Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })),
        exclude: Type.Optional(Type.Array(Type.String())),
        seed: Type.Optional(Type.Integer({ description: 'Same seed + inputs reproduces the plan' })),
      }),
      response: { ...ok({ type: 'object' }), ...errors(400, 401, 429) },
    },
  }, (req) => generateMealPlan(req.body));

  app.get('/v1/usage', {
    config: v1('usage'),
    schema: { summary: 'Token usage for the calling key this month', response: { ...ok({ $ref: 'Usage#' }), ...errors(401) } },
  }, (req) => usageSummary(fastify.sql, req.key));

  app.post('/v1/auth/token', {
    config: v1('token'),
    schema: {
      summary: 'Exchange an API key for a short-lived access token',
      description: 'Free. Send your secret API key as the bearer credential; receive an `nkat_` token valid for 1 hour. Give access tokens to browsers and mobile apps instead of the secret key. Access tokens cannot mint new tokens.',
      response: { ...ok({ type: 'object', properties: { access_token: { type: 'string' }, token_type: { type: 'string', const: 'Bearer' }, expires_in: { type: 'integer' }, expires_at: { type: 'string', format: 'date-time' } } }), ...errors(401, 403) },
    },
  }, (req) => {
    // Only a secret API key can mint access tokens (a token cannot extend itself).
    if (req.key.via !== 'api_key') throw new HttpError(403, 'forbidden', 'exchange an API key (nk_...), not an access token');
    return issueAccessToken(fastify.sql, req.key);
  });
}
