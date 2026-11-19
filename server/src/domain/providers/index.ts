// AI provider selection. A provider implements any of:
//   recognizeMeal({ image, mediaType, hint }) -> { items: [{ food, quantity, unit, grams, confidence }], notes, usage }
//   readLabel({ image, mediaType })           -> { servingSize, servingGrams, servingsPerContainer, perServing, usage }
//   parseMeal({ text })                        -> { meal, items: [{ food, quantity, unit, grams }], usage }
//   advise({ question, context })              -> { answer, declined, usage }
//   estimateFoods({ foods, candidates, signal }) -> { foods: [{ query, known, name, per100g, serving, confidence, sameAs }], usage }
//     (`candidates[i]` are catalog foods that may be the same dish as `foods[i]`; `sameAs` is the id of the one it is)
// `usage` is { inputTokens, outputTokens } so the API can meter it.
// Missing capabilities surface as HTTP 501 from the routes that need them.
import type { AIUsage } from '../types.ts';

export type { AIUsage } from '../types.ts';

/** A base64 image as sent to recognizeMeal/readLabel; routes validate mediaType. */
export interface ImageInput {
  image: string;
  mediaType: string;
}

export interface AIFoodItem {
  food: string;
  quantity: number;
  unit: string;
  grams: number;
  confidence?: 'high' | 'medium' | 'low';
}

export interface MealRecognition {
  meal: string | null;
  items: AIFoodItem[];
  notes: string;
  usage: AIUsage;
}

export interface LabelReading {
  isNutritionLabel: boolean;
  servingSize: string | null;
  servingGrams: number | null;
  servingsPerContainer: number | null;
  perServing: Record<string, number | null>;
  usage: AIUsage;
}

/** Typical nutrition for a food the catalog lacks, per 100 g of it as eaten. */
export interface FoodEstimate {
  /** The food as it was asked for. */
  query: string;
  /** False when the text is not a food or drink (gibberish, a brand the model doesn't know): nothing is logged. */
  known: boolean;
  name: string;
  /** Calories, protein, fat and carbs are required; the others are null when the model can't support a value (never 0). */
  per100g: { calories: number; protein: number; fat: number; carbs: number; fiber: number | null; sugar: number | null; saturatedFat: number | null; sodium: number | null };
  /**
   * One typical serving: "1 bowl", unit "bowl", 250 g. `quantity` is how many `unit`s it holds ("2 idlis": 2), and
   * `grams` is the whole serving's weight, so one unit weighs grams / quantity. Estimates made before `quantity`
   * existed lack it; their count is read from the label where that is unambiguous (servingCount in foodrequests.ts).
   */
  serving: { label: string; unit: string; grams: number; quantity?: number };
  confidence: 'high' | 'medium' | 'low';
  /** The id of a listed catalog food that is the same dish, when the request offered candidates; else null. */
  sameAs?: number | null;
}

/** A catalog food offered to the model as possibly the same dish as a food being estimated. */
export interface CatalogCandidate { id: number; name: string; calories: number | null; protein?: number | null; carbs?: number | null; fat?: number | null }

/**
 * A different system prompt and message for estimateFoods, with the same output schema. Only the evaluation
 * (scripts/eval-estimates.ts) passes one, to measure prompt variants; logging always uses the built-in prompt.
 */
export interface EstimatePrompt { system: string; message: (foods: string[], candidates?: CatalogCandidate[][]) => string }

export interface FoodEstimates {
  foods: FoodEstimate[];
  usage: AIUsage;
  /** The model that answered, when the provider tries more than one; else the provider's `model`. */
  model?: string;
  /** The exact model version the provider's response reports ("gpt-5-mini-2025-08-07"), when it gives one. */
  modelVersion?: string;
}

export interface AdvisorReply {
  /** Markdown. When declined, a short explanation of why and where to turn instead. */
  answer: string;
  /** True when the question is outside general nutrition (medical, unsafe, off-topic). */
  declined: boolean;
  usage: AIUsage;
}

export interface AIProvider {
  name: string;
  /** The main model (the first one tried). */
  model?: string;
  /** Models per capability, in the order they are tried, for providers that route tasks to different models. */
  models?: Partial<Record<AICapability, string[]>>;
  recognizeMeal?(args: ImageInput & { hint?: string | null }): Promise<MealRecognition>;
  readLabel?(args: ImageInput): Promise<LabelReading>;
  parseMeal?(args: { text: string }): Promise<MealRecognition>;
  /** `context` is caller-supplied background (goals, today's log); it is never treated as instructions. */
  advise?(args: { question: string; context?: string | null }): Promise<AdvisorReply>;
  /**
   * Nutrition estimates for foods the catalog has no match for (at most a handful per call). `candidates[i]` are
   * catalog foods that may be the same dish as `foods[i]` (the model may pick one: `sameAs`). `signal`, when given,
   * is the deadline to use instead of a fresh aiDeadline(), so several calls can share one.
   */
  estimateFoods?(args: { foods: string[]; candidates?: CatalogCandidate[][]; signal?: AbortSignal; prompt?: EstimatePrompt }): Promise<FoodEstimates>;
}

/** The capability methods a provider may implement. */
export type AICapability = 'recognizeMeal' | 'readLabel' | 'parseMeal' | 'advise' | 'estimateFoods';

/** One deadline for a whole provider call, retries included (NUTRIKIT_AI_TIMEOUT_MS, default 60 s). */
export const aiDeadline = (): AbortSignal => {
  const ms = Number(process.env.NUTRIKIT_AI_TIMEOUT_MS) || 60_000;
  return Object.assign(AbortSignal.timeout(ms), { endsAt: Date.now() + ms });
};

/** Milliseconds left before a deadline from aiDeadline() aborts (0 once it has); unknown signals report Infinity. */
export const timeLeft = (signal: AbortSignal): number => {
  if (signal.aborted) return 0;
  const endsAt = (signal as AbortSignal & { endsAt?: number }).endsAt;
  return endsAt == null ? Infinity : Math.max(0, endsAt - Date.now());
};

/** Two usages added; a missing one counts as none. */
export const addUsage = (a: AIUsage | null | undefined, b: AIUsage | null | undefined): AIUsage => ({
  inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
  outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
});

/**
 * Adds usage to an error, so the tokens the provider spent before the failure are still charged (plugins/metering.ts
 * reads `err.usage`). Returns the error.
 */
export function withUsage(err: unknown, usage: AIUsage | null | undefined): unknown {
  if (!usage || !err || typeof err !== 'object') return err;
  const e = err as { usage?: AIUsage };
  e.usage = addUsage(e.usage, usage);
  return err;
}

/** The error a provider throws when its deadline passes: 504, and no usage, so nothing is charged. */
export const aiTimeout = (): Error => Object.assign(new Error('the AI provider did not answer in time; try again'), { status: 504, code: 'ai_timeout' });

/** Where providers report what they recover from (a model failing over to the next); the app sets its logger. */
export interface AILog { warn(obj: object, msg: string): void }
let log: AILog = { warn: () => {} };
export const aiLog = (): AILog => log;
export function setAILog(logger: AILog): void {
  log = logger;
}

let active: AIProvider | undefined;

export async function getProvider(): Promise<AIProvider> {
  if (active) return active;
  // The OpenAI-compatible provider serves Gemini, and OpenAI only with NUTRIKIT_OPENAI_FALLBACK=1: an OPENAI_API_KEY
  // alone (no Gemini) leaves AI off rather than spending on OpenAI (openaiKeyUsable in openai.ts).
  const { openaiKeyUsable } = await import('./openai.ts');
  const name = process.env.NUTRIKIT_AI_PROVIDER
    || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.GEMINI_API_KEY || openaiKeyUsable() ? 'openai' : 'none');
  if (name === 'anthropic') {
    const { createAnthropicProvider } = await import('./anthropic.ts');
    active = await createAnthropicProvider();
  } else if (name === 'openai') {
    const { createOpenAIProvider } = await import('./openai.ts');
    active = await createOpenAIProvider();
  } else {
    active = { name: 'none' };
  }
  return active;
}

// Tests (and embedders) can inject a provider.
export function setProvider(provider: AIProvider): void {
  active = provider;
}
