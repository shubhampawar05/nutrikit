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
import type { AIUsage } from '../types.ts';
import type { AIProvider } from './index.ts';
import { FOOD_ITEMS_SCHEMA, LABEL_SCHEMA, LABEL_SYSTEM, PHOTO_SYSTEM, TEXT_SYSTEM, type FoodItemsOutput, type LabelOutput } from './prompts.ts';

const MODEL = process.env.NUTRIKIT_ANTHROPIC_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.NUTRIKIT_ANTHROPIC_EFFORT || 'medium') as BetaOutputConfig['effort'];

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
