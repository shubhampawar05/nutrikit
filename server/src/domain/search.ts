// Food search: SQLite FTS5 recall, then a reranker tuned for food logging (prefer the generic,
// as-eaten form whose leading name segment matches the query, e.g. "egg" -> "Egg, whole, ...").
import { foods } from './db.ts';
import { lookup } from './lookup.ts';
import { headSegments } from './names.ts';
import { closestWord, vocabulary } from './spelling.ts';

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
  total: number;
  results: SearchHit[];
}

// Everyday words -> the wording USDA uses.
const SYNONYMS: Record<string, string> = lookup({
  soda: 'soft drink', pop: 'soft drink', fries: 'french fries', chips: 'potato chips', ketchup: 'catsup',
  oatmeal: 'oatmeal', yoghurt: 'yogurt', hamburger: 'hamburger', burger: 'hamburger', pb: 'peanut butter',
  oj: 'orange juice', coffee: 'coffee', espresso: 'coffee espresso', latte: 'coffee latte', tofu: 'tofu',
  toast: 'bread toasted', aubergine: 'eggplant', courgette: 'zucchini', prawns: 'shrimp', prawn: 'shrimp', mince: 'ground beef',
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
];

// A bare everyday word (the whole query, nothing else) means one particular food: "tea" is a cup of hot black
// tea, not iced tea; "salad" is a green salad, not beef salad. "iced tea" or "chicken salad" are untouched.
// The default food is pinned first; the other matches still follow, so searching "tea" lists every tea.
const BARE_DEFAULTS: Record<string, string> = lookup({
  tea: 'Tea, hot, leaf, black',
  // Chai as drunk in India: brewed with milk and sugar (this FNDDS entry is sweetened, about 51 kcal per 100 g).
  chai: 'Tea, hot, with milk',
  salad: 'Lettuce, salad with assorted vegetables including tomatoes and/or carrots, no dressing',
});

const GENERIC = /\b(raw|nfs|plain|cooked|regular|fresh|boiled|baked|brewed|without salt|ns as to)\b/i;
// The variety people mean by the bare staple name.
const STAPLE_DEFAULTS: Record<string, string> = lookup({ bread: 'white', rice: 'white', milk: 'whole', sugar: 'granulated' });
// Processed forms of a staple ("Bread, crumbs") are rarely what a plain query means.
const FORMS = /\b(crumbs|sticks|croutons|stuffing|dressing|mix|batter|dough|flour|concentrate|syrup|extract)\b/i;
// Specialty variants are fine matches, just not the default reading of a plain query.
const SPECIALTY = /\b(glutinous|sticky|meatless|imitation|vegetarian|vegan|plant-based|whole wheat|gluten-free|stuffed|reduced fat|low fat|lowfat|fat free|nonfat|light|diet|sugar free|from frozen|with fruit|low sodium|reduced sodium|coated|breaded|battered|made with butter|made with margarine|made with oil|fat added)\b/i;
const NICHE =/\b(baby food|infant formula|toddler|puree for|dehydrated|freeze-dried|powder|canned, drained solids|alaska native|frozen dinner)\b/i;

export function normalizeQuery(q: unknown): string {
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
  if (row.source === 'survey' || row.source === 'recipe') s += 1; // dishes as eaten suit meal logging
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
export function correctSpelling(query: string): string | null {
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

/**
 * Search the catalog. When the query as typed finds no food with all its words, a respelled query is tried, and
 * its results are returned with `didYouMean` when they match better.
 */
export function searchFoods(query: string | null | undefined, opts: SearchOptions = {}): SearchResult {
  const asTyped = searchOnce(query, opts);
  if (asTyped.match === 'all-words' || asTyped.match === 'prefix') return asTyped;
  const respelled = correctSpelling(String(query ?? ''));
  if (!respelled) return asTyped;
  const fixed = searchOnce(respelled, opts);
  return fixed.match === 'all-words' || fixed.match === 'prefix' ? { ...fixed, didYouMean: respelled } : asTyped;
}

function searchOnce(query: string | null | undefined, { limit = 10, offset = 0, source }: SearchOptions = {}): SearchResult {
  const q = normalizeQuery(query);
  if (!q) return { query: q, total: 0, results: [] };
  const tokens = q.split(' ');
  const stmt = foods().prepare(`
    SELECT f.id, f.name, f.source, f.category, f.aliases, bm25(foods_fts, 10.0, 1.0, 10.0) AS rank
    FROM foods_fts JOIN foods f ON f.id = foods_fts.rowid
    WHERE foods_fts MATCH ? ${source ? 'AND f.source = ?' : ''}
    ORDER BY rank LIMIT 400`);
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
  const relaxed = match === 'any-word';
  const ranked = rows
    .map((r) => ({ ...r, score: score(r, tokens, q) }))
    .sort((a, b) => b.score - a.score);
  // CoFID fills gaps in USDA's dishes: a USDA food named exactly what was searched comes before every CoFID food
  // (it also has household portions). "sambar" is USDA's sambar; "rajma", which USDA lacks, is CoFID's.
  const usdaNamed = ranked.findIndex((r) => r.source !== 'cofid' && namesQuery(r, tokens));
  const firstCofid = ranked.findIndex((r) => r.source === 'cofid');
  if (usdaNamed > 0 && firstCofid >= 0 && firstCofid < usdaNamed) ranked.splice(firstCofid, 0, ...ranked.splice(usdaNamed, 1));
  const preferred = BARE_DEFAULTS[tokens.map(singular).join(' ')];
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
    relaxed,
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
