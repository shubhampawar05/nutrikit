// Nutrient catalog: the stable keys the API exposes, the USDA FoodData Central nutrient ids each
// key is read from (first id present wins), the unit, and the FDA reference daily value used for
// %DV (21 CFR 101.9, adults and children >= 4 years).
import type { NutrientDef, NutrientMap, Per100g } from './types.ts';
import { lookup } from './lookup.ts';

export const NUTRIENTS: NutrientDef[] = [
  { key: 'calories', name: 'Energy', unit: 'kcal', fdc: [1008, 2048, 2047], dv: 2000, group: 'macro' },
  { key: 'protein', name: 'Protein', unit: 'g', fdc: [1003], dv: 50, group: 'macro' },
  { key: 'fat', name: 'Total fat', unit: 'g', fdc: [1004], dv: 78, group: 'macro' },
  { key: 'carbs', name: 'Total carbohydrate', unit: 'g', fdc: [1005], dv: 275, group: 'macro' },
  { key: 'fiber', name: 'Dietary fiber', unit: 'g', fdc: [1079], dv: 28, group: 'macro' },
  { key: 'sugar', name: 'Total sugars', unit: 'g', fdc: [2000, 1063], dv: null, group: 'macro' },
  { key: 'addedSugar', name: 'Added sugars', unit: 'g', fdc: [1235], dv: 50, group: 'macro' },
  { key: 'saturatedFat', name: 'Saturated fat', unit: 'g', fdc: [1258], dv: 20, group: 'fat' },
  { key: 'transFat', name: 'Trans fat', unit: 'g', fdc: [1257], dv: null, group: 'fat' },
  { key: 'monounsaturatedFat', name: 'Monounsaturated fat', unit: 'g', fdc: [1292], dv: null, group: 'fat' },
  { key: 'polyunsaturatedFat', name: 'Polyunsaturated fat', unit: 'g', fdc: [1293], dv: null, group: 'fat' },
  { key: 'cholesterol', name: 'Cholesterol', unit: 'mg', fdc: [1253], dv: 300, group: 'fat' },
  { key: 'sodium', name: 'Sodium', unit: 'mg', fdc: [1093], dv: 2300, group: 'mineral' },
  { key: 'potassium', name: 'Potassium', unit: 'mg', fdc: [1092], dv: 4700, group: 'mineral' },
  { key: 'calcium', name: 'Calcium', unit: 'mg', fdc: [1087], dv: 1300, group: 'mineral' },
  { key: 'iron', name: 'Iron', unit: 'mg', fdc: [1089], dv: 18, group: 'mineral' },
  { key: 'magnesium', name: 'Magnesium', unit: 'mg', fdc: [1090], dv: 420, group: 'mineral' },
  { key: 'phosphorus', name: 'Phosphorus', unit: 'mg', fdc: [1091], dv: 1250, group: 'mineral' },
  { key: 'zinc', name: 'Zinc', unit: 'mg', fdc: [1095], dv: 11, group: 'mineral' },
  { key: 'vitaminA', name: 'Vitamin A (RAE)', unit: 'mcg', fdc: [1106], dv: 900, group: 'vitamin' },
  { key: 'vitaminC', name: 'Vitamin C', unit: 'mg', fdc: [1162], dv: 90, group: 'vitamin' },
  { key: 'vitaminD', name: 'Vitamin D', unit: 'mcg', fdc: [1114], dv: 20, group: 'vitamin' },
  { key: 'vitaminE', name: 'Vitamin E', unit: 'mg', fdc: [1109], dv: 15, group: 'vitamin' },
  { key: 'vitaminK', name: 'Vitamin K', unit: 'mcg', fdc: [1185], dv: 120, group: 'vitamin' },
  { key: 'thiamin', name: 'Thiamin (B1)', unit: 'mg', fdc: [1165], dv: 1.2, group: 'vitamin' },
  { key: 'riboflavin', name: 'Riboflavin (B2)', unit: 'mg', fdc: [1166], dv: 1.3, group: 'vitamin' },
  { key: 'niacin', name: 'Niacin (B3)', unit: 'mg', fdc: [1167], dv: 16, group: 'vitamin' },
  { key: 'vitaminB6', name: 'Vitamin B6', unit: 'mg', fdc: [1175], dv: 1.7, group: 'vitamin' },
  { key: 'folate', name: 'Folate (DFE)', unit: 'mcg', fdc: [1190, 1177], dv: 400, group: 'vitamin' },
  { key: 'vitaminB12', name: 'Vitamin B12', unit: 'mcg', fdc: [1178], dv: 2.4, group: 'vitamin' },
  { key: 'caffeine', name: 'Caffeine', unit: 'mg', fdc: [1057], dv: null, group: 'other' },
  { key: 'alcohol', name: 'Alcohol', unit: 'g', fdc: [1018], dv: null, group: 'other' },
  { key: 'water', name: 'Water', unit: 'g', fdc: [1051], dv: null, group: 'other' },
];

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);
export const BY_KEY: Record<string, NutrientDef> = lookup(Object.fromEntries(NUTRIENTS.map((n) => [n.key, n])));

const round = (v: number | null | undefined, unit: string): number | null => {
  if (v == null) return null;
  const digits = unit === 'kcal' || Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

// Scale per-100 g values to an amount in grams and attach units and %DV.
export function scaleNutrients(per100g: Per100g, grams: number): NutrientMap {
  const out: NutrientMap = {};
  for (const n of NUTRIENTS) {
    const base = per100g[n.key];
    if (base == null) continue;
    const amount = (base * grams) / 100;
    out[n.key] = {
      amount: round(amount, n.unit),
      unit: n.unit,
      dailyValuePercent: n.dv ? Math.round((amount / n.dv) * 100) : null,
    };
  }
  return out;
}

// Sum the nutrient maps of individual foods (as returned by scaleNutrients). A total that some foods have no value
// for is a lower bound: `missingFrom` says how many of them lacked it. A nutrient no food has stays absent.
export function sumNutrients(list: NutrientMap[]): NutrientMap {
  const totals: Record<string, number> = {};
  const present: Record<string, number> = {};
  for (const map of list) {
    for (const [key, v] of Object.entries(map)) {
      if (v.amount == null) continue;
      totals[key] = (totals[key] ?? 0) + v.amount;
      present[key] = (present[key] ?? 0) + 1;
    }
  }
  const out: NutrientMap = {};
  for (const n of NUTRIENTS) {
    if (totals[n.key] == null) continue;
    const missing = list.length - present[n.key];
    out[n.key] = {
      amount: round(totals[n.key], n.unit),
      unit: n.unit,
      dailyValuePercent: n.dv ? Math.round((totals[n.key] / n.dv) * 100) : null,
      ...(missing ? { missingFrom: missing } : {}),
    };
  }
  return out;
}
