// Claude-backed provider: meal photo recognition, nutrition-label reading and meal-text parsing,
// each returning JSON constrained by a schema (structured outputs).
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaBase64ImageSource,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaOutputConfig,
  BetaTextBlock,
} from '@anthropic-ai/sdk/resources/beta/messages';
import { NUTRIENT_KEYS } from '../nutrients.ts';
import type { AIUsage } from '../types.ts';
import type { AIFoodItem, AIProvider, LabelReading } from './index.ts';

// Model output shapes; the API constrains them to FOOD_ITEMS_SCHEMA / LABEL_SCHEMA.
interface FoodItemsOutput {
  meal: string | null;
  notes: string;
  items: AIFoodItem[];
}

type LabelOutput = Omit<LabelReading, 'usage'>;

const MODEL = process.env.NUTRIKIT_ANTHROPIC_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.NUTRIKIT_ANTHROPIC_EFFORT || 'medium') as BetaOutputConfig['effort'];

const FOOD_ITEMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['meal', 'items', 'notes'],
  properties: {
    meal: { type: ['string', 'null'], enum: ['breakfast', 'lunch', 'dinner', 'snack', null] },
    notes: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['food', 'quantity', 'unit', 'grams', 'confidence'],
        properties: {
          food: { type: 'string', description: 'Generic food name as it would appear in a nutrition database, e.g. "rice, white, cooked"' },
          quantity: { type: 'number' },
          unit: { type: 'string', description: 'Household unit: cup, tbsp, slice, piece, g, oz, fl oz, medium, large, serving' },
          grams: { type: 'number', description: 'Best estimate of the edible weight in grams' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isNutritionLabel', 'servingSize', 'servingGrams', 'servingsPerContainer', 'perServing'],
  properties: {
    isNutritionLabel: { type: 'boolean' },
    servingSize: { type: ['string', 'null'] },
    servingGrams: { type: ['number', 'null'] },
    servingsPerContainer: { type: ['number', 'null'] },
    perServing: {
      type: 'object',
      additionalProperties: false,
      required: NUTRIENT_KEYS,
      properties: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, { type: ['number', 'null'] }])),
    },
  },
};

const PHOTO_SYSTEM = `You identify foods in meal photos for a nutrition-logging app.
List each distinct food or drink you can see as a separate item with a generic database-style name,
a household quantity and unit, and your best estimate of its edible weight in grams (use plate,
utensil and packaging cues for scale). Do not list garnishes under 5 g. If the photo shows no food,
return an empty items list and say so in notes. Use the meal field only if the context makes it clear.`;

const LABEL_SYSTEM = `You transcribe nutrition facts panels from product photos. Report values exactly as
printed, per serving, in these units: calories kcal; fats, carbs, fiber, sugars, protein in g;
cholesterol, sodium, potassium, calcium, iron, magnesium, zinc, vitamin C, caffeine in mg;
vitamin A, D, K, folate, B12 in mcg. Use null for anything not printed. Convert "less than 1g" to 0.5.
If the image is not a nutrition label, set isNutritionLabel to false and leave the rest null.`;

const TEXT_SYSTEM = `You split a person's description of what they ate into individual foods for a
nutrition-logging app. One item per food or drink, with a generic database-style name, the quantity
and unit they said (or a typical single serving if unstated), and an edible-weight estimate in grams.`;

export async function createAnthropicProvider(): Promise<AIProvider> {
  const client = new Anthropic();

  // T is the shape `schema` describes; structured outputs guarantee the JSON matches it.
  async function call<T>(system: string, content: BetaContentBlockParam[], schema: BetaJSONOutputFormat['schema']): Promise<{ data: T; usage: AIUsage }> {
    let response: BetaMessage;
    try {
      response = await request(system, content, schema);
    } catch (err) {
      // Most specific first; the SDK has already retried 429/5xx/connection errors twice.
      if (err instanceof Anthropic.BadRequestError) throw Object.assign(new Error(`AI provider rejected the input: ${err.message}`), { status: 422 });
      if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('AI provider credentials are invalid'), { status: 503 });
      if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('AI provider is rate limited; retry later'), { status: 503 });
      if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`AI provider error (${err.status ?? 'connection'})`), { status: 502 });
      throw err;
    }
    return handle(response);
  }

  function request(system: string, content: BetaContentBlockParam[], schema: BetaJSONOutputFormat['schema']): Promise<BetaMessage> {
    return client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // a safety-classifier decline is retried on Anthropic's recommended fallback model
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    });
  }

  function handle(response: BetaMessage) {
    const usage: AIUsage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    if (response.stop_reason === 'refusal') {
      throw Object.assign(new Error('the AI provider declined this request'), { status: 422, usage });
    }
    if (response.stop_reason === 'max_tokens') {
      throw Object.assign(new Error('the AI provider response was truncated'), { status: 502, usage });
    }
    const text = response.content.filter((b): b is BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    return { data: JSON.parse(text), usage };
  }

  const image = (data: string, mediaType: string): BetaImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: mediaType as BetaBase64ImageSource['media_type'], data } });

  return {
    name: 'anthropic',
    model: MODEL,

    async recognizeMeal({ image: data, mediaType, hint }) {
      const content: BetaContentBlockParam[] = [image(data, mediaType), { type: 'text', text: hint ? `Context from the user: ${hint}` : 'Identify the foods in this photo.' }];
      const { data: out, usage } = await call<FoodItemsOutput>(PHOTO_SYSTEM, content, FOOD_ITEMS_SCHEMA);
      return { meal: out.meal, items: out.items, notes: out.notes, usage };
    },

    async readLabel({ image: data, mediaType }) {
      const { data: out, usage } = await call<LabelOutput>(LABEL_SYSTEM, [image(data, mediaType), { type: 'text', text: 'Transcribe this nutrition label.' }], LABEL_SCHEMA);
      return { ...out, usage };
    },

    async parseMeal({ text }) {
      const { data: out, usage } = await call<FoodItemsOutput>(TEXT_SYSTEM, [{ type: 'text', text }], FOOD_ITEMS_SCHEMA);
      return { meal: out.meal, items: out.items, notes: out.notes, usage };
    },
  };
}
