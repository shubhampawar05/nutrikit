// OpenAI-compatible provider: the same five capabilities as the Claude provider, through the Chat Completions API
// with strict JSON-schema outputs. Uses fetch, so it needs no SDK. Two endpoints, used alone or together:
//   GEMINI_API_KEY  Google Gemini's OpenAI-compatible endpoint, with built-in models per task for the free tier.
//   OPENAI_API_KEY  OpenAI, or any OpenAI-compatible endpoint at OPENAI_BASE_URL (Azure, OpenRouter, Ollama, Gemini).
//                   Paid: used only when NUTRIKIT_OPENAI_FALLBACK is exactly "1" (see openaiAllowed). A key alone, or
//                   any other value ("0", "true"), never sends a request, so there is no silent paid fallback.
// With both and the opt-in, Gemini answers first and OpenAI is the fallback.
//
// Each capability has its own list of models, tried in order (Gemini's, then OpenAI's): a model that is busy, rate
// limited, gone or slow hands the call to the next one, so a strong model can do the heavy work while lighter ones
// stand in for it (and serve the light work) on tight quotas such as a free tier. Lists come from
// NUTRIKIT_<GEMINI|OPENAI>_MODEL_<TASK>, else NUTRIKIT_<GEMINI|OPENAI>_MODEL, else the built-in choice.
import type { AIUsage } from '../types.ts';
import { addUsage, aiDeadline, aiLog, aiTimeout, timeLeft, withUsage, type AICapability, type AIProvider } from './index.ts';
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
  // Nutrition estimates: Flash-Lite only. It was the most accurate, fastest and cheapest model measured (M1/M2 report),
  // and gemini-3.5-flash failed 16 of 18 calls for this key, so every estimate waited on it before falling back.
  estimateFoods: ['gemini-3.5-flash-lite'],
};

/**
 * True only when paid OpenAI calls are explicitly enabled: NUTRIKIT_OPENAI_FALLBACK is exactly "1". An OPENAI_API_KEY
 * by itself, or NUTRIKIT_OPENAI_FALLBACK set to anything else ("0", "true", "yes", empty), keeps OpenAI off.
 */
export const openaiAllowed = (env: NodeJS.ProcessEnv = process.env): boolean => env.NUTRIKIT_OPENAI_FALLBACK === '1';

/**
 * Whether OPENAI_API_KEY may be used: always when OPENAI_BASE_URL is Gemini's own endpoint (that key is a Gemini key),
 * otherwise only with the explicit opt-in.
 */
export function openaiKeyUsable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.OPENAI_API_KEY) return false;
  return isGemini((env.OPENAI_BASE_URL || OPENAI_URL).replace(/\/+$/, '')) || openaiAllowed(env);
}
const isGemini = (baseUrl: string): boolean => {
  try { return new URL(baseUrl).hostname === 'generativelanguage.googleapis.com'; } catch { return false; }
};

interface Endpoint { name: 'gemini' | 'openai'; baseUrl: string; apiKey: string }
/** One model on one endpoint: an entry in a task's list. */
interface Route { model: string; endpoint: Endpoint }

/** A duration variable in ms: a number >= 0 (0 included), else `fallback`. */
const envMs = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value != null && value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Why the AI keys can't be used as set, or null. With GEMINI_API_KEY set, OPENAI_API_KEY is the OpenAI fallback; an
 * OPENAI_BASE_URL left pointing at Gemini (the setup without GEMINI_API_KEY) would send that key to Google instead.
 */
export function aiConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.GEMINI_API_KEY && env.OPENAI_API_KEY && env.OPENAI_BASE_URL && isGemini(env.OPENAI_BASE_URL)) {
    return 'GEMINI_API_KEY is set and OPENAI_BASE_URL points at Gemini, so OPENAI_API_KEY would be sent to Google: unset OPENAI_BASE_URL to use OpenAI as the fallback, or unset OPENAI_API_KEY';
  }
  return null;
}

/** A comma-separated list of models, in the order to try them; null when it names none. */
const modelList = (value: string | undefined): string[] | null => {
  const list = (value ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return list.length ? list : null;
};

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatCompletion {
  model?: string;
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
/** An error another model may not have: busy, rate limited, unreachable or unknown model. The model rests a while. */
const busy = (message: string, status: number) => Object.assign(fail(message, status), { fallback: true });
/** A failure of this one answer (rejected by this model, truncated, malformed): the next model may do better. */
const retryOther = <E extends Error>(err: E) => Object.assign(err, { retryOther: true });

/**
 * The part of `signal` one model in a list may use before the next one is tried: at most `ms`, and never past
 * `signal` itself. It carries `endsAt` so timeLeft() measures it.
 */
function slice(signal: AbortSignal, ms: number): AbortSignal {
  const own = Math.max(0, Math.floor(Math.min(ms, timeLeft(signal))));
  return Object.assign(AbortSignal.any([signal, AbortSignal.timeout(own)]), { endsAt: Date.now() + own });
}

/**
 * Models per task on one endpoint: `<prefix>_<TASK>`, else `<prefix>`, else `builtIn`. `main` is the endpoint's
 * general model: the first of `<prefix>`, else the built-in one for light work.
 */
function modelsFor(prefix: string, builtIn: (task: AICapability) => string[]): { models: Record<AICapability, string[]>; main: string } {
  const all = modelList(process.env[prefix]);
  const models = Object.fromEntries(TASKS.map((task) => [task, modelList(process.env[`${prefix}_${TASK_SUFFIX[task]}`]) ?? all ?? builtIn(task)])) as Record<AICapability, string[]>;
  return { models, main: all?.[0] ?? builtIn('advise')[0] };
}

export async function createOpenAIProvider(): Promise<AIProvider> {
  const problem = aiConfigProblem();
  if (problem) throw new Error(problem);
  const endpoints: { endpoint: Endpoint; models: Record<AICapability, string[]>; main: string }[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    endpoints.push({
      endpoint: { name: 'gemini', baseUrl: (process.env.GEMINI_BASE_URL || GEMINI_URL).replace(/\/+$/, ''), apiKey: geminiKey },
      ...modelsFor('NUTRIKIT_GEMINI_MODEL', (task) => GEMINI_MODELS[task]),
    });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  // OpenAI (or any other paid endpoint behind OPENAI_API_KEY) only with the explicit opt-in; never by default.
  if (openaiKey && openaiKeyUsable()) {
    const baseUrl = (process.env.OPENAI_BASE_URL || OPENAI_URL).replace(/\/+$/, '');
    const gemini = isGemini(baseUrl); // Gemini set up through OPENAI_BASE_URL gets its built-in models too
    endpoints.push({
      endpoint: { name: gemini ? 'gemini' : 'openai', baseUrl, apiKey: openaiKey },
      ...modelsFor('NUTRIKIT_OPENAI_MODEL', (task) => (gemini ? GEMINI_MODELS[task] : [DEFAULT_MODEL])),
    });
  }
  if (!endpoints.length) {
    throw new Error(openaiKey
      ? 'OPENAI_API_KEY is set but paid OpenAI calls are off: set GEMINI_API_KEY, or NUTRIKIT_OPENAI_FALLBACK=1 to allow OpenAI'
      : 'NUTRIKIT_AI_PROVIDER=openai needs GEMINI_API_KEY (or OPENAI_API_KEY with NUTRIKIT_OPENAI_FALLBACK=1)');
  }
  // Each task's list: the first endpoint's models, then the fallback endpoint's.
  const routes = Object.fromEntries(TASKS.map((task) =>
    [task, endpoints.flatMap(({ endpoint, models }) => models[task].map((model): Route => ({ model, endpoint })))])) as Record<AICapability, Route[]>;
  const models = Object.fromEntries(TASKS.map((task) => [task, routes[task].map((r) => r.model)])) as Record<AICapability, string[]>;
  // The most a model that has others after it gets before the call moves on.
  const fallbackAfter = envMs(process.env.NUTRIKIT_AI_FALLBACK_AFTER_MS, 20_000);
  // A model that was busy, rate limited, gone or too slow is skipped this long (unless it is the last one left), so
  // an overloaded model doesn't cost every call its wait, nor spend quota on answers nobody reads.
  const cooldown = envMs(process.env.NUTRIKIT_AI_COOLDOWN_MS, 60_000);
  const restingUntil = new Map<Route, number>();
  const resting = (route: Route) => (restingUntil.get(route) ?? 0) > Date.now();

  /**
   * How long list[i] may take before the next model is tried. With a fallback endpoint after this one, this
   * endpoint's models share half the call's time (`total`), so the fallback always keeps the other half; otherwise
   * the models left share the time left evenly. Never more than NUTRIKIT_AI_FALLBACK_AFTER_MS.
   */
  function share(list: Route[], i: number, signal: AbortSignal, total: number): number {
    const left = timeLeft(signal);
    if (!Number.isFinite(left) || !Number.isFinite(total)) return fallbackAfter;
    const { endpoint } = list[i];
    const ahead = list.filter((r, at) => at > i && !resting(r));
    const fallbackLater = ahead.some((r) => r.endpoint !== endpoint);
    const pool = fallbackLater ? left - total / 2 : left;
    const sharing = 1 + (fallbackLater ? ahead.filter((r) => r.endpoint === endpoint).length : ahead.length);
    return Math.min(fallbackAfter, Math.max(0, pool) / sharing);
  }

  /** The answer's JSON and usage; a failed answer carries its usage (tokens were spent on it). */
  function read<T>(response: ChatCompletion): { data: T; usage: AIUsage } {
    const usage: AIUsage = { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 };
    const choice = response.choices?.[0];
    // A refusal is the model's judgement of the request (e.g. a medical question), not a fault: no other model is asked.
    if (choice?.message.refusal) throw fail('the AI provider declined this request', 422, usage);
    if (choice?.finish_reason === 'length') throw retryOther(fail('the AI provider response was truncated', 502, usage));
    if (!choice?.message.content) throw retryOther(fail('the AI provider returned no content', 502, usage));
    try {
      return { data: JSON.parse(choice.message.content), usage };
    } catch {
      throw retryOther(fail('the AI provider returned malformed output', 502, usage));
    }
  }

  // T is the shape `schema` describes; strict structured outputs guarantee the JSON matches it.
  async function call<T>(task: AICapability, name: string, system: string, content: ContentPart[], schema: object, deadline?: AbortSignal): Promise<{ data: T; usage: AIUsage; model: string; modelVersion?: string }> {
    const signal = deadline ?? aiDeadline();
    const total = timeLeft(signal);
    const list = routes[task];
    let spent: AIUsage | undefined; // tokens of failed answers before this one: charged with the call
    for (let i = 0; ; i++) {
      const route = list[i];
      const { endpoint, model } = route;
      const last = i === list.length - 1;
      if (!last && resting(route)) continue;
      try {
        const response = await request(endpoint, last ? signal : slice(signal, share(list, i, signal, total)), last ? MAX_RETRIES : 0, {
          model,
          max_completion_tokens: 16000,
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
          messages: [{ role: 'system', content: system }, { role: 'user', content }],
        });
        const { data, usage } = read<T>(response);
        return { data: data, usage: addUsage(spent, usage), model, modelVersion: response.model };
      } catch (err) {
        if (last || signal.aborted) throw withUsage(err, spent);
        const e = err as Error & { fallback?: boolean; retryOther?: boolean; code?: string; status?: number; usage?: AIUsage };
        let next = i + 1;
        if (e.fallback || e.code === 'ai_timeout') restingUntil.set(route, Date.now() + cooldown);
        // Any other error (a refused key) would repeat on this endpoint: the fallback endpoint gets the call, with its
        // own key and limits; with none, the error is the answer.
        else if (!e.retryOther) {
          next = list.findIndex((r, at) => at > i && r.endpoint !== endpoint);
          if (next < 0) throw withUsage(err, spent);
        }
        spent = addUsage(spent, e.usage);
        const to = list[next];
        aiLog().warn(
          { task, model, endpoint: endpoint.name, status: e.status, code: e.code, error: e.message, next: to.model, nextEndpoint: to.endpoint.name },
          to.endpoint === endpoint ? 'AI model failed; trying the next model' : `AI model failed; falling back to ${to.endpoint.name}`,
        );
        i = next - 1;
      }
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
      // 400 may be this model's own limit (no JSON mode, image size): the next model is asked, without a rest.
      if (res.status === 400) throw retryOther(fail(`AI provider rejected the input: ${detail}`, 422));
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

    async estimateFoods({ foods, candidates, signal, prompt }) {
      const { data: out, usage, model, modelVersion } = await call<FoodEstimatesOutput>('estimateFoods', 'food_estimates', prompt?.system ?? ESTIMATE_SYSTEM, [{ type: 'text', text: (prompt?.message ?? estimateMessage)(foods, candidates) }], FOOD_ESTIMATES_SCHEMA, signal);
      return { foods: out.foods, usage, model, ...(modelVersion && modelVersion !== model ? { modelVersion } : {}) };
    },
  };
}
