// The AI stand-in for test keys: fixed answers, no model calls, no AI usage. Results still go through the same
// catalog matching as live calls, so responses have the real shape. Photo recognition always "sees" the same plate,
// labels always read the same panel, and AI text logging uses the rule-based parser.
import { logText, splitMealText } from '../textlog.ts';
import type { AIProvider } from './index.ts';

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

export const sampleProvider: AIProvider = {
  name: 'test',
  model: 'sample',
  async recognizeMeal() {
    return {
      meal: 'lunch',
      notes: 'Sample result for test keys: the same plate is returned for every image.',
      items: [
        { food: 'dal', quantity: 1, unit: 'cup', grams: 240, confidence: 'high' },
        { food: 'white rice cooked', quantity: 1, unit: 'cup', grams: 158, confidence: 'high' },
        { food: 'roti', quantity: 2, unit: 'piece', grams: 80, confidence: 'medium' },
      ],
      usage: NO_USAGE,
    };
  },
  async readLabel() {
    return {
      isNutritionLabel: true,
      servingSize: '1 cup (55 g)',
      servingGrams: 55,
      servingsPerContainer: 8,
      perServing: { calories: 210, protein: 6, fat: 3, saturatedFat: 0.5, carbs: 40, fiber: 5, sugar: 9, sodium: 190 },
      usage: NO_USAGE,
    };
  },
  async parseMeal({ text }) {
    const r = logText(text);
    return {
      meal: r.meal ?? null,
      notes: 'Sample result for test keys: parsed with the rule-based parser.',
      items: [
        ...r.items.map((i) => ({ food: i.food.name, quantity: i.grams, unit: 'g', grams: i.grams, confidence: i.confidence })),
        // Foods the catalog lacks are passed on as named, so they reach the sample estimate below.
        ...r.unmatched.flatMap((u) => splitMealText(u.text).items.map((p) => ({ food: p.food, quantity: p.quantity ?? 1, unit: p.unit ?? 'serving', grams: 0, confidence: 'low' as const }))),
      ],
      usage: NO_USAGE,
    };
  },
  async estimateFoods({ foods }) {
    // Every unknown food gets the same fixed estimate, so tests can rely on it.
    return {
      foods: foods.map((query) => ({
        query,
        known: true,
        name: `Sample estimate for "${query}"`,
        per100g: { calories: 150, protein: 5, fat: 6, carbs: 19, fiber: 2, sugar: 3, saturatedFat: 1.5, sodium: 300 },
        serving: { label: '1 bowl', unit: 'bowl', grams: 200 },
        confidence: 'low' as const,
        sameAs: null,
      })),
      usage: NO_USAGE,
    };
  },
  async advise() {
    return {
      answer: 'This is a sample answer for test keys. Live keys get an answer written for your question.\n\n'
        + '- Build meals around vegetables, whole grains and a protein source.\n- Drink water through the day.',
      declined: false,
      usage: NO_USAGE,
    };
  },
};
