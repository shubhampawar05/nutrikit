// Free-text meal logging: "2 eggs, a slice of whole wheat toast and a cup of coffee with milk"
// -> matched foods with portions and nutrients. Rule-based; the AI provider can supply the
// item split instead (see providers/), and both paths share resolveItems().
import { getFood } from './db.ts';
import { searchFoods } from './search.ts';
import { canonicalUnit, parseQuantity, resolvePortion } from './units.ts';
import { scaleNutrients, sumNutrients } from './nutrients.ts';
import type { NutrientMap, ResolvedPortion } from './types.ts';
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

/**
 * Turn parsed phrases into logged items. Each phrase: { food, quantity?, unit?, grams?, text? }.
 * A phrase may carry `grams` directly (e.g. AI portion estimates), which overrides unit parsing.
 */
export function resolveItems(phrases: Phrase[], { alternatives = 3 }: { alternatives?: number } = {}): ResolvedItems {
  const items: LoggedItem[] = [];
  const unmatched: Unmatched[] = [];
  for (const ph of phrases) {
    const found = searchFoods(ph.food, { limit: alternatives + 1 });
    if (!found.results.length) {
      unmatched.push({ text: ph.text || ph.food, reason: 'no matching food' });
      continue;
    }
    const best = getFood(found.results[0].id)!;
    let portion: ResolvedPortion;
    if (ph.grams) {
      portion = { grams: ph.grams, quantity: ph.quantity ?? 1, unit: ph.unit || 'serving', portion: null, method: 'provided-grams' };
    } else if (ph.addOn && ph.quantity == null && !ph.unit && best.portions.length) {
      // An unquantified add-on ("with milk") gets the food's smallest listed portion of at least
      // 10 g, so "with blueberries" is not a single berry.
      const bySize = [...best.portions].sort((a, b) => a.grams / a.amount - b.grams / b.amount);
      const p = bySize.find((x) => x.grams / x.amount >= 10) || bySize.at(-1)!;
      portion = { grams: p.grams / p.amount, quantity: 1, unit: p.unit || 'serving', portion: p.label, method: 'add-on-smallest-portion' };
    } else {
      portion = resolvePortion(best, ph.quantity, ph.unit);
    }
    const grams = Math.round(portion.grams * 10) / 10;
    items.push({
      input: ph.text || ph.food,
      food: { id: best.id, name: best.name, source: best.source },
      quantity: portion.quantity,
      unit: portion.unit,
      grams,
      portionBasis: portion.portion,
      portionMethod: portion.method,
      confidence: found.relaxed ? 'low' : found.results[0].score > 15 ? 'high' : 'medium',
      nutrients: scaleNutrients(best.per100g, grams),
      alternatives: found.results.slice(1).map((r) => ({ id: r.id, name: r.name })),
    });
  }
  return { items, unmatched, totals: sumNutrients(items.map((i) => i.nutrients)) };
}

export function logText(text: string): TextLog {
  const { meal, items } = splitMealText(text);
  return { meal, ...resolveItems(items) };
}
