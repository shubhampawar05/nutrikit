// OpenAI-compatible provider: the same five capabilities as the Claude provider, through the Chat Completions API
// with strict JSON-schema outputs. Uses fetch, so it needs no SDK. Two endpoints, used alone or together:
//   GEMINI_API_KEY  Google Gemini's OpenAI-compatible endpoint, with built-in models per task for the free tier.
//   OPENAI_API_KEY  OpenAI, or any OpenAI-compatible endpoint at OPENAI_BASE_URL (Azure, OpenRouter, Ollama, Gemini).
// With both, Gemini answers first and OpenAI is the fallback.
//
// Each capability has its own list of models, tried in order (Gemini's, then OpenAI's): a model that is busy, rate
// limited, gone or slow hands the call to the next one, so a strong model can do the heavy work while lighter ones
// stand in for it (and serve the light work) on tight quotas such as a free tier. Lists come from
// NUTRIKIT_<GEMINI|OPENAI>_MODEL_<TASK>, else NUTRIKIT_<GEMINI|OPENAI>_MODEL, else the built-in choice.
import type { AIUsage } from '../types.ts';
import { aiDeadline, aiTimeout, timeLeft, type AICapability, type AIProvider } from './index.ts';
import { ADVICE_SCHEMA, ADVICE_SYSTEM, ESTIMATE_SYSTEM, FOOD_ESTIMATES_SCHEMA, FOOD_ITEMS_SCHEMA, LABEL_SCHEMA, LABEL_SYSTEM, PHOTO_SYSTEM, TEXT_SYSTEM, adviceMessage, estimateMessage, type AdviceOutput, type FoodEstimatesOutput, type FoodItemsOutput, type LabelOutput } from './prompts.ts';

const DEFAULT_MODEL = 'gpt-5-mini';
const OPENAI_URL = 'https://api.openai.com/v1';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const MAX_RETRIES = 2;

/** The suffix of each capability's model variables: NUTRIKIT_OPENAI_MODEL_PHOTO, NUTRIKIT_GEMINI_MODEL_PHOTO, … */
const TASK_SUFFIX: Record<AICapability, string> = {
  recognizeMeal: 'PHOTO',
  readLabel: 'LABEL',
  parseMeal: 'TEXT',
  advise: 'ADVICE',
  estimateFoods: 'ESTIMATE',
};
const TASKS = Object.keys(TASK_SUFFIX) as AICapability[];

// Gemini's built-in models: light work on fast lite models; heavy work (photos, labels, estimates) on the strongest
// free-tier model, with the lite ones standing in when it is busy.
const GEMINI_LIGHT = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
const GEMINI_HEAVY = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
export const GEMINI_MODELS: Record<AICapability, string[]> = {
  recognizeMeal: GEMINI_HEAVY,
  readLabel: GEMINI_HEAVY,
  parseMeal: GEMINI_LIGHT,
  advise: GEMINI_LIGHT,
  estimateFoods: GEMINI_HEAVY,
};
const isGemini = (baseUrl: string): boolean => {
  try { return new URL(baseUrl).hostname === 'generativelanguage.googleapis.com'; } catch { return false; }
};

interface Endpoint { baseUrl: string; apiKey: string }
/** One model on one endpoint: an entry in a task's list. */
interface Route { model: string; endpoint: Endpoint }

/** A comma-separated list of models, in the order to try them; null when it names none. */
const modelList = (value: string | undefined): string[] | null => {
  const list = (value ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return list.length ? list : null;
};

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatCompletion {
  choices: { finish_reason: string; message: { content: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** Waits `ms`, or rejects with the deadline's timeout as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(aiTimeout());
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); reject(aiTimeout()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve(); }, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
const fail = (message: string, status: number, usage?: AIUsage) => Object.assign(new Error(message), { status, usage });
/** An error another model may not have: busy, rate limited, unreachable or unknown model. */
const busy = (message: string, status: number) => Object.assign(fail(message, status), { fallback: true });

/**
 * The part of `signal` one model in a list may use before the next one is tried: at most `ms`, and never past
 * `signal` itself. It carries `endsAt` so timeLeft() measures it.
 */
function slice(signal: AbortSignal, ms: number): AbortSignal {
  const own = Math.max(0, Math.floor(Math.min(ms, timeLeft(signal))));
  return Object.assign(AbortSignal.any([signal, AbortSignal.timeout(own)]), { endsAt: Date.now() + own });
}

/** Models per task on one endpoint: `<prefix>_<TASK>`, else `<prefix>`, else `builtIn`. */
function modelsFor(prefix: string, builtIn: (task: AICapability) => string[]): Record<AICapability, string[]> {
  const all = modelList(process.env[prefix]);
  return Object.fromEntries(TASKS.map((task) => [task, modelList(process.env[`${prefix}_${TASK_SUFFIX[task]}`]) ?? all ?? builtIn(task)])) as Record<AICapability, string[]>;
}

export async function createOpenAIProvider(): Promise<AIProvider> {
  const endpoints: { endpoint: Endpoint; models: Record<AICapability, string[]>; main: string }[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    endpoints.push({
      endpoint: { baseUrl: (process.env.GEMINI_BASE_URL || GEMINI_URL).replace(/\/+$/, ''), apiKey: geminiKey },
      models: modelsFor('NUTRIKIT_GEMINI_MODEL', (task) => GEMINI_MODELS[task]),
      main: modelList(process.env.NUTRIKIT_GEMINI_MODEL)?.[0] ?? GEMINI_LIGHT[0],
    });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const baseUrl = (process.env.OPENAI_BASE_URL || OPENAI_URL).replace(/\/+$/, '');
    const gemini = isGemini(baseUrl); // Gemini set up through OPENAI_BASE_URL gets its built-in models too
    endpoints.push({
      endpoint: { baseUrl, apiKey: openaiKey },
      models: modelsFor('NUTRIKIT_OPENAI_MODEL', (task) => (gemini ? GEMINI_MODELS[task] : [DEFAULT_MODEL])),
      main: modelList(process.env.NUTRIKIT_OPENAI_MODEL)?.[0] ?? (gemini ? GEMINI_LIGHT[0] : DEFAULT_MODEL),
    });
  }
  if (!endpoints.length) throw new Error('NUTRIKIT_AI_PROVIDER=openai needs OPENAI_API_KEY or GEMINI_API_KEY');
  // Each task's list: the first endpoint's models, then the fallback endpoint's.
  const routes = Object.fromEntries(TASKS.map((task) =>
    [task, endpoints.flatMap(({ endpoint, models }) => models[task].map((model): Route => ({ model, endpoint })))])) as Record<AICapability, Route[]>;
  const models = Object.fromEntries(TASKS.map((task) => [task, routes[task].map((r) => r.model)])) as Record<AICapability, string[]>;
  // The most a model that has others after it gets before the call moves on. It also gets no more than an even share
  // of the time left, so the models after it (the fallback endpoint last) always have time to answer.
  const fallbackAfter = Number(process.env.NUTRIKIT_AI_FALLBACK_AFTER_MS) || 20_000;

  // T is the shape `schema` describes; strict structured outputs guarantee the JSON matches it.
  async function call<T>(task: AICapability, name: string, system: string, content: ContentPart[], schema: object, deadline?: AbortSignal): Promise<{ data: T; usage: AIUsage; model: string }> {
    const signal = deadline ?? aiDeadline();
    const list = routes[task];
    let response: ChatCompletion | undefined;
    let model = list[0].model;
    for (let i = 0; !response; i++) {
      const { endpoint } = list[i];
      model = list[i].model;
      const last = i === list.length - 1;
      try {
        response = await request(endpoint, last ? signal : slice(signal, Math.min(fallbackAfter, timeLeft(signal) / (list.length - i))), last ? MAX_RETRIES : 0, {
          model,
          max_completion_tokens: 16000,
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
          messages: [{ role: 'system', content: system }, { role: 'user', content }],
        });
      } catch (err) {
        if (last || signal.aborted) throw err;
        // Only this model's share of the time ran out, or the model is busy: the next one gets the call. Any other
        // error (a refused key, rejected input) would repeat on this endpoint, so the fallback endpoint gets it, with
        // its own key and limits; with none, it is the answer.
        const e = err as { fallback?: boolean; code?: string };
        if (!(e.fallback || e.code === 'ai_timeout')) {
          const next = list.findIndex((r, at) => at > i && r.endpoint !== endpoint);
          if (next < 0) throw err;
          i = next - 1;
        }
      }
    }
    const usage: AIUsage = { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 };
    const choice = response.choices?.[0];
    if (choice?.message.refusal) throw fail('the AI provider declined this request', 422, usage);
    if (choice?.finish_reason === 'length') throw fail('the AI provider response was truncated', 502, usage);
    if (!choice?.message.content) throw fail('the AI provider returned no content', 502, usage);
    try {
      return { data: JSON.parse(choice.message.content), usage, model };
    } catch {
      throw fail('the AI provider returned malformed output', 502, usage);
    }
  }

  // Retries rate limits, 5xx and connection errors, like the Anthropic SDK does for the Claude provider,
  // all within one deadline: a wait between attempts ends when the deadline does.
  async function request({ baseUrl, apiKey }: Endpoint, signal: AbortSignal, retries: number, body: object): Promise<ChatCompletion> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch {
        if (signal.aborted) throw aiTimeout();
        if (attempt < retries) { await sleep(500 * 2 ** attempt, signal); continue; }
        throw busy('AI provider error (connection)', 502);
      }
      if (res.ok) {
        try {
          return await (res.json() as Promise<ChatCompletion>);
        } catch (err) {
          if (signal.aborted) throw aiTimeout();
          throw fail(`AI provider error (unreadable response: ${(err as Error).message})`, 502);
        }
      }
      const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
      // A Retry-After the deadline can't cover is not waited for: the error below is answered now.
      if ((res.status === 429 || res.status >= 500) && attempt < retries && wait < timeLeft(signal)) {
        await sleep(wait, signal);
        continue;
      }
      if (res.status === 400) throw fail(`AI provider rejected the input: ${detail}`, 422);
      if (res.status === 401 || res.status === 403) throw fail('AI provider credentials are invalid', 503);
      if (res.status === 429) throw busy('AI provider is rate limited; retry later', 503);
      // 404: the model is unknown or retired.
      if (res.status === 404 || res.status >= 500) throw busy(`AI provider error (${res.status})`, 502);
      throw fail(`AI provider error (${res.status})`, 502);
    }
  }

  const image = (data: string, mediaType: string): ContentPart => ({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } });

  return {
    name: 'openai',
    model: endpoints[0].main,
    models,

    async recognizeMeal({ image: data, mediaType, hint }) {
      const content = [image(data, mediaType), { type: 'text', text: hint ? `Context from the user: ${hint}` : 'Identify the foods in this photo.' } as const];
      const { data: out, usage } = await call<FoodItemsOutput>('recognizeMeal', 'meal_items', PHOTO_SYSTEM, content, FOOD_ITEMS_SCHEMA);
      return { meal: out.meal, items: out.items, notes: out.notes, usage };
    },

    async readLabel({ image: data, mediaType }) {
      const { data: out, usage } = await call<LabelOutput>('readLabel', 'nutrition_label', LABEL_SYSTEM, [image(data, mediaType), { type: 'text', text: 'Transcribe this nutrition label.' }], LABEL_SCHEMA);
      return { ...out, usage };
    },

    async parseMeal({ text }) {
      const { data: out, usage } = await call<FoodItemsOutput>('parseMeal', 'meal_items', TEXT_SYSTEM, [{ type: 'text', text }], FOOD_ITEMS_SCHEMA);
      return { meal: out.meal, items: out.items, notes: out.notes, usage };
    },

    async advise({ question, context }) {
      const { data: out, usage } = await call<AdviceOutput>('advise', 'nutrition_advice', ADVICE_SYSTEM, [{ type: 'text', text: adviceMessage(question, context) }], ADVICE_SCHEMA);
      return { ...out, usage };
    },

    async estimateFoods({ foods, candidates, signal }) {
      const { data: out, usage, model } = await call<FoodEstimatesOutput>('estimateFoods', 'food_estimates', ESTIMATE_SYSTEM, [{ type: 'text', text: estimateMessage(foods, candidates) }], FOOD_ESTIMATES_SCHEMA, signal);
      return { foods: out.foods, usage, model };
    },
  };
}
