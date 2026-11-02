// US "Nutrition Facts" label parsing from text (OCR output or typed). The AI provider can read a
// label photo straight into the same shape (see providers/prompts.ts).
import { BY_KEY, NUTRIENTS } from './nutrients.ts';

const num = '(\\d+(?:[.,]\\d+)?)';
// Label wording -> catalog key. Order matters: specific phrases before general ones.
const PATTERNS: [string, string[]][] = [
  ['addedSugar', [`includes\\s+${num}\\s*(g)\\s+added\\s+sugars?`, `added\\s+sugars?\\s+${num}\\s*(g)`]],
  ['sugar', [`total\\s+sugars?\\s+${num}\\s*(g)`, `(?<!added\\s)sugars?\\s+${num}\\s*(g)`]],
  ['saturatedFat', [`saturated\\s+fat\\s+${num}\\s*(g)`]],
  ['transFat', [`trans\\s+fat\\s+${num}\\s*(g)`]],
  ['polyunsaturatedFat', [`polyunsaturated\\s+fat\\s+${num}\\s*(g)`]],
  ['monounsaturatedFat', [`monounsaturated\\s+fat\\s+${num}\\s*(g)`]],
  ['fat', [`total\\s+fat\\s+${num}\\s*(g)`, `(?<!saturated\\s|trans\\s)\\bfat\\s+${num}\\s*(g)`]],
  ['cholesterol', [`cholesterol\\s+(?:less\\s+than\\s+)?${num}\\s*(mg)`]],
  ['sodium', [`sodium\\s+${num}\\s*(mg|g)`]],
  ['fiber', [`dietary\\s+fib(?:er|re)\\s+${num}\\s*(g)`, `fib(?:er|re)\\s+${num}\\s*(g)`]],
  ['carbs', [`total\\s+carbohydrates?\\s+${num}\\s*(g)`, `carbohydrates?\\s+${num}\\s*(g)`]],
  ['protein', [`protein\\s+${num}\\s*(g)`]],
  ['vitaminD', [`vitamin\\s+d\\s+${num}\\s*(mcg|µg|ug)`]],
  ['calcium', [`calcium\\s+${num}\\s*(mg)`]],
  ['iron', [`iron\\s+${num}\\s*(mg)`]],
  ['potassium', [`potassium\\s+${num}\\s*(mg)`]],
  ['vitaminA', [`vitamin\\s+a\\s+${num}\\s*(mcg|µg|ug)`]],
  ['vitaminC', [`vitamin\\s+c\\s+${num}\\s*(mg)`]],
  ['magnesium', [`magnesium\\s+${num}\\s*(mg)`]],
  ['zinc', [`zinc\\s+${num}\\s*(mg)`]],
  ['caffeine', [`caffeine\\s+${num}\\s*(mg)`]],
];

const toNumber = (s: string) => Number(String(s).replace(',', '.'));

export interface LabelAmount {
  amount: number;
  unit: string;
}

export interface ParsedLabel {
  servingSize: string | null;
  servingGrams: number | null;
  servingsPerContainer: number | null;
  perServing: Record<string, LabelAmount>;
  per100g: Record<string, number> | null;
  warnings: string[];
}

/**
 * @param {string} text label text
 * @returns {{servingSize: string|null, servingGrams: number|null, servingsPerContainer: number|null,
 *   perServing: Record<string, {amount:number, unit:string}>, per100g: Record<string, number>|null, warnings: string[]}}
 */
export function parseLabelText(text: string): ParsedLabel {
  const t = String(text).replace(/\s+/g, ' ').replace(/(\d)\s+(g|mg|mcg)\b/gi, '$1$2');
  const warnings: string[] = [];
  const servingMatch = t.match(/serving\s+size\s*:?\s*([^()]*?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\s*\)/i)
    || t.match(/serving\s+size\s*:?\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  let servingSize: string | null = null;
  let servingGrams: number | null = null;
  if (servingMatch) {
    if (servingMatch.length === 4) {
      servingSize = `${servingMatch[1].trim()} (${servingMatch[2]}${servingMatch[3]})`.trim();
      servingGrams = toNumber(servingMatch[2]);
    } else {
      servingSize = `${servingMatch[1]}${servingMatch[2]}`;
      servingGrams = toNumber(servingMatch[1]);
    }
    if (/ml/i.test(servingMatch.at(-1)!)) warnings.push('serving given in ml; assumed 1 ml = 1 g for per-100 g values');
  } else warnings.push('serving size not found');
  const spc = t.match(/(?:about\s+)?(\d+(?:[.,]\d+)?)\s+servings?\s+per\s+container/i) || t.match(/servings?\s+per\s+container\s*:?\s*(?:about\s+)?(\d+(?:[.,]\d+)?)/i);

  const perServing: Record<string, LabelAmount> = {};
  // "Calories 230" (not "Calories from Fat 70"); \b stops backtracking to a shorter number.
  const cal = t.match(/calories(?!\s+from)\s*:?\s*(\d+)\b/i);
  if (cal) perServing.calories = { amount: Number(cal[1]), unit: 'kcal' };
  else warnings.push('calories not found');
  for (const [key, patterns] of PATTERNS) {
    for (const p of patterns) {
      const m = t.match(new RegExp(p, 'i'));
      if (m) {
        let amount = toNumber(m[1]);
        const unit = m[2].toLowerCase().replace(/µg|ug/, 'mcg');
        if (key === 'sodium' && unit === 'g') amount *= 1000;
        perServing[key] = { amount, unit: BY_KEY[key].unit };
        break;
      }
    }
  }
  let per100g: Record<string, number> | null = null;
  if (servingGrams) {
    per100g = {};
    for (const [key, v] of Object.entries(perServing)) per100g[key] = Math.round((v.amount / servingGrams) * 100 * 100) / 100;
  }
  const ordered = Object.fromEntries(NUTRIENTS.filter((n) => perServing[n.key]).map((n) => [n.key, perServing[n.key]]));
  return {
    servingSize,
    servingGrams,
    servingsPerContainer: spc ? toNumber(spc[1]) : null,
    perServing: ordered,
    per100g,
    warnings,
  };
}
