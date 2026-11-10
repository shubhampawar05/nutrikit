// Free-text meal logging: "2 eggs, a slice of whole wheat toast and a cup of coffee with milk"
// -> matched foods with portions and nutrients. Rule-based; the AI provider can supply the
// item split instead (see providers/), and both paths share resolveItems().
import { getFood } from './db.ts';
import { searchFoods, wordCoverage } from './search.ts';
import { canonicalUnit, parseQuantity, resolvePortion } from './units.ts';
import { scaleNutrients, sumNutrients } from './nutrients.ts';
import type { Food, NutrientMap, ResolvedPortion } from './types.ts';
import { lookup } from './lookup.ts';

/** A phrase split from meal text by splitMealText(). */
export interface ParsedItem {
  text: string;
  food: string;
  quantity: number | null;
  unit: string | null;
  addOn: boolean;
}

/** Input to resolveItems(): a parsed phrase, or an AI provider's item (which may carry grams). */
export interface Phrase {
  food: string;
  quantity?: number | null;
  unit?: string | null;
  grams?: number | null;
  text?: string;
  addOn?: boolean;
}

export interface LoggedItem {
  input: string;
  food: { id: number; name: string; source: string };
  quantity: number;
  unit: string;
  grams: number;
  portionBasis: string | null;
  portionMethod: string;
  confidence: 'high' | 'medium' | 'low';
  nutrients: NutrientMap;
  alternatives: { id: number; name: string }[];
}

export interface Unmatched {
  text: string;
  reason: string;
  /** Foods sharing some of the phrase's words, when the best of them was too weak to log. */
  suggestions?: { id: number; name: string }[];
  /** The phrase respelled ("1 cup panner" -> "1 cup paneer") when only the respelling matches a food. */
  didYouMean?: string;
}

// "1 cup panner" with food "panner" respelled "paneer" -> "1 cup paneer".
function respellPhrase(text: string, food: string, respelled: string): string {
  const at = text.toLowerCase().indexOf(food.toLowerCase());
  return at < 0 ? respelled : text.slice(0, at) + respelled + text.slice(at + food.length);
}

export interface ResolvedItems {
  items: LoggedItem[];
  unmatched: Unmatched[];
  totals: NutrientMap;
}

export interface TextLog extends ResolvedItems {
  meal: string | null;
}

// Captured so we know which phrases were add-ons ("coffee *with* milk").
const SEPARATORS = /(\s*(?:,|;|\n|\+|&|\band then\b|\band\b|\balong with\b|\bwith\b|\bplus\b)\s*)/i;
const FILLER = /^(so|then|also|well|okay|ok|and|just|i\s+(?:just\s+|also\s+)?(?:had|ate|drank|have had|have|eaten|grabbed|got)|i've\s+(?:had|eaten)|for\s+(?:breakfast|lunch|dinner|snack)\s*,?\s*(?:i\s+(?:had|ate))?|today\s+i\s+(?:had|ate)|some|about|around|approximately|roughly)\b[,]?\s*/i;
const MEALS: Record<string, string> = lookup({ breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', supper: 'dinner', snack: 'snack' });

/** Split a sentence into { quantity, unit, food } phrases. */
export function splitMealText(text: string): { meal: string | null; items: ParsedItem[] } {
  const meal = Object.keys(MEALS).find((m) => new RegExp(`\\b${m}\\b`, 'i').test(text));
  const items: ParsedItem[] = [];
  const parts = String(text).split(SEPARATORS);
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i];
    const addOn = i > 0 && /\bwith\b/i.test(parts[i - 1]);
    let s = raw.trim().replace(/[.!?]+$/, '');
    for (let k = 0; k < 4; k++) s = s.replace(FILLER, '').trim();
    s = s.replace(/\bfor (breakfast|lunch|dinner|supper|snack)\b/i, '').trim();
    if (!s) continue;
    const { value, rest } = parseQuantity(s);
    let r = rest;
    // Unit: "cup", "fl oz", "g" (also glued: "200g")
    let unit: string | null = null;
    const glued = r.match(/^(g|kg|mg|oz|lb|ml|l)\b\.?\s*/i);
    const two = r.match(/^(fl\.? oz|fluid ounces?)\b\s*/i);
    const one = r.match(/^([a-z]+)\b\.?\s*/i);
    if (two) { unit = 'fl oz'; r = r.slice(two[0].length); }
    else if (glued) { unit = glued[1].toLowerCase(); r = r.slice(glued[0].length); }
    else if (one && canonicalUnit(one[1]) && r.split(/\s+/).length > 1) { unit = one[1].toLowerCase(); r = r.slice(one[0].length); }
    r = r.replace(/^(of|the)\s+/i, '').trim();
    // Trailing amounts: "chicken 200 g"
    const trailing = r.match(/\s+(\d+(?:\.\d+)?)\s*(g|grams?|oz|ml|kg)$/i);
    let quantity = value;
    if (trailing && value == null) {
      quantity = Number(trailing[1]);
      unit = trailing[2].toLowerCase();
      r = r.slice(0, trailing.index).trim();
    }
    if (!r) continue;
    items.push({ text: s, food: r, quantity, unit, addOn });
  }
  return { meal: meal ? MEALS[meal] : null, items };
}

// Unquantified add-ons ("with sugar", "with milk") are a spoonful or a splash, never a cup: rich add-ons
// (sugars, fats, sauces) are capped at 15 g, anything else at 60 g. Within the cap the food's largest household
// portion of at least 3 g is used (1 tsp sugar, 1 fl oz milk); without one, the cap itself in grams.
const RICH_ADD_ON = /\b(sugar|syrup|honey|jam|jelly|marmalade|butter|ghee|margarine|oil|mayonnaise|cream|dressing|sauce|ketchup|catsup|chutney)\b/i;

export function addOnPortion(food: Pick<Food, 'name' | 'portions'>): ResolvedPortion {
  const cap = RICH_ADD_ON.test(food.name) ? 15 : 60;
  const fits = food.portions
    .map((p) => ({ p, each: p.grams / p.amount }))
    .filter(({ each }) => each >= 3 && each <= cap)
    .sort((a, b) => b.each - a.each)[0];
  if (fits) return { grams: fits.each, quantity: 1, unit: fits.p.unit || 'serving', portion: fits.p.label, method: 'add-on-smallest-portion' };
  return { grams: cap, quantity: cap, unit: 'g', portion: null, method: 'add-on-cap' };
}

/**
 * Turn one phrase into a logged item, or an unmatched entry. Phrase: { food, quantity?, unit?, grams?, text? }.
 * A phrase may carry `grams` directly (e.g. AI portion estimates), which overrides unit parsing.
 */
export function resolvePhrase(ph: Phrase, { alternatives = 3 }: { alternatives?: number } = {}): { item: LoggedItem } | { unmatched: Unmatched } {
  const found = searchFoods(ph.food, { limit: alternatives + 1 });
  const text = ph.text || ph.food;
  if (!found.results.length) return { unmatched: { text, reason: 'no matching food' } };
  // Only a respelling matched: suggest it rather than log a food the user may not have meant.
  if (found.didYouMean) {
    const suggestions = found.results.map((r) => ({ id: r.id, name: r.name }));
    return { unmatched: { text, reason: 'no matching food', suggestions, didYouMean: respellPhrase(text, ph.food, found.didYouMean) } };
  }
  // A fallback match (prefix or any one word) is logged only when the food shares more than half of the phrase's
  // words; otherwise "butter chicken" would be logged as butter. Weaker hits are offered as suggestions instead.
  if (found.match !== 'all-words' && wordCoverage(ph.food, found.results[0].name) <= 0.5) {
    const suggestions = found.results.filter((r) => wordCoverage(ph.food, r.name) > 0).map((r) => ({ id: r.id, name: r.name }));
    return { unmatched: { text, reason: 'no confident match', ...(suggestions.length ? { suggestions } : {}) } };
  }
  const best = getFood(found.results[0].id)!;
  let portion: ResolvedPortion;
  if (ph.grams) {
    portion = { grams: ph.grams, quantity: ph.quantity ?? 1, unit: ph.unit || 'serving', portion: null, method: 'provided-grams' };
  } else if (ph.addOn && ph.quantity == null && !ph.unit) {
    portion = addOnPortion(best);
  } else {
    portion = resolvePortion(best, ph.quantity, ph.unit);
  }
  const grams = Math.round(portion.grams * 10) / 10;
  return {
    item: {
      input: text,
      food: { id: best.id, name: best.name, source: best.source },
      quantity: portion.quantity,
      unit: portion.unit,
      grams,
      portionBasis: portion.portion,
      portionMethod: portion.method,
      confidence: found.relaxed ? 'low' : found.results[0].score > 15 ? 'high' : 'medium',
      nutrients: scaleNutrients(best.per100g, grams),
      alternatives: found.results.slice(1).map((r) => ({ id: r.id, name: r.name })),
    },
  };
}

/** Turn parsed phrases into logged items, unmatched phrases and meal totals. */
export function resolveItems(phrases: Phrase[], opts: { alternatives?: number } = {}): ResolvedItems {
  const items: LoggedItem[] = [];
  const unmatched: Unmatched[] = [];
  for (const ph of phrases) {
    const r = resolvePhrase(ph, opts);
    if ('item' in r) items.push(r.item);
    else unmatched.push(r.unmatched);
  }
  return { items, unmatched, totals: sumNutrients(items.map((i) => i.nutrients)) };
}

export function logText(text: string): TextLog {
  const { meal, items } = splitMealText(text);
  return { meal, ...resolveItems(items) };
}
