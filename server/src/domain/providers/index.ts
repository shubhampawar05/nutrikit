// AI provider selection. A provider implements any of:
//   recognizeMeal({ image, mediaType, hint }) -> { items: [{ food, quantity, unit, grams, confidence }], notes, usage }
//   readLabel({ image, mediaType })           -> { servingSize, servingGrams, servingsPerContainer, perServing, usage }
//   parseMeal({ text })                        -> { meal, items: [{ food, quantity, unit, grams }], usage }
//   advise({ question, context })              -> { answer, declined, usage }
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
}

/** The capability methods a provider may implement. */
export type AICapability = 'recognizeMeal' | 'readLabel' | 'parseMeal' | 'advise';

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
