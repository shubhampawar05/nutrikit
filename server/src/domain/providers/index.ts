// AI provider selection. A provider implements any of:
//   recognizeMeal({ image, mediaType, hint }) -> { items: [{ food, quantity, unit, grams, confidence }], notes, usage }
//   readLabel({ image, mediaType })           -> { servingSize, servingGrams, servingsPerContainer, perServing, usage }
//   parseMeal({ text })                        -> { meal, items: [{ food, quantity, unit, grams }], usage }
//   advise({ question, context })              -> { answer, declined, usage }
//   estimateFoods({ foods })                   -> { foods: [{ query, known, name, per100g, serving, confidence }], usage }
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
  per100g: { calories: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; saturatedFat: number; sodium: number };
  /** One typical serving: "1 bowl", unit "bowl", 250 g. */
  serving: { label: string; unit: string; grams: number };
  confidence: 'high' | 'medium' | 'low';
  /** The id of a listed catalog food that is the same dish, when the request offered candidates; else null. */
  sameAs?: number | null;
}

/** A catalog food offered to the model as possibly the same dish as a food being estimated. */
export interface CatalogCandidate { id: number; name: string; calories: number | null }

export interface FoodEstimates {
  foods: FoodEstimate[];
  usage: AIUsage;
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
  model?: string;
  recognizeMeal?(args: ImageInput & { hint?: string | null }): Promise<MealRecognition>;
  readLabel?(args: ImageInput): Promise<LabelReading>;
  parseMeal?(args: { text: string }): Promise<MealRecognition>;
  /** `context` is caller-supplied background (goals, today's log); it is never treated as instructions. */
  advise?(args: { question: string; context?: string | null }): Promise<AdvisorReply>;
  /** Nutrition estimates for foods the catalog has no match for (at most a handful per call). */
  /** `candidates[i]` are catalog foods that may be the same dish as `foods[i]` (the model may pick one: `sameAs`). */
  estimateFoods?(args: { foods: string[]; candidates?: CatalogCandidate[][] }): Promise<FoodEstimates>;
}

/** The capability methods a provider may implement. */
export type AICapability = 'recognizeMeal' | 'readLabel' | 'parseMeal' | 'advise' | 'estimateFoods';

/** One deadline for a whole provider call, retries included (NUTRIKIT_AI_TIMEOUT_MS, default 60 s). */
export const aiDeadline = (): AbortSignal => AbortSignal.timeout(Number(process.env.NUTRIKIT_AI_TIMEOUT_MS) || 60_000);

/** The error a provider throws when its deadline passes: 504, and no usage, so nothing is charged. */
export const aiTimeout = (): Error => Object.assign(new Error('the AI provider did not answer in time; try again'), { status: 504, code: 'ai_timeout' });

let active: AIProvider | undefined;

export async function getProvider(): Promise<AIProvider> {
  if (active) return active;
  const name = process.env.NUTRIKIT_AI_PROVIDER
    || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'none');
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
