// Free-text meal logging: "2 eggs, a slice of whole wheat toast and a cup of coffee with milk"
// -> matched foods with portions and nutrients. Rule-based; the AI provider can supply the
// item split instead (see providers/), and both paths resolve each phrase with resolvePhrase().
import { getFood } from './db.ts';
import { ambiguousAfter, ambiguousBare, namesFoodExactly, namesHead, notThisDish, searchFoods, wordCoverage } from './search.ts';
import { canonicalUnit, parseQuantity, resolvePortion, unsupportedAmount } from './units.ts';
import { countsPieces, implausiblePiece } from './portions.ts';
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
  /** The food named just before, when joined by "and", "&", "with", "plus" or a comma: the phrase's meal context. */
  after?: string;
}

/**
 * Input to resolvePhrase(): a parsed phrase, or an AI provider's item. There is deliberately no grams field: a weight
 * comes only from the stated quantity and unit through the portion rules ("150 g" is a mass), never from a model's
 * grams (audit P1-1).
 */
export interface Phrase {
  food: string;
  quantity?: number | null;
  unit?: string | null;
  text?: string;
  addOn?: boolean;
  /** The food named just before it in the meal ("egg" for the "chips" of "egg and chips"), when known. */
  after?: string;
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
  /** Only on items logged from an AI estimate: how the estimate was produced (additive; absent for catalog items). */
  basis?: EstimateBasis;
}

/**
 * Provenance of an item logged from an AI estimate. kind: "ai-estimate" (the AI's own values) or "catalog-match" (the
 * AI judged a catalog food the same dish and that food's values were used). status: "approved" (an operator reviewed
 * it: still an AI estimate, not verified data), "pending" (not reviewed) or "unstored" (made for a test key, not
 * kept). The version fields are null for estimates stored before they were recorded.
 */
export interface EstimateBasis {
  kind: 'ai-estimate' | 'catalog-match';
  status: 'approved' | 'pending' | 'unstored';
  provider: string;
  model: string | null;
  modelVersion: string | null;
  promptVersion: string | null;
  calcVersion: string | null;
  estimatedAt: string;
}

export interface Unmatched {
  text: string;
  reason: string;
  /** Foods sharing some of the phrase's words, when the best of them was too weak to log. */
  suggestions?: { id: number; name: string }[];
  /** The phrase respelled ("1 cup panner" -> "1 cup paneer") when only the respelling matches a food. */
  didYouMean?: string;
  /** Why a phrase that matched a food was still not logged. */
  note?: string;
  /**
   * Internal, not in the API response: the food is known but the amount can't be supported (an unsized measure, a
   * volume with no cited density, a piece count with no piece weight). Such a phrase is asked about and never covered by an estimate.
   */
  amountUnsupported?: true;
  /** Internal, not in the API response: a reviewed ambiguity ("fish and chips"). Asked about, never covered by an estimate. */
  askOnly?: true;
}

// A plate or bowl of something is a cooked dish. When the best match is a dry grain, flour or pulse (under 20 g water
// per 100 g), logging it would count a plate of uncooked staple, roughly two to three times the calories of the dish,
// so the phrase is offered back instead of logged. A stated weight ("60 g poha") still logs the dry food.
const DISH_PORTIONS = new Set(['plate', 'plates', 'bowl', 'bowls', 'katori', 'katoris', 'thali']);
const STAPLE_CATEGORY = /cereal grains|legume|cereals and millets|grain legumes/i;
// Survey foods such as "Oats, raw" carry no useful category: any flour, and a grain or pulse named raw or dry, count too.
const STAPLE_NAME = /\b(oats?|rice|wheat|barley|millet|quinoa|lentils?|beans?|chickpeas?|gram|dal|flour|semolina)\b/i;
const UNCOOKED = /\b(raw|dry|uncooked|unprepared)\b/i;
function dryStaple(food: Food): boolean {
  if ((food.per100g.water ?? 100) >= 20) return false;
  return STAPLE_CATEGORY.test(food.category ?? '') || /\bflours?\b/i.test(food.name) || (STAPLE_NAME.test(food.name) && UNCOOKED.test(food.name));
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
    // Katoris, with or without a size: "small katori", "2 large katoris of".
    const measure = r.match(/^((?:small|medium|large|big)\s+)?(katoris?)\b\s*/i);
    if (measure && r.split(/\s+/).length > (measure[1] ? 2 : 1)) {
      unit = measure[0].trim().toLowerCase();
      r = r.slice(measure[0].length);
    } else if (two) { unit = 'fl oz'; r = r.slice(two[0].length); }
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
    const joiner = i > 0 ? parts[i - 1].trim().toLowerCase() : '';
    const prev = items.at(-1);
    // "mac and cheese", "beans and rice": an amountless phrase after "and"/"with" that makes a dish named in the
    // catalog with the phrase before it is part of that dish, not a second food.
    // A reviewed ambiguous compound the catalog lacks ("fish and chips") is kept whole too, so it is asked about as one
    // dish instead of logged as two different foods.
    if (prev && quantity == null && !unit && /^(and|with|&)$/.test(joiner) && (namesDish(`${prev.food} ${joiner} ${r}`) || ambiguousBare(`${prev.food} ${joiner} ${r}`))) {
      prev.text = `${prev.text}${parts[i - 1]}${s}`; // as written: case, spacing and "&" kept
      prev.food = `${prev.food} ${joiner} ${r}`;
      continue;
    }
    const after = prev && /^(and|with|&|,|\+|plus)$/.test(joiner) ? prev.food : undefined;
    items.push({ text: s, food: r, quantity, unit, addOn, ...(after ? { after } : {}) });
  }
  return { meal: meal ? MEALS[meal] : null, items };
}

const CONNECTORS = new Set(['and', 'with', 'or', '&']);
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w && !CONNECTORS.has(w)).map((w) => w.replace(/(?<=..)(es|s)$/, ''));

/**
 * Whether the catalog's best match for a joined phrase ("mac and cheese") is a dish named by it: the food's leading
 * name joins its parts with "and"/"with" too, and, alternatives ("or noodles") aside, names exactly the phrase's
 * words in the same order (a short word may be its start: "mac" -> "Macaroni"). "Macaroni or noodles with cheese"
 * and "Beans and rice" qualify; "Salad dressing" (no joiner: it is the add-on), "Chicken curry with rice" (another
 * dish) and "Bread and butter pudding" (a pudding) don't. Memoized: the catalog doesn't change while running.
 */
function namesDish(phrase: string): boolean {
  const key = phrase.toLowerCase();
  let known = dishCache.get(key);
  if (known === undefined) {
    if (dishCache.size >= 1000) dishCache.clear();
    dishCache.set(key, (known = matchesDish(phrase)));
  }
  return known;
}
const dishCache = new Map<string, boolean>();

function matchesDish(phrase: string): boolean {
  const found = searchFoods(phrase, { limit: 1 });
  const top = found.results[0];
  if (!top || found.match !== 'all-words' || found.didYouMean) return false;
  const name = top.name.replace(/\([^)]*\)/g, ' ').split(',')[0].toLowerCase();
  if (!/\s(and|with|&)\s/.test(name)) return false;
  const words = wordsOf(phrase);
  const head = wordsOf(name.replace(/\s+or\s+[a-z0-9'-]+/g, ' '));
  const same = (h: string, w: string) => h === w || (w.length >= 3 && h.startsWith(w));
  return words.length > 1 && head.length === words.length && words.every((w, i) => same(head[i], w));
}

// Unquantified add-ons ("with sugar", "with milk") are a spoonful or a splash, never a cup: rich add-ons
// (sugars, fats, sauces) are capped at 15 g, anything else at 60 g. Within the cap the food's largest household
// portion of at least 3 g is used (1 tsp sugar, 1 fl oz milk); without one, the cap itself in grams.
const RICH_ADD_ON = /\b(sugar|syrup|honey|jam|jelly|marmalade|butter|ghee|margarine|oil|mayonnaise|cream|dressing|sauce|ketchup|catsup|chutney)\b/i;

function addOnPortion(food: Pick<Food, 'name' | 'portions'>): ResolvedPortion {
  const cap = RICH_ADD_ON.test(food.name) ? 15 : 60;
  const fits = food.portions
    .map((p) => ({ p, each: p.grams / p.amount }))
    .filter(({ each }) => each >= 3 && each <= cap)
    .sort((a, b) => b.each - a.each)[0];
  if (fits) return { grams: fits.each, quantity: 1, unit: fits.p.unit || 'serving', portion: fits.p.label, method: 'add-on-smallest-portion' };
  return { grams: cap, quantity: cap, unit: 'g', portion: null, method: 'add-on-cap' };
}

/** Turn one phrase into a logged item, or an unmatched entry. Phrase: { food, quantity?, unit?, text? }. */
export function resolvePhrase(ph: Phrase, { alternatives = 3 }: { alternatives?: number } = {}): { item: LoggedItem } | { unmatched: Unmatched } {
  const text = ph.text || ph.food;
  // A bare word with no single defensible food ("chicken") is asked about, never guessed (audit P0-4).
  const ask = ambiguousBare(ph.food) ?? ambiguousAfter(ph.food, ph.after);
  if (ask) return { unmatched: { text, reason: 'no confident match', suggestions: ask, note: `"${ph.food}" could be several foods; choose one`, askOnly: true } };
  const found = searchFoods(ph.food, { limit: alternatives + 1 });
  if (!found.results.length) return { unmatched: { text, reason: 'no matching food' } };
  // Only a respelling matched: suggest it rather than log a food the user may not have meant.
  if (found.didYouMean) {
    const suggestions = found.results.map((r) => ({ id: r.id, name: r.name }));
    return { unmatched: { text, reason: 'no matching food', suggestions, didYouMean: respellPhrase(text, ph.food, found.didYouMean) } };
  }
  // A fallback match (prefix or any one word) is logged only when the food shares more than half of the phrase's
  // words; otherwise "butter chicken" would be logged as butter. Weaker hits are offered as suggestions instead.
  // A fallback match must also name the food's main dish: "veg fried rice" shares "fried" and "rice" with "Rissoles,
  // brown rice, fried in vegetable oil", but rissoles are not what was eaten.
  if (found.match !== 'all-words' && (wordCoverage(ph.food, found.results[0].name) <= 0.5 || !namesHead(ph.food, found.results[0].name))) {
    // Foods whose main dish the phrase names come first ("veg fried rice": vegetable rice before rissoles).
    const suggestions = found.results.filter((r) => wordCoverage(ph.food, r.name) > 0)
      .sort((a, b) => Number(namesHead(ph.food, b.name)) - Number(namesHead(ph.food, a.name)))
      .map((r) => ({ id: r.id, name: r.name }));
    return { unmatched: { text, reason: 'no confident match', ...(suggestions.length ? { suggestions } : {}) } };
  }
  // An exact match must name the food, not only share its words with a description of another one ("vegetable fried
  // rice" is not "Rissoles, brown rice, fried in vegetable oil"). The next result is not tried instead: it may be just
  // as wrong (a chicken stir-fry). Foods that do name it are suggested first. (Equivalent forms are checked in search.)
  if (found.match === 'all-words' && !found.matchedAs && !namesFoodExactly(ph.food, found.results[0])) {
    const suggestions = found.results
      .sort((a, b) => Number(namesFoodExactly(ph.food, b)) - Number(namesFoodExactly(ph.food, a)))
      .map((r) => ({ id: r.id, name: r.name }));
    return { unmatched: { text, reason: 'no confident match', suggestions } };
  }
  // A reviewed "different dish" is never logged, whichever match path reached it ("veg spring roll" is not the meat roll).
  if (notThisDish(ph.food, found.results[0].name)) {
    const suggestions = found.results.filter((r) => !notThisDish(ph.food, r.name)).map((r) => ({ id: r.id, name: r.name }));
    return { unmatched: { text, reason: 'no confident match', ...(suggestions.length ? { suggestions } : {}) } };
  }
  let pick = found.results[0];
  let best = getFood(pick.id)!;
  if (DISH_PORTIONS.has(String(ph.unit ?? '').toLowerCase().split(/\s+/).at(-1)!) && dryStaple(best)) {
    // Every whole-word result names the phrase in full, so the first that is not a dry staple is the cooked dish
    // ("1 bowl masoor dal" -> the dal curry, not dry lentils). Without one, the phrase is offered back.
    const cooked = found.match === 'all-words' ? found.results.find((r) => !dryStaple(getFood(r.id)!)) : undefined;
    if (!cooked) {
      const suggestions = found.results.map((r) => ({ id: r.id, name: r.name }));
      const note = `"${best.name}" is the dry, uncooked food and no cooked dish for it is in the catalog; give a weight to log the dry amount`;
      return { unmatched: { text, reason: 'no confident match', suggestions, note } };
    }
    pick = cooked;
    best = getFood(pick.id)!;
  }
  let portion: ResolvedPortion;
  if (ph.addOn && ph.quantity == null && !ph.unit) {
    portion = addOnPortion(best);
  } else {
    portion = resolvePortion(best, ph.quantity, ph.unit);
  }
  // A measure with no supported size ("1 small katori dal") or a volume of a food with no cited density ("1 katori
  // kheer"): nothing is weighed or logged; the food is offered and the amount asked for, the phrase kept as given.
  if (unsupportedAmount(portion.method)) {
    return { unmatched: { text, reason: 'no confident match', suggestions: [{ id: best.id, name: best.name }], note: portion.portion!, amountUnsupported: true } };
  }
  // A count of a piece food whose only catalog weight can't be one piece (a recipe-yield serving: "1 rasgulla" =
  // 342 g) is not logged at that weight: the amount is flagged and the food offered, never a made-up weight (P0-5).
  if (!['mass', 'volume-conversion'].includes(portion.method) && countsPieces(ph.unit, best.name)) {
    const why = implausiblePiece(best.name, portion.quantity, portion.grams);
    if (why) return { unmatched: { text, reason: 'no confident match', suggestions: [{ id: best.id, name: best.name }], note: why, amountUnsupported: true } };
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
      confidence: found.relaxed ? 'low' : pick.score > 15 ? 'high' : 'medium',
      nutrients: scaleNutrients(best.per100g, grams),
      alternatives: found.results.filter((r) => r !== pick).map((r) => ({ id: r.id, name: r.name })),
    },
  };
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

// The bounds the nutrients endpoint already enforces, by kind of unit, so 1000 pieces and 1000 ml aren't held to the
// same number: a mass up to 10 kg, a volume up to 10 litres, a count of anything else up to 1000.
const MAX_GRAMS = 10_000;
const MAX_ML = 10_000;
const MAX_COUNT = 1000;
function usableQuantity(q: unknown, unit: string | null | undefined): q is number {
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0) return false;
  const c = canonicalUnit(unit);
  if (c?.kind === 'mass') return q * c.grams <= MAX_GRAMS;
  if (c?.kind === 'volume') return q * c.cups * 236.588 <= MAX_ML;
  return q <= MAX_COUNT;
}

// A weight the person stated in their own words ("150 g rice", "0.5 kg rice", "100 grams kheer"), read from the
// original text or voice transcript by the rules, independently of the AI. Grams and kilograms only: "oz" of a drink
// means fluid ounces. Only a clear statement counts: digits or an exact number word, one food, no range.
const MASS_UNITS = new Set(['g', 'gr', 'gram', 'grams', 'kg', 'kgs', 'kilogram', 'kilograms']);
const MASS_WORD = /\d\s*(?:g|gr|grams?|kgs?|kilograms?)\b|\b(?:grams?|kgs?|kilograms?)\b/i;
const EXACT_NUMBER = /^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|quarter)\b/i;
const RANGE = /\d\s*(?:-|–|to)\s*\d/i;
const JOINED = /\d|\b(?:and|aur|with|or|plus|n)\b|&/i;
const NOT_FOOD_WORDS = new Set(['cooked', 'plain', 'white', 'fresh', 'homemade', 'the', 'and', 'with', 'some']);
const foodWords = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !NOT_FOOD_WORDS.has(w)).map((w) => w.replace(/(?<=[^s])s$/, '')));

interface StatedMass { text: string; grams: number; food: { id: number; name: string } | null; words: Set<string> }

function statedMasses(text: string): { stated: StatedMass[]; unclear: string[] } {
  const stated: StatedMass[] = [];
  const unclear: string[] = [];
  for (const p of splitMealText(text).items) {
    const unit = String(p.unit ?? '').toLowerCase();
    if (MASS_UNITS.has(unit)) {
      const grams = (p.quantity ?? 0) * (canonicalUnit(unit) as { grams: number }).grams;
      const clear = grams > 0 && grams <= MAX_GRAMS && !RANGE.test(p.text) && (/\d/.test(p.text) || EXACT_NUMBER.test(p.text.trim()))
        && !JOINED.test(p.food) && foodWords(p.food).size > 0;
      if (!clear) { unclear.push(p.text); continue; }
      const r = resolvePhrase({ food: p.food });
      stated.push({ text: p.text, grams, food: 'item' in r ? { id: r.item.food.id, name: r.item.food.name } : null, words: foodWords(p.food) });
    } else if (!p.unit && MASS_WORD.test(p.text)) {
      unclear.push(p.text); // a weight was written but couldn't be read ("100-150 g rice", "a few grams of salt")
    }
  }
  return { stated, unclear };
}

type AiItem = { food: string; quantity: number; unit: string; confidence?: Confidence };

/**
 * Resolve every item of one AI reading (audit P1-1). From text or voice, a weight the person stated (read from their
 * own words by the rules) beats the AI's reading of that item's amount: it is attached to the one AI item for the
 * same food (same catalog food, or a shared food word) and logged at exactly that weight, density or not. A stated
 * weight that matches no item, or several, is never guessed: the item(s) are asked about, and a weight that can't be
 * attached, or read, is listed back too, so it is never lost. Household measures (katori, bowl, glass, plate) are not
 * masses and keep their own rules. A photo has no words of the person's, so its items use the rules alone.
 */
export function resolveAiMeal(items: AiItem[], origin: { kind: 'photo' } | { kind: 'text'; text: string }): { results: ({ item: LoggedItem } | { unmatched: Unmatched })[]; extra: Unmatched[] } {
  if (origin.kind === 'photo') return { results: items.map((i) => resolveAiItem(i, 'photo')), extra: [] };
  const { stated, unclear } = statedMasses(origin.text);
  const aiFood = items.map((i) => {
    const r = resolvePhrase({ food: i.food });
    return { id: 'item' in r ? r.item.food.id : null, words: foodWords(i.food) };
  });
  // The same catalog food first; a shared food word only when no item is the same food ("chawal" read as "rice").
  const sameFood = (m: StatedMass) => items.map((_, k) => k).filter((k) => m.food != null && aiFood[k].id === m.food.id);
  const sharesWord = (m: StatedMass) => items.map((_, k) => k).filter((k) => [...m.words].some((w) => aiFood[k].words.has(w)));
  const attached = new Map<number, StatedMass>();
  const doubtful = new Set<number>();
  const extra: Unmatched[] = [];
  const listBack = (text: string, food: StatedMass['food'], note: string) =>
    extra.push({ text, reason: 'no confident match', ...(food ? { suggestions: [food] } : {}), note, amountUnsupported: true });
  for (const m of stated) {
    let ks = sameFood(m).length ? sameFood(m) : sharesWord(m);
    // Two items for the same food ("1 katori dal, 100 g dal"): the one the AI already read at this weight is it.
    const sameWeight = ks.filter((k) => { const c = canonicalUnit(items[k].unit); return c?.kind === 'mass' && Math.abs(items[k].quantity * c.grams - m.grams) < 0.5; });
    if (ks.length > 1 && sameWeight.length === 1) ks = sameWeight;
    if (ks.length === 1 && !attached.has(ks[0])) attached.set(ks[0], m);
    else if (ks.length > 1) ks.forEach((k) => doubtful.add(k));
    else listBack(m.text, m.food, `the stated ${m.grams} g couldn't be matched to one food the AI read; nothing was logged for it`);
  }
  for (const text of unclear) listBack(text, null, 'the weight couldn\'t be read; give one amount in grams or a household unit');
  // A weight the person stated but that couldn't be attached may belong to an item the AI gave no amount for.
  const unplaced = extra.length > 0;
  const results = items.map((i, k) => {
    const m = attached.get(k);
    if (m) {
      const r = resolveAiItem({ ...i, quantity: m.grams, unit: 'g' }, 'text');
      return 'item' in r ? { item: { ...r.item, portionBasis: `${m.grams} g, as stated ("${m.text}")` } } : r;
    }
    const noAmount = ['serving', 'servings', ''].includes(String(i.unit ?? '').trim().toLowerCase());
    if (doubtful.has(k) || (unplaced && noAmount)) {
      const r = resolveAiItem(i, 'text');
      const note = doubtful.has(k) ? 'a stated weight could belong to more than one food; give each amount' : 'a weight in the text couldn\'t be matched to a food; give this amount';
      return { unmatched: 'item' in r
        ? { text: `${i.quantity} ${i.unit} ${i.food}`, reason: 'no confident match', suggestions: [{ id: r.item.food.id, name: r.item.food.name }], note, amountUnsupported: true as const }
        : { ...r.unmatched, note: r.unmatched.note ?? note, amountUnsupported: true as const } };
    }
    return resolveAiItem(i, 'text');
  });
  // A weight listed back whose words are already an asked item ("20 kg rice") is not listed twice.
  const asked = new Set(results.flatMap((r) => ('unmatched' in r ? [r.unmatched.text.toLowerCase()] : [])));
  return { results, extra: extra.filter((e) => !asked.has(e.text.toLowerCase())) };
}
type Confidence = keyof typeof CONFIDENCE_RANK;

/**
 * Resolve one item an AI parsed from text or recognized in a photo (audit P1-1). The AI names the food and reads the
 * quantity and unit; the portion rules alone decide whether that amount can be logged and what it weighs. The AI's
 * grams never reach here. A quantity that isn't a positive, finite number up to 1000 is asked about. From a photo the
 * amount is the AI's own reading, so it is also asked about when the AI's confidence is low or it gives no household
 * unit ("serving"), and a logged item keeps its photo origin in `portionBasis` and the lower of the two confidences.
 */
export function resolveAiItem(ai: { food: string; quantity: number; unit: string; confidence?: Confidence }, origin: 'text' | 'photo'): { item: LoggedItem } | { unmatched: Unmatched } {
  const text = `${ai.quantity} ${ai.unit} ${ai.food}`;
  const ask = (note: string, r: { item: LoggedItem } | { unmatched: Unmatched }) => ({
    unmatched: 'item' in r
      ? { text, reason: 'no confident match', suggestions: [{ id: r.item.food.id, name: r.item.food.name }], note, amountUnsupported: true as const }
      : { ...r.unmatched, note: r.unmatched.note ?? note, amountUnsupported: true as const },
  });
  const quantityOk = usableQuantity(ai.quantity, ai.unit);
  const r = resolvePhrase({ food: ai.food, quantity: quantityOk ? ai.quantity : null, unit: ai.unit, text });
  if (!quantityOk) return ask(`the amount (${ai.quantity} ${ai.unit}) can't be used; give it in grams or a household unit`, r);
  if (origin === 'photo') {
    const unit = String(ai.unit ?? '').trim().toLowerCase();
    if (ai.confidence === 'low' || !unit || unit === 'serving' || unit === 'servings') {
      return ask('the photo doesn\'t show the amount clearly; give it in grams or a household unit', r);
    }
    if ('item' in r) {
      const aiConf: Confidence = ai.confidence ?? 'medium';
      const confidence = CONFIDENCE_RANK[aiConf] < CONFIDENCE_RANK[r.item.confidence] ? aiConf : r.item.confidence;
      const read = `amount read from the photo by AI (${aiConf} confidence)`;
      return { item: { ...r.item, confidence, portionBasis: r.item.portionBasis ? `${read}; ${r.item.portionBasis}` : read } };
    }
  }
  return r;
}

/** Turn parsed phrases into logged items, unmatched phrases and meal totals. */
function resolveItems(phrases: Phrase[], opts: { alternatives?: number } = {}): ResolvedItems {
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
