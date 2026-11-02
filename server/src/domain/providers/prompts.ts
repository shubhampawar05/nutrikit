// Prompts and output schemas shared by the AI providers, so every provider returns the same shapes.
import { NUTRIENT_KEYS } from '../nutrients.ts';
import type { AIFoodItem, LabelReading } from './index.ts';

// Model output shapes; the API constrains them to FOOD_ITEMS_SCHEMA / LABEL_SCHEMA.
export interface FoodItemsOutput {
  meal: string | null;
  notes: string;
  items: AIFoodItem[];
}

export type LabelOutput = Omit<LabelReading, 'usage'>;

export const FOOD_ITEMS_SCHEMA = {
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

export const LABEL_SCHEMA = {
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

export const PHOTO_SYSTEM = `You identify foods in meal photos for a nutrition-logging app.
List each distinct food or drink you can see as a separate item with a generic database-style name,
a household quantity and unit, and your best estimate of its edible weight in grams (use plate,
utensil and packaging cues for scale). Do not list garnishes under 5 g. If the photo shows no food,
return an empty items list and say so in notes. Use the meal field only if the context makes it clear.`;

export const LABEL_SYSTEM = `You transcribe nutrition facts panels from product photos. Report values exactly as
printed, per serving, in these units: calories kcal; fats, carbs, fiber, sugars, protein in g;
cholesterol, sodium, potassium, calcium, iron, magnesium, zinc, vitamin C, caffeine in mg;
vitamin A, D, K, folate, B12 in mcg. Use null for anything not printed. Convert "less than 1g" to 0.5.
If the image is not a nutrition label, set isNutritionLabel to false and leave the rest null.`;

export const TEXT_SYSTEM = `You split a person's description of what they ate into individual foods for a
nutrition-logging app. One item per food or drink, with a generic database-style name, the quantity
and unit they said (or a typical single serving if unstated), and an edible-weight estimate in grams.`;
