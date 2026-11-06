// Quantities, units and portion resolution: turns "1 1/2 cups", "200 g", "a large" into grams
// for a specific food, using the food's household portions when the unit is not a mass.
import type { Portion, ResolvedPortion } from './types.ts';
import { lookup } from './lookup.ts';
import { headSegments } from './names.ts';

const WORD_NUMBERS: Record<string, number> = lookup({
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, couple: 2, few: 3, dozen: 12, single: 1, double: 2,
});
const UNICODE_FRACTIONS: Record<string, number> = lookup({ '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 });

const MASS: Record<string, number> = lookup({ g: 1, gram: 1, grams: 1, gr: 1, kg: 1000, kilogram: 1000, kilograms: 1000, mg: 0.001, oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592 });
// Volumes in US cups.
const VOLUME: Record<string, number> = lookup({ cup: 1, cups: 1, c: 1, tbsp: 1 / 16, tablespoon: 1 / 16, tablespoons: 1 / 16, tbs: 1 / 16, tsp: 1 / 48, teaspoon: 1 / 48, teaspoons: 1 / 48, 'fl oz': 1 / 8, ml: 1 / 236.588, milliliter: 1 / 236.588, milliliters: 1 / 236.588, l: 4.22675, liter: 4.22675, liters: 4.22675, pint: 2, pints: 2, glass: 1, glasses: 1, mug: 1.5, mugs: 1.5 });
const COUNT: Record<string, string> = lookup({ slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', serving: 'serving', servings: 'serving', small: 'small', medium: 'medium', large: 'large', extra: 'extra', bowl: 'bowl', bowls: 'bowl', can: 'can', cans: 'can', bottle: 'bottle', bottles: 'bottle', bar: 'bar', bars: 'bar', scoop: 'scoop', scoops: 'scoop', handful: 'handful', handfuls: 'handful', stick: 'stick', sticks: 'stick', strip: 'strip', strips: 'strip', fillet: 'fillet', fillets: 'fillet', patty: 'patty', patties: 'patty', link: 'link', links: 'link', packet: 'packet', packets: 'packet', package: 'package', container: 'container', sandwich: 'sandwich', wedge: 'wedge', wedges: 'wedge', clove: 'clove', cloves: 'clove', leaf: 'leaf', leaves: 'leaf', jar: 'jar' });

export const UNIT_WORDS = [...Object.keys(MASS), ...Object.keys(VOLUME), ...Object.keys(COUNT)];

export type CanonicalUnit =
  | { kind: 'mass'; unit: string; grams: number }
  | { kind: 'volume'; unit: string; cups: number }
  | { kind: 'count'; unit: string };

/** Canonical unit: { kind: 'mass'|'volume'|'count', unit, factor? } or null. */
export function canonicalUnit(word: string | null | undefined): CanonicalUnit | null {
  if (!word) return null;
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w in MASS) return { kind: 'mass', unit: w === 'gram' || w === 'grams' || w === 'gr' ? 'g' : w, grams: MASS[w] };
  if (w in VOLUME) return { kind: 'volume', unit: w, cups: VOLUME[w] };
  if (w in COUNT) return { kind: 'count', unit: COUNT[w] };
  return null;
}

/** Parse a leading quantity. Returns { value, rest } (value null if none). */
export function parseQuantity(text: string): { value: number | null; rest: string } {
  let s = text.trim();
  let value: number | null = null;
  const m = s.match(/^(\d+)\s+(\d+)\/(\d+)\b/) // 1 1/2
    || s.match(/^(\d+)\/(\d+)\b/) // 1/2
    || s.match(/^(\d+(?:\.\d+)?)\s*([½⅓⅔¼¾⅛])?/) // 2, 2.5, 1½
    || s.match(/^([½⅓⅔¼¾⅛])/);
  if (m) {
    if (m.length === 4 && m[3] !== undefined && /\//.test(m[0])) value = Number(m[1]) + Number(m[2]) / Number(m[3]);
    else if (/^\d+\/\d+/.test(m[0])) value = Number(m[1]) / Number(m[2]);
    else if (UNICODE_FRACTIONS[m[1]]) value = UNICODE_FRACTIONS[m[1]];
    else value = Number(m[1]) + (m[2] ? UNICODE_FRACTIONS[m[2]] : 0);
    s = s.slice(m[0].length).trim();
  } else {
    const w = s.match(/^([a-z]+)\b/i);
    if (w && WORD_NUMBERS[w[1].toLowerCase()] !== undefined) {
      value = WORD_NUMBERS[w[1].toLowerCase()];
      s = s.slice(w[0].length).trim();
      // "half a cup", "a couple of", "a dozen"
      const more = s.match(/^(a|an|of)\b\s*/i);
      if (more) s = s.slice(more[0].length).trim();
      const mult = s.match(/^(dozen|couple|half)\b/i);
      if (mult) { value *= WORD_NUMBERS[mult[1].toLowerCase()]; s = s.slice(mult[0].length).trim(); }
    }
  }
  return { value, rest: s };
}

const VOLUME_PORTIONS: Record<string, number> = lookup({ cup: 1, tbsp: 1 / 16, tsp: 1 / 48, 'fl oz': 1 / 8 });
const SNACK = /nuts and seeds|chips|candy|crackers|pretzels|popcorn|cereal bars/i;
const YIELDS = /\byields\b/i;
const TYPICAL_SIZE = /\b(medium|regular)\b/i;
const SIZE_DOWN = /\b(small|mini|miniature|thin|snack[- ]size|bite[- ]size|fun size)\b/i;
const LIQUID = /\b(juice|milk|coffee|tea|soda|soft drink|beverage|water|beer|wine|smoothie|shake|drink|lemonade|kombucha)\b/i;
const singular = (w: string) => (w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);

/**
 * Resolve a quantity + unit for a food into grams.
 * @param {{name: string, portions: {label: string, amount: number, unit: string|null, grams: number}[]}} food
 * @param {number|null} quantity
 * @param {string|null} unitWord
 * @returns {{grams: number, quantity: number, unit: string, portion: string|null, method: string}}
 */
export interface PortionFood {
  name: string;
  category?: string | null;
  portions?: Portion[] | null;
}


// Typical servings for foods sold by size whose catalog entry has no size portions (USDA FNDDS fast-food sizes).
// Sizes the food has no entry for here fall back to its default portion, so small <= medium <= large holds.
type Size = 'small' | 'medium' | 'large';
const SIZES: string[] = ['small', 'medium', 'large'];
const SIZE_SERVINGS: [RegExp, Record<Size, number>][] = [
  [/\bfrench fries\b/i, { small: 71, medium: 117, large: 154 }],
];
export function resolvePortion(food: PortionFood, quantity: number | null | undefined, unitWord: string | null | undefined): ResolvedPortion {
  const q = quantity ?? 1;
  const unit = canonicalUnit(unitWord);
  const portions = food.portions || [];
  const perUnit = (p: Portion) => p.grams / (p.amount || 1);

  // "12 oz orange juice" means fluid ounces for drinks.
  if (unit?.unit === 'oz' && LIQUID.test(`${food.name} ${food.category || ''}`) && portions.some((p) => VOLUME_PORTIONS[p.unit as string])) {
    return resolvePortion(food, q, 'fl oz');
  }
  if (unit?.kind === 'mass') {
    return { grams: q * unit.grams, quantity: q, unit: unit.unit, portion: null, method: 'mass' };
  }
  if (unit?.unit === 'handful') {
    const oz = portions.find((p) => p.unit === 'oz');
    return { grams: q * (oz ? perUnit(oz) : 28.35), quantity: q, unit: 'handful', portion: oz?.label || null, method: 'estimate-1oz' };
  }
  if (unit?.kind === 'volume') {
    // Prefer a portion in the same unit, else convert through any volume portion of this food. "1 cup, dry,
    // yields" weighs the cooked result of a dry cup (740 g for barley), so it is never a volume of this food.
    const volumes = portions.filter((p) => !YIELDS.test(p.label));
    const same = volumes.find((p) => p.unit === unit.unit || (unit.unit === 'cups' && p.unit === 'cup'));
    if (same) return { grams: q * perUnit(same), quantity: q, unit: unit.unit, portion: same.label, method: 'portion' };
    const vol = volumes.find((p) => VOLUME_PORTIONS[p.unit as string]);
    if (vol) {
      const gramsPerCup = perUnit(vol) / VOLUME_PORTIONS[vol.unit as string];
      return { grams: q * unit.cups * gramsPerCup, quantity: q, unit: unit.unit, portion: vol.label, method: 'volume-conversion' };
    }
    // No density data for this food: assume water-like density (1 cup = 236.6 g).
    return { grams: q * unit.cups * 236.588, quantity: q, unit: unit.unit, portion: null, method: 'density-estimate' };
  }
  if (unit?.kind === 'count') {
    const wanted = unit.unit;
    // A "slice" of pizza is listed as a "piece" and vice versa.
    const alike = ({ slice: ['slice', 'piece'], piece: ['piece', 'slice'] } as Record<string, string[]>)[wanted] || [wanted];
    for (const w of alike) {
      const matches = portions.filter((p) => p.unit === w || new RegExp(`\\b${w}`, 'i').test(p.label));
      // Several sizes listed ("small slice", "medium or regular slice", ...): take the typical one.
      const match = matches.find((p) => /\b(medium|regular)\b/i.test(p.label)) || matches[0];
      if (match) return { grams: q * perUnit(match), quantity: q, unit: wanted, portion: match.label, method: 'portion' };
    }
  }
  // A size the food has no portion for ("medium fries"): a typical serving of that size where one is known.
  const size = unit?.kind === 'count' && SIZES.includes(unit.unit) ? unit.unit as Size : null;
  const sized = size && SIZE_SERVINGS.find(([pattern]) => pattern.test(food.name));
  if (sized) return { grams: q * sized[1][size!], quantity: q, unit: size!, portion: `${size} serving`, method: 'size-serving' };
  // Bare count ("2 eggs", "a banana"): a portion named after the food, then medium/regular/piece/serving.
  // A size-down portion ("1 Bagel Thin", "1 small/individual") is only used when nothing typical is listed.
  const headWords = headSegments(food.name).join(' ').split(/\s+/).map(singular);
  const preference: ((p: Portion) => unknown)[] = [
    (p) => p.unit && headWords.includes(singular(p.unit)) && !SIZE_DOWN.test(p.label),
    (p) => ['fruit', 'whole', 'each', 'item', 'unit', 'nut'].includes(p.unit as string),
    // Drinks: a can of soda, a cup of coffee — not a café "medium" (16 fl oz).
    (p) => p.unit === 'can' && LIQUID.test(food.name),
    (p) => p.unit === 'cup' && LIQUID.test(food.name),
    (p) => p.unit === 'medium',
    (p) => TYPICAL_SIZE.test(p.label),
    (p) => ['piece', 'serving', 'sandwich'].includes(p.unit as string),
    (p) => p.unit === 'oz' && SNACK.test(food.category || ''),
    (p) => p.unit === 'cup',
    (p) => p.unit === 'slice',
    (p) => !SIZE_DOWN.test(p.label),
    () => true,
  ];
  // With no quantity at all ("some almonds"), skip tiny units like "1 nut".
  const sensible = (p: Portion) => quantity != null || perUnit(p) >= 15;
  for (const pick of preference) {
    const p = portions.find((x) => sensible(x) && pick(x)) || (pick === preference.at(-1) ? portions[0] : null);
    if (p) {
      return { grams: q * perUnit(p), quantity: q, unit: unit?.unit || p.unit || 'serving', portion: p.label, method: unit ? 'portion-fallback' : 'default-portion' };
    }
  }
  return { grams: q * 100, quantity: q, unit: 'serving', portion: null, method: 'default-100g' };
}
