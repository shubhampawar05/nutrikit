// The AI stand-in for test keys: fixed answers, no model calls, no AI usage. Results still go through the same
// catalog matching as live calls, so responses have the real shape. Photo recognition always "sees" the same plate,
// labels always read the same panel, and AI text logging uses the rule-based parser.
import { logText } from '../textlog.ts';
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
      perServing: { calories: 210, protein: 6, fat: 3, saturatedFat: 0.5, carbohydrates: 40, fiber: 5, sugars: 9, sodium: 190 },
      usage: NO_USAGE,
    };
  },
  async parseMeal({ text }) {
    const r = logText(text);
    return {
      meal: r.meal ?? null,
      notes: 'Sample result for test keys: parsed with the rule-based parser.',
      items: r.items.map((i) => ({ food: i.food.name, quantity: i.grams, unit: 'g', grams: i.grams, confidence: i.confidence })),
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
