// Food search: SQLite FTS5 recall, then a reranker tuned for food logging (prefer the generic,
// as-eaten form whose leading name segment matches the query, e.g. "egg" -> "Egg, whole, ...").
import { foods } from './db.ts';
import { lookup } from './lookup.ts';
import { headSegments } from './names.ts';
import { catalogSpelling, closestWord, vocabulary } from './spelling.ts';

interface SearchRow {
  id: number;
  name: string;
  source: string;
  category: string | null;
  aliases: string | null; // "|"-separated other names (data/aliases/)
  rank: number;
}

export interface SearchHit {
  id: number;
  name: string;
  source: string;
  category: string | null;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  source?: string;
}

/** How the results matched: every word as a whole word, every word as a prefix ("chick"), or any one word. */
export type SearchMatch = 'all-words' | 'prefix' | 'any-word';

export interface SearchResult {
  query: string;
  relaxed?: boolean; // absent when the query normalizes to nothing; true when match is 'any-word'
  match?: SearchMatch; // absent when nothing matched
  /** Set when the query as typed found no good match: the respelled query these results are for. */
  didYouMean?: string;
  /** Set when the query matched through an equivalent form ("murgh korma" as "chicken korma"): that form. */
  matchedAs?: string;
  total: number;
  results: SearchHit[];
}

// Everyday words -> the wording USDA uses.
const SYNONYMS: Record<string, string> = lookup({
  soda: 'soft drink', pop: 'soft drink', fries: 'french fries', ketchup: 'catsup',
  yoghurt: 'yogurt', burger: 'hamburger', pb: 'peanut butter',
  oj: 'orange juice', espresso: 'coffee espresso', latte: 'coffee latte',
  aubergine: 'eggplant', courgette: 'zucchini', prawns: 'shrimp', prawn: 'shrimp', mince: 'ground beef',
  donut: 'doughnut', donuts: 'doughnut',
  // Indian English: curd and dahi are plain, unsweetened yogurt, whole milk unless a fat level is given (PHRASES keeps
  // "low fat curd" low fat; "bean curd" is tofu).
  curd: 'whole milk plain yogurt', dahi: 'whole milk plain yogurt',
});
// Multi-word phrases rewritten before the word synonyms run.
const PHRASES: [RegExp, string][] = [
  [/\bbean curd\b/g, 'tofu'],
  // Sugar-sweetened yogurt, not USDA's "sweetened with low-calorie sweetener" (sugar-free) or frozen yogurt.
  [/\bsweet(?:ened)? (?:curd|dahi)\b/g, 'whole milk yogurt flavors other than fruit'],
  [/\bsweet(?:ened)? yogh?urt\b/g, 'yogurt ns as to type of milk flavors other than fruit'],
  [/\bpoha (?:fruit|berry|berries)\b/g, 'groundcherries'], // the Hawaiian fruit, not flattened rice
  [/\b(?:low[- ]?fat|toned) (?:curd|dahi)\b/g, 'low fat milk plain yogurt'],
  [/\b(?:skim(?:med)?|non[- ]?fat|fat[- ]free|double[- ]toned) (?:curd|dahi)\b/g, 'nonfat milk plain yogurt'],
  [/\b(?:full[- ]fat|whole[- ]milk) (?:curd|dahi)\b/g, 'whole milk plain yogurt'],
  [/\bdal (tadka|fry)\b|\btadka dal\b/g, 'dal'], // USDA "Dal" is tempered lentil dal
  [/\bmasala chai\b/g, 'chai'],
  [/\bmasala dosa\b|\bdosa masala\b/g, 'dosa with filling'], // FNDDS stuffed dosa, not plain crepe
  [/\b(?:\d+\s+)?(?:cup|cups|plate|bowl|glass)\s+butter chicken\b/g, 'butter chicken'],
  [/\b(?:\d+\s+)?(?:cup|cups|plate|bowl)\s+poha\b|\bpoha\b/g, 'poha'],
  [/\b(?:\d+\s+)?(?:cup|cups|plate|bowl)\s+khichdi\b|\bkhichdi\b|\bkhichri\b/g, 'khichdi'],
  [/\bpav bhaji\b/g, 'pav bhaji'],
  // Cooked eggs keep their cooking ("2 scrambled eggs"); only bare eggs are whole raw eggs, as weighed.
  [/\b(?:\d+\s+)?(fried|scrambled|poached|deviled|cooked|baked)\s+eggs\b/g, '$1 egg'],
  [/\b(?:\d+\s+)?(?:(?:hard|soft)[- ])?boiled eggs?\b/g, 'egg whole boiled'],
  [/\b(?:\d+\s+)?eggs\b/g, 'egg whole raw'],
];

// A bare everyday word (the whole query, nothing else) means one particular food: "tea" is a cup of hot black
// tea, not iced tea; "salad" is a green salad, not beef salad. "iced tea" or "chicken salad" are untouched.
// The default food is pinned first; the other matches still follow, so searching "tea" lists every tea.
const BARE_DEFAULTS: Record<string, string> = lookup({
  tea: 'Tea, hot, leaf, black',
  coffee: 'Coffee, brewed',
  'hot chocolate': 'Hot chocolate / cocoa, NFS',
  // Chai as drunk in India: brewed with milk and sugar (this FNDDS entry is sweetened, about 51 kcal per 100 g).
  chai: 'Tea, hot, with milk',
  salad: 'Lettuce, salad with assorted vegetables including tomatoes and/or carrots, no dressing',
  korma: 'Curry, chicken korma, homemade',
  vindaloo: 'Curry, chicken vindaloo, homemade',
  pulao: 'Pilau, vegetable, homemade',
  pulav: 'Pilau, vegetable, homemade',
  lassi: 'Lassi, sweet',
  chaas: 'Lassi (salted)',
  kheer: 'Kheer (rice pudding)',
  halwa: 'Semolina halwa (Suji ka halwa)',
  sabzi: 'Mixed vegetable sabzi (semi-dry Indian mixed vegetables)',
  sabji: 'Mixed vegetable sabzi (semi-dry Indian mixed vegetables)',
  omelette: 'Omelette, plain, homemade',
  omelet: 'Omelette, plain, homemade',
  cookie: 'Cookie, NFS',
  cookies: 'Cookie, NFS',
  // Indo-Chinese chowmein as ordered in India is the vegetable kind unless chicken or egg is said.
  chowmein: 'Vegetable chowmein',
  'chow mein': 'Vegetable chowmein',
  dhokla: 'Instant dhokla',
  naan: 'Bread, naan',
  samosa: 'Samosa',
  samosas: 'Samosa',
  egg: 'Egg, whole, raw',
  eggs: 'Egg, whole, raw',
  biryani: 'Biryani with chicken',
  'urad dal': 'Urad dahl, homemade',
  poha: 'Poha (flattened rice with onion and peanuts)',
  khichdi: 'Khichadi, with butter ghee',
  khichri: 'Khichadi, with butter ghee',
  'moong dal': 'Curry, mung bean dahl and tomato, homemade',
  // Roti and chapati as eaten in Indian homes: INDB "Chapati/Roti" (Indian Nutrient Databank published total, food
  // id 878591004: 202 kcal per 100 g, 1 chapati = 36 g). CoFID 2021 11-459 "Chapatis, made without fat" agrees at
  // 202 kcal per 100 g (benchmark set A, data/eval/sets/A.json). USDA's "Bread, chapati or roti, plain, commercially
  // prepared" (297 kcal, 68 g a piece) is a packaged product: about 2.8x the energy of 2 home rotis. It stays
  // searchable by name ("chapati commercially prepared"). Owner-approved 2026-11-19 (audit P0-3).
  roti: 'Chapati/Roti', rotis: 'Chapati/Roti', chapati: 'Chapati/Roti', chapatis: 'Chapati/Roti',
  chapathi: 'Chapati/Roti', phulka: 'Chapati/Roti', phulkas: 'Chapati/Roti',
  // "Plain rice" is how Indian English names steamed white rice.
  'plain rice': 'Rice, cooked, NFS',
  // Chips alone are potato chips; "corn chips" or "tortilla chips" are not (no synonym rewrites them any more).
  chips: 'Potato chips, NFS',
  // Toast alone is toasted bread; "french toast" is not (no synonym rewrites it any more).
  toast: 'Bread, white, toasted',
  // Palak alone is the spinach itself, not palak paneer.
  palak: 'Spinach, cooked, boiled, drained, without salt',
  // Other spellings of dal alone mean plain dal too, not dal baati.
  daal: 'Dal',
  dhal: 'Dal',
});

// Bare words with no single defensible food (audit P0-4): "chicken" could be breast, leg or thigh, roasted, curried or
// raw mince, at very different weights and fat. Logging asks instead, offering these reviewed catalog foods; a more
// specific phrase ("chicken breast", "chicken curry", "grilled chicken") is matched as usual.
const AMBIGUOUS_BARE: Record<string, string[]> = lookup({
  chicken: [
    'Chicken breast, baked, broiled, or roasted, skin not eaten, from raw',
    'Chicken thigh, baked, broiled, or roasted, skin not eaten, from raw',
    'Chicken drumstick, baked, broiled, or roasted, skin not eaten, from raw',
    'Chicken curry',
    'Tandoori chicken',
  ],
});

/** For a bare word with no single defensible food, the reviewed foods to suggest instead; else null. */
export function ambiguousBare(food: string): { id: number; name: string }[] | null {
  const tokens = normalizeQuery(food).split(' ').filter(Boolean);
  const names = AMBIGUOUS_BARE[tokens.join(' ')] ?? AMBIGUOUS_BARE[tokens.map(singular).join(' ')];
  if (!names) return null;
  const byName = foods().prepare('SELECT id, name FROM foods WHERE name = ?');
  return names.map((n) => byName.get(n) as { id: number; name: string } | undefined).filter((r): r is { id: number; name: string } => !!r);
}

// Hindi and Indian-English words for the catalog's English ones (M7.3). Each is the same food, so a phrase using
// them may match on the English word; they are only tried when the phrase as typed matches no food on all its words.
const HINDI_WORDS: Record<string, string> = lookup({
  murgh: 'chicken', murg: 'chicken', gosht: 'mutton', anda: 'egg', ande: 'egg',
  kakdi: 'cucumber', kakri: 'cucumber', kheera: 'cucumber', khira: 'cucumber',
  aloo: 'potato', alu: 'potato', gobi: 'cauliflower', gobhi: 'cauliflower', matar: 'pea', mattar: 'pea', mutter: 'pea', muttar: 'pea',
  palak: 'spinach', methi: 'fenugreek', baingan: 'brinjal', bengan: 'brinjal', baigan: 'brinjal', bhindi: 'okra', chawal: 'rice',
  dahl: 'dal', nan: 'naan', phulka: 'chapati', veg: 'vegetable', mix: 'mixed',
});
// Words that join a Hindi dish name without naming any food: "matar aloo ki sabzi" is the dish "matar aloo". The
// genitive ki/ka/ke may go anywhere; "sabzi" only right after one ("… ki sabzi", a dish of …). A sabzi on its own is
// a food: "roti sabzi" is roti and a sabzi, never roti alone. Only dropped in the last equivalent forms, and only when
// every remaining word still names the food.
const GENITIVES = new Set(['ki', 'ka', 'ke']);
const SABZI = new Set(['sabzi', 'sabji', 'subzi', 'subji']);
// Whole-phrase equivalences.
const EQUIVALENT_PHRASES: [RegExp, string][] = [
  [/\byellow (moong|mung)\b/g, 'washed $1'], // yellow moong dal is dhuli (washed, split) moong dal
];

/**
 * True when every word of `form` is in what identifies the food: its first two name segments ("Curry, chicken
 * korma"; "Bread, chapati or roti"), a bracketed other name ("(Matar paneer)") or a reviewed alias. A word found only
 * further on, in a description ("fried in vegetable oil"), doesn't count.
 */
function identifiedBy(form: string, hit: { id: number; name: string }): boolean {
  const row = foods().prepare('SELECT aliases FROM foods WHERE id = ?').get(hit.id) as { aliases: string | null } | undefined;
  const aliases = row?.aliases?.split('|').filter(Boolean) ?? [];
  const brackets = [...hit.name.matchAll(/\(([^()]*)\)/g)].flatMap((m) => m[1].split('/'));
  const segments = hit.name.replace(/\([^()]*\)/g, ' ').split(',').map((x) => x.trim().toLowerCase());
  const identity = `${segments.slice(0, 2).join(' ')} ${brackets.join(' ')} ${aliases.join(' ')}`;
  if (wordCoverage(form, identity) < 1) return false;
  // And one of the food's names must be the form's whole subject, so one word can't stand for a longer dish
  // ("paaner" is not "Paaner do pyaza"). A category-led name is named by its dish segment ("Curry, chicken korma").
  const names = [segments[0], ...(GENERIC_HEADS.has(segments[0]) && segments[1] ? segments[1].split(/\s+or\s+/) : []), ...brackets, ...aliases];
  const typed = form.toLowerCase().split(/\s+/).filter(Boolean).flatMap((w) => [w, ...normalizeQuery(w).split(' ')]).map(singular);
  return names.some((n) => {
    const words = n.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w && !LINK_WORDS.has(w) && !DISH_WORDS.has(w)).map(singular);
    return words.length > 0 && words.every((w) => typed.includes(w));
  });
}
// Leading name segments that are a category, not the dish: the dish is the next segment ("Curry, chicken korma").
const GENERIC_HEADS = new Set(['curry', 'bread', 'cheese', 'soup', 'stew', 'bhaji', 'biryani', 'pilau', 'pakora/bhajia']);
// Words a dish name may carry that say what kind of dish it is, not what it is made of.
const DISH_WORDS = new Set(['curry', 'homemade', 'sabzi', 'sabji', 'subji', 'dish']);

// Words USDA puts late in a name ("Tea, hot, leaf, green"; "Rice, white, long grain, raw") that describe how the
// food is prepared or sold, not which food it is: an exact match may find them anywhere in the name.
const DESCRIPTORS = new Set(['raw', 'cooked', 'plain', 'boiled', 'poached', 'steamed', 'baked', 'roasted', 'grilled',
  'toasted', 'toast', 'green', 'black', 'hot', 'whole', 'unsalted', 'salted', 'sweetened', 'unsweetened', 'regular', 'nfs',
  'commercially', 'prepared', 'homemade']);

/**
 * True when a food found by an exact (all-words) match is the food the phrase names: every word the search used is in
 * what identifies the food (its first two name segments, a bracketed name or an alias), or is a descriptor USDA puts
 * later ("green" tea). Exempt: a reviewed alias or a bare-word default for exactly this phrase, which name the food
 * outright. "vegetable fried rice" is not "Rissoles, brown rice, fried in vegetable oil": "vegetable" and "fried" are
 * only in its description. Not the M7.1 head rule, which would refuse correct names like "Curry, chicken korma".
 */
export function namesFoodExactly(query: string, hit: { id: number; name: string }): boolean {
  const typed = String(query ?? '');
  if (aliasedFood(typed) === hit.id) return true;
  const normalized = normalizeQuery(typed).split(' ').filter(Boolean);
  const preferred = BARE_DEFAULTS[normalized.join(' ')] ?? BARE_DEFAULTS[normalized.map(singular).join(' ')];
  if (preferred === hit.name) return true;
  const row = foods().prepare('SELECT aliases FROM foods WHERE id = ?').get(hit.id) as { aliases: string | null } | undefined;
  const brackets = [...hit.name.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]).join(' ');
  const segments = hit.name.replace(/\([^()]*\)/g, ' ').split(',').map((s) => s.trim().toLowerCase());
  const wordsOf = (s: string) => s.split(/[^a-z0-9']+/).filter(Boolean);
  // Spellings of one word: as written, singular, without a plural s, and a light stem ("sprouts"/"sprouted",
  // "fries"/"fried").
  const forms = (w: string) => [w, singular(w), w.replace(/s$/, ''), w.replace(/(ies|ied|es|ed|ing|s)$/, '')];
  const said = (ws: string[]) => new Set(ws.flatMap((t) => t.split('-')).filter(Boolean).flatMap(forms));
  const typedWords = String(typed).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((w) => w && !LINK_WORDS.has(w));
  const asked = said([...typedWords, ...normalized]);
  // Named by its other name: every typed word is in a bracketed name or an alias ("rasam masala" for "Rasam powder
  // (Rasam masala)", "besan burfi" for "Gram flour burfi (Besan burfi)").
  const other = new Set(wordsOf(`${brackets} ${row?.aliases?.replaceAll('|', ' ') ?? ''}`.toLowerCase()).flatMap(forms));
  if (typedWords.length && typedWords.every((w) => forms(w).some((f) => other.has(f)))) return true;
  // A product form the phrase didn't ask for, as the main name's last word, is another product: "apple pie" is not
  // "Apple pie filling" (while "Gram flour burfi" is a burfi, and "…, Pan Crust" is a pizza's crust).
  const headLast = wordsOf(segments[0]).at(-1) ?? '';
  if (PRODUCT_FORMS.has(headLast) && !forms(headLast).some((f) => asked.has(f))) return false;
  // A USDA group prefix ("Snacks, rice cracker brown rice") names a product in its next segment; the phrase must name
  // all of it: "plain rice" is not a rice cracker.
  if (GROUP_PREFIXES.has(segments[0]) && segments[1] && !wordsOf(segments[1]).every((w) => DESCRIPTORS.has(w) || forms(w).some((f) => asked.has(f)))) return false;
  const identity = `${segments.slice(0, 2).join(' ')} ${brackets} ${row?.aliases?.replaceAll('|', ' ') ?? ''}`;
  const known = new Set(wordsOf(identity.toLowerCase()).flatMap(forms));
  const covered = (ws: string[]) => ws.flatMap((t) => t.split('-')).filter((w) => w && !LINK_WORDS.has(w)).every((w) => DESCRIPTORS.has(w) || forms(w).some((f) => known.has(f)));
  if (covered(typedWords) || covered(normalized)) return true;
  // A reviewed phrase rewrite ("sweet curd" -> USDA's "yogurt … flavors other than fruit") names the food in USDA's
  // own wording, which may run past the second segment: its words may be anywhere in the name.
  if (PHRASES.some(([p]) => new RegExp(p.source).test(typed.toLowerCase()))) {
    const all = new Set(wordsOf(hit.name.toLowerCase()).flatMap(forms));
    return normalized.flatMap((t) => t.split('-')).filter(Boolean).every((w) => DESCRIPTORS.has(w) || forms(w).some((f) => all.has(f)));
  }
  return false;
}
// Forms of a food that are another product ("Apple pie filling", "Pancake mix"); an exact match must ask for them.
const PRODUCT_FORMS = new Set(['filling', 'mix', 'powder', 'crumbs', 'flour', 'concentrate', 'syrup', 'extract', 'batter', 'dough', 'crust', 'stuffing', 'dressing', 'seasoning']);
// USDA name prefixes that group products; the product is the next segment ("Snacks, rice cracker brown rice").
const GROUP_PREFIXES = new Set(['snacks', 'babyfood']);

/**
 * Other ways of writing a phrase that name the same food, most faithful first: romanised spellings in the catalog's
 * spelling, then without connector words, then with English names for Hindi words, then both. Empty when there is
 * nothing to rewrite.
 */
export function equivalentQueries(query: string): string[] {
  let base = String(query || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of EQUIVALENT_PHRASES) base = base.replace(pattern, replacement);
  const words = base.split(' ').filter(Boolean);
  const spelled = words.map((w) => catalogSpelling(w) ?? w);
  const english = spelled.map((w) => HINDI_WORDS[w] ?? HINDI_WORDS[words[spelled.indexOf(w)]] ?? w);
  const without = (ws: string[]) => ws.filter((w, i) => !GENITIVES.has(w) && !(SABZI.has(w) && GENITIVES.has(ws[i - 1])));
  const forms = [spelled, without(spelled), english, without(english)].map((ws) => ws.join(' ')).filter((f) => f);
  return [...new Set(forms)].filter((f) => f !== String(query || '').toLowerCase().trim());
}

const GENERIC = /\b(raw|nfs|plain|cooked|regular|fresh|boiled|baked|brewed|without salt|ns as to)\b/i;
// The variety people mean by the bare staple name.
const STAPLE_DEFAULTS: Record<string, string> = lookup({ bread: 'white', rice: 'white', milk: 'whole', sugar: 'granulated' });
// Processed forms of a staple ("Bread, crumbs") are rarely what a plain query means.
const FORMS = /\b(crumbs|sticks|croutons|stuffing|dressing|mix|batter|dough|flour|concentrate|syrup|extract)\b/i;
// Specialty variants are fine matches, just not the default reading of a plain query.
const SPECIALTY = /\b(glutinous|sticky|meatless|imitation|vegetarian|vegan|plant-based|whole wheat|gluten-free|stuffed|reduced fat|low fat|lowfat|fat free|nonfat|light|diet|sugar free|from frozen|with fruit|low sodium|reduced sodium|coated|breaded|battered|made with butter|made with margarine|made with oil|fat added)\b/i;
const NICHE =/\b(baby food|infant formula|toddler|puree for|dehydrated|freeze-dried|powder|canned, drained solids|alaska native|frozen dinner)\b/i;

function normalizeQuery(q: unknown): string {
  let s = String(q || '').toLowerCase();
  for (const [pattern, replacement] of PHRASES) s = s.replace(pattern, replacement);
  return s
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SYNONYMS[t] || t)
    .join(' ')
    .trim();
}

// berries -> berry, tomatoes -> tomato, sandwiches -> sandwich, pancakes -> pancake, glass stays.
const singular = (t: string) => {
  if (t.length > 3 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && /(ch|sh|x|o|ss)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 2 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};

// The same food from two sources ("Yogurt, Greek, whole milk, plain" and "Yogurt, Greek, plain, whole milk"):
// same words in any order, ignoring punctuation and all-caps brand names.
const sameFoodKey = (name: string) =>
  name.split(/[^A-Za-z0-9']+/).filter((w) => w && !(w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)))
    .map((w) => singular(w.toLowerCase())).sort().join(' ');

// A name's other names in parentheses ("Groundcherries, (cape-gooseberries or poha), raw") are not what the food is
// called: a food matched only through one word of them ("poha") is dropped, while "skim milk" still finds "Milk, …
// (fat free or skim)" because "milk" is in the name itself, and a whole other name ("cape gooseberries") still counts.
function onlyInParentheses(row: SearchRow, tokens: string[], prefix: boolean): boolean {
  if (!row.name.includes('(')) return false;
  const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(singular);
  const has = (words: string[], t: string) => words.some((w) => w === singular(t) || (prefix && w.startsWith(singular(t))));
  const outside = wordsOf(`${row.name.replace(/\([^)]*\)/g, ' ')} ${row.aliases?.replaceAll('|', ' ') ?? ''}`);
  if (tokens.some((t) => has(outside, t))) return false;
  const inside = wordsOf((row.name.match(/\([^)]*\)/g) ?? []).join(' '));
  return !(tokens.length > 1 && tokens.every((t) => has(inside, t)));
}

function ftsQuery(tokens: string[], op: 'AND' | 'OR', prefix: boolean) {
  return tokens.map((t) => `"${t.replace(/"/g, '')}"${prefix ? '*' : ''}`).join(` ${op} `);
}

/**
 * Share of the query's words that appear as whole words in a food name (singularised). A word counts in the form
 * typed or in its synonym's ("burger" is in "Veggie burger" and in "Hamburger").
 */
export function wordCoverage(query: string, name: string): number {
  const typed = String(query || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  if (!typed.length) return 0;
  const nameWords = new Set(name.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean).map(singular));
  const covered = typed.filter((w) => [w, ...normalizeQuery(w).split(' ')].some((f) => nameWords.has(singular(f))));
  return covered.length / typed.length;
}

const LINK_WORDS = new Set(['and', 'with', 'or', 'in', 'of', 'the', 'a', 'an', 'on', 'style']);

/**
 * True when the phrase names the food's main dish: every word of its head (the name before the first comma, or the
 * food segment of a category-led name: "Fish, salmon") is in the phrase, as typed, singular, through a synonym, or
 * abbreviated (3+ letters: "veg" for "vegetable"). "veg fried rice" does not name "Rissoles, brown rice, fried in
 * vegetable oil": its words are all in the name, but the dish, rissoles, is not in the phrase. A bracketed other name
 * counts as a head ("poha aur dahi" names "Poha with curd (Poha aur dahi)").
 */
export function namesHead(query: string, name: string): boolean {
  const typed = String(query || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const forms = typed.flatMap((w) => [w, ...normalizeQuery(w).split(' ')]).filter(Boolean).map(singular);
  // A bracketed name is the dish's own other name ("Poha with curd (Poha aur dahi)"), so it counts as a head too.
  const bracketed = [...name.toLowerCase().matchAll(/\(([^()]*)\)/g)].flatMap((m) => m[1].split('/'));
  return [...headSegments(name), ...bracketed].some((head) => {
    const words = head.split(/[^a-z0-9']+/).filter((w) => w && !LINK_WORDS.has(w)).map(singular);
    return words.length > 0 && words.every((w) => forms.some((f) => f === w || (f.length >= 3 && w.startsWith(f))));
  });
}

// Category-led names ("Fish, salmon", "Cheese, paneer") also count the food segment as the head.
const headsOf = (row: SearchRow) => headSegments(row.name).map((h) => h.split(/\s+/).map(singular));

/** The food is named exactly what was searched: its head ("banana" == "Banana, raw") or a cited alias ("rajma"). */
function namesQuery(row: SearchRow, tokens: string[]) {
  const qWords = tokens.map(singular).join(' ');
  return headsOf(row).some((h) => h.join(' ') === qWords)
    || (!!row.aliases && row.aliases.split('|').some((a) => normalizeQuery(a) === tokens.join(' ')));
}

function score(row: SearchRow, tokens: string[], rawQuery: string) {
  const name = row.name.toLowerCase();
  const head = name.split(',')[0].trim();
  const heads = headsOf(row);
  const headWords = heads.flat();
  const qWords = tokens.map(singular);
  let s = -row.rank; // bm25: lower is better -> flip
  const inHead = qWords.filter((t) => headWords.some((w) => w.startsWith(t))).length;
  s += inHead * 4;
  if (namesQuery(row, tokens)) s += 12;
  else if (heads.some((h) => h[0] === qWords[0])) s += 5;
  // USDA names invert modifiers ("Rice, white"): match the query against the first two segments.
  const core = name.split(',').slice(0, 2).join(' ').split(/\s+/).filter(Boolean).map(singular);
  if (core.length <= qWords.length + 1 && qWords.every((t) => core.some((w) => w.startsWith(t)))) s += 7;
  if (qWords.every((t) => name.includes(t))) s += 3;
  // FTS matches prefixes, so "roti" also finds "rotisserie"; a whole-word match is the likelier meaning
  // ("Bread, chapati or roti").
  const nameWords = name.split(/[^a-z0-9']+/).filter(Boolean).map(singular);
  if (qWords.every((t) => nameWords.includes(t))) s += 4;
  // "Beans and white rice" is a combination dish; only prefer it when the query asks for one.
  if (/\b(and|with)\b/.test(head) && !/\b(and|with)\b/.test(rawQuery)) s -= 6;
  // "Wild rice", "Frozen yogurts", "Peanut butter", "Sweet potato": a leading name that is another word plus the food
  // searched is a different food, unless that word was searched too ("raw rice" is rice, not wild rice).
  const headOnly = head.split(/\s+/).map(singular);
  if (!namesQuery(row, tokens) && headOnly.length > 1 && qWords.includes(headOnly.at(-1)!) && headOnly.slice(0, -1).some((w) => !qWords.includes(w))) s -= 8;
  // A drink is hot unless the query says iced ("green tea" is a cup of green tea, not iced tea).
  if (/\biced\b/.test(name) && !/\b(iced?|cold)\b/.test(rawQuery)) s -= 5;
  if (GENERIC.test(name)) s += 2.5;
  if (NICHE.test(name) && !NICHE.test(rawQuery)) s -= 8;
  const variant = name.match(SPECIALTY);
  if (variant && !rawQuery.includes(variant[0].toLowerCase())) s -= 2;
  const form = name.match(FORMS);
  if (form && !rawQuery.includes(form[0].toLowerCase())) s -= 4;
  const second = (name.split(',')[1] || '').trim();
  if (/^(regular|original|nfs|plain)$/.test(second) || STAPLE_DEFAULTS[head] === second) s += 1; // the default variety
  s -= name.split(/[\s,]+/).length * 0.35; // shorter, more generic names first
  if (row.source === 'survey') s += 1; // dishes as eaten suit meal logging
  if (row.source === 'indb') {
    s += namesQuery(row, tokens) ? 1 : -3; // dish databank totals, not generic staples ("2 eggs")
  }
  if (row.source === 'recipe') {
    s += namesQuery(row, tokens) ? 0.25 : -3; // broad composed names must not beat CoFID aliases or INDB totals
  }
  if (row.source === 'foundation') s += 0.5;
  return s;
}

// Words that describe an amount or a meal, never a food, so they are not respelled.
const NOT_FOOD_WORDS = new Set(['bowl', 'bowls', 'katori', 'katoris', 'plate', 'plates', 'glass', 'glasses',
  'piece', 'pieces', 'slice', 'slices', 'serving', 'servings', 'small', 'medium', 'large', 'half', 'quarter', 'cups',
  'spoon', 'spoons', 'ladle', 'handful', 'some', 'with', 'without', 'homemade']);

/** A word the catalog knows, as typed, singular, or through a synonym ("curd" -> yogurt). */
function knownWord(word: string): boolean {
  const { counts } = vocabulary();
  return [word, ...normalizeQuery(word).split(' ')].some((f) => counts.has(f) || counts.has(singular(f)));
}

/**
 * The query with each word the catalog doesn't know replaced by the closest one it does ("panner tikka" ->
 * "paneer tikka"), or null when every word is known or has no close match.
 */
function correctSpelling(query: string): string | null {
  let changed = false;
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean).map((w) => {
    const word = w.replace(/[^a-z]/g, '');
    if (word.length < 4 || word !== w || NOT_FOOD_WORDS.has(word) || knownWord(word)) return w;
    const fix = closestWord(word) ?? closestWord(singular(word));
    if (!fix) return w;
    changed = true;
    return fix;
  });
  return changed ? words.join(' ') : null;
}

// A query typed exactly as a reviewed alias (data/aliases/recipes.json: "curd rice", "dosa") names that food
// outright. The alias is compared as typed, before synonyms ("curd" -> yogurt) rewrite the query. The build records
// these in meta.pinned_aliases; aliases INDB derives from its dish names are not pinned.
const aliasKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
let aliasIndex: Map<string, number> | null = null;
function aliasedFood(query: string): number | undefined {
  if (!aliasIndex) {
    const row = foods().prepare("SELECT value FROM meta WHERE key = 'pinned_aliases'").get() as { value: string } | undefined;
    aliasIndex = new Map(Object.entries(JSON.parse(row?.value ?? '{}') as Record<string, number>).map(([a, id]) => [aliasKey(a), id]));
  }
  return aliasIndex.get(aliasKey(query));
}

/**
 * Search the catalog. When the query as typed finds no food with all its words, a respelled query is tried, and
 * its results are returned with `didYouMean` when they match better.
 */
export function searchFoods(query: string | null | undefined, opts: SearchOptions = {}): SearchResult {
  const asTyped = searchOnce(query, opts);
  if (asTyped.match === 'all-words') return asTyped;
  // Known equivalent forms (spellings, Hindi names, connector words) before any partial match: one that names a food
  // on all its words is that food, written another way ("murgh korma" is chicken korma). A fuzzy respelling below is
  // only ever a suggestion.
  for (const form of equivalentQueries(String(query ?? ''))) {
    const r = searchOnce(form, opts);
    // Every word must also be in what identifies the food, not only in a description of it: "vegetable fried rice"
    // has every word of "Rissoles, brown rice, fried in vegetable oil", but rissoles aren't what was eaten.
    if (r.match === 'all-words' && r.results[0] && identifiedBy(normalizeQuery(form), r.results[0])) return { ...r, matchedAs: form };
  }
  if (asTyped.match === 'prefix') return asTyped;
  const respelled = correctSpelling(String(query ?? ''));
  if (!respelled) return asTyped;
  const fixed = searchOnce(respelled, opts);
  return fixed.match === 'all-words' || fixed.match === 'prefix' ? { ...fixed, didYouMean: respelled } : asTyped;
}

/**
 * How many full-text matches are ranked per search. `total` counts the distinct foods among them, so paging past it
 * (the API caps `offset` below this) never finds more.
 */
export const RANKED_MATCHES = 400;

function searchOnce(query: string | null | undefined, { limit = 10, offset = 0, source }: SearchOptions = {}): SearchResult {
  const q = normalizeQuery(query);
  if (!q) return { query: q, total: 0, results: [] };
  const tokens = q.split(' ');
  const stmt = foods().prepare(`
    SELECT f.id, f.name, f.source, f.category, f.aliases, bm25(foods_fts, 10.0, 1.0, 10.0) AS rank
    FROM foods_fts JOIN foods f ON f.id = foods_fts.rowid
    WHERE foods_fts MATCH ? ${source ? 'AND f.source = ?' : ''}
    ORDER BY rank LIMIT ${RANKED_MATCHES}`);
  // Whole words before prefixes, so "chole" never reaches "cholesterol" while a whole-word match exists, and
  // partial typing ("chick") still finds chicken. Any single word only when no food has them all.
  const passes: [SearchMatch, 'AND' | 'OR', boolean][] = [['all-words', 'AND', false], ['prefix', 'AND', true]];
  if (tokens.length > 1) passes.push(['any-word', 'OR', false], ['any-word', 'OR', true]);
  let rows: SearchRow[] = [];
  let match: SearchMatch | undefined;
  for (const [kind, op, prefix] of passes) {
    rows = (stmt.all(...(source ? [ftsQuery(tokens, op, prefix), source] : [ftsQuery(tokens, op, prefix)])) as unknown as SearchRow[])
      .filter((r) => !onlyInParentheses(r, tokens, prefix));
    // The tokenizer stems the query too, so a half-typed "chicke" matches "chick" as a whole word; unless some
    // result really contains a word as typed, treat the query as partial and try prefixes.
    if (kind === 'all-words' && !rows.some((r) => wordCoverage(String(query), `${r.name} ${r.aliases?.replaceAll('|', ' ') ?? ''}`) > 0)) continue;
    if (rows.length) { match = kind; break; }
  }
  const ranked = rows
    .map((r) => ({ ...r, score: score(r, tokens, q) }))
    .sort((a, b) => b.score - a.score);
  // CoFID fills gaps in USDA's dishes: a USDA food named exactly what was searched comes before every CoFID food
  // (it also has household portions). "sambar" is USDA's sambar; "rajma", which USDA lacks, is CoFID's.
  const usdaNamed = ranked.findIndex((r) => r.source !== 'cofid' && r.source !== 'recipe' && r.source !== 'indb' && namesQuery(r, tokens));
  const firstCofid = ranked.findIndex((r) => r.source === 'cofid' && namesQuery(r, tokens));
  const firstRecipe = ranked.findIndex((r) => r.source === 'recipe' || r.source === 'indb');
  if (usdaNamed > 0 && firstCofid >= 0 && firstCofid < usdaNamed) ranked.splice(firstCofid, 0, ...ranked.splice(usdaNamed, 1));
  if (usdaNamed > 0 && firstRecipe >= 0 && firstRecipe < usdaNamed) ranked.splice(usdaNamed, 0, ...ranked.splice(firstRecipe, 1));
  else if (firstCofid >= 0 && namesQuery(ranked[firstCofid], tokens)) {
    const [cofid] = ranked.splice(firstCofid, 1);
    const insertAt = ranked.findIndex((r) => r.source === 'recipe');
    ranked.splice(insertAt >= 0 ? insertAt : 0, 0, cofid);
  } else if (firstCofid > 0 && firstRecipe >= 0 && firstRecipe < firstCofid) ranked.splice(firstCofid, 0, ...ranked.splice(firstRecipe, 1));
  const aliased = aliasedFood(String(query ?? ''));
  if (aliased !== undefined) {
    const i = ranked.findIndex((r) => r.id === aliased);
    if (i >= 0) ranked.unshift(...ranked.splice(i, 1));
    else {
      const row = foods().prepare(`SELECT id, name, source, category, aliases, 0 AS rank FROM foods WHERE id = ? ${source ? 'AND source = ?' : ''}`)
        .get(...(source ? [aliased, source] : [aliased])) as unknown as SearchRow | undefined;
      if (row) ranked.unshift({ ...row, score: ranked[0] ? ranked[0].score + 1 : 0 });
    }
    if (ranked[0]?.id === aliased) match = 'all-words';
  }
  // As typed first: singular() turns "cookies" into "cooky".
  const preferred = BARE_DEFAULTS[tokens.join(' ')] ?? BARE_DEFAULTS[tokens.map(singular).join(' ')];
  if (preferred) {
    const i = ranked.findIndex((r) => r.name === preferred);
    if (i >= 0) ranked.unshift(...ranked.splice(i, 1));
    else {
      const row = foods().prepare(`SELECT id, name, source, category, aliases, 0 AS rank FROM foods WHERE name = ? ${source ? 'AND source = ?' : ''}`)
        .get(...(source ? [preferred, source] : [preferred])) as unknown as SearchRow | undefined;
      if (row) {
        ranked.unshift({ ...row, score: ranked[0] ? ranked[0].score + 1 : 0 });
        match ??= 'all-words'; // the bare word names this food outright
      }
    }
  }
  // Keep the best-ranked entry of each food (rows are already in rank order).
  const seen = new Set<string>();
  const unique = ranked.filter((r) => {
    const key = sameFoodKey(r.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    query: q,
    // An alias or bare-word default can promote a weak match to a named one, so this is read at the end.
    relaxed: match === 'any-word',
    ...(match ? { match } : {}),
    total: unique.length,
    results: unique.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      name: r.name,
      source: r.source,
      category: r.category,
      score: Math.round(r.score * 100) / 100,
    })),
  };
}
