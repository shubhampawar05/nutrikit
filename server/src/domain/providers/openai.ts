// OpenAI-backed provider: the same three capabilities as the Claude provider, through the Chat
// Completions API with strict JSON-schema outputs. Uses fetch, so it needs no SDK; OPENAI_BASE_URL
// points it at any OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, a local Ollama, …).
import type { AIUsage } from '../types.ts';
import type { AIProvider } from './index.ts';
import { FOOD_ITEMS_SCHEMA, LABEL_SCHEMA, LABEL_SYSTEM, PHOTO_SYSTEM, TEXT_SYSTEM, type FoodItemsOutput, type LabelOutput } from './prompts.ts';

const MODEL = process.env.NUTRIKIT_OPENAI_MODEL || 'gpt-5-mini';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const MAX_RETRIES = 2;

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatCompletion {
  choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (message: string, status: number, usage?: AIUsage) => Object.assign(new Error(message), { status, usage });

export async function createOpenAIProvider(): Promise<AIProvider> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('NUTRIKIT_AI_PROVIDER=openai needs OPENAI_API_KEY');

  // T is the shape `schema` describes; strict structured outputs guarantee the JSON matches it.
  async function call<T>(name: string, system: string, content: ContentPart[], schema: object): Promise<{ data: T; usage: AIUsage }> {
    const response = await request({
      model: MODEL,
      max_completion_tokens: 16000,
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    });
    const usage: AIUsage = { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 };
    const choice = response.choices[0];
    if (choice?.message.refusal) throw fail('the AI provider declined this request', 422, usage);
    if (choice?.finish_reason === 'length') throw fail('the AI provider response was truncated', 502, usage);
    if (!choice?.message.content) throw fail('the AI provider returned no content', 502, usage);
    return { data: JSON.parse(choice.message.content), usage };
  }

  // Retries rate limits, 5xx and connection errors, like the Anthropic SDK does for the Claude provider.
  async function request(body: object): Promise<ChatCompletion> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        if (attempt < MAX_RETRIES) { await sleep(500 * 2 ** attempt); continue; }
        throw fail('AI provider error (connection)', 502);
      }
      if (res.ok) return res.json() as Promise<ChatCompletion>;
      const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (res.status === 400) throw fail(`AI provider rejected the input: ${detail}`, 422);
      if (res.status === 401 || res.status === 403) throw fail('AI provider credentials are invalid', 503);
      if (res.status === 429) throw fail('AI provider is rate limited; retry later', 503);
      throw fail(`AI provider error (${res.status})`, 502);
    }
  }

  const image = (data: string, mediaType: string): ContentPart => ({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } });

  return {
    name: 'openai',
    model: MODEL,

    async recognizeMeal({ image: data, mediaType, hint }) {
      const content = [image(data, mediaType), { type: 'text', text: hint ? `Context from the user: ${hint}` : 'Identify the foods in this photo.' } as const];
      const { data: out, usage } = await call<FoodItemsOutput>('meal_items', PHOTO_SYSTEM, content, FOOD_ITEMS_SCHEMA);
      return { meal: out.meal, items: out.items, notes: out.notes, usage };
    },

    async readLabel({ image: data, mediaType }) {
      const { data: out, usage } = await call<LabelOutput>('nutrition_label', LABEL_SYSTEM, [image(data, mediaType), { type: 'text', text: 'Transcribe this nutrition label.' }], LABEL_SCHEMA);
      return { ...out, usage };
    },

    async parseMeal({ text }) {
      const { data: out, usage } = await call<FoodItemsOutput>('meal_items', TEXT_SYSTEM, [{ type: 'text', text }], FOOD_ITEMS_SCHEMA);
      return { meal: out.meal, items: out.items, notes: out.notes, usage };
    },
  };
}
