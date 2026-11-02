// Food search: SQLite FTS5 recall, then a reranker tuned for food logging (prefer the generic,
// as-eaten form whose leading name segment matches the query, e.g. "egg" -> "Egg, whole, ...").
import { foods } from './db.ts';
import { lookup } from './lookup.ts';

interface SearchRow {
  id: number;
  name: string;
  source: string;
  category: string | null;
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

export interface SearchResult {
  query: string;
  relaxed?: boolean; // absent when the query normalizes to nothing
  total: number;
  results: SearchHit[];
}

// Everyday words -> the wording USDA uses.
const SYNONYMS: Record<string, string> = lookup({
  soda: 'soft drink', pop: 'soft drink', fries: 'french fries', chips: 'potato chips', ketchup: 'catsup',
  oatmeal: 'oatmeal', yoghurt: 'yogurt', hamburger: 'hamburger', burger: 'hamburger', pb: 'peanut butter',
  oj: 'orange juice', coffee: 'coffee', espresso: 'coffee espresso', latte: 'coffee latte', tofu: 'tofu',
  toast: 'bread toasted', aubergine: 'eggplant', courgette: 'zucchini', prawns: 'shrimp', prawn: 'shrimp', mince: 'ground beef',
});

const GENERIC = /\b(raw|nfs|plain|cooked|regular|fresh|boiled|baked|brewed|without salt|ns as to)\b/i;
// The variety people mean by the bare staple name.
const STAPLE_DEFAULTS: Record<string, string> = lookup({ bread: 'white', rice: 'white', milk: 'whole', sugar: 'granulated' });
// Processed forms of a staple ("Bread, crumbs") are rarely what a plain query means.
const FORMS = /\b(crumbs|sticks|croutons|stuffing|dressing|mix|batter|dough|flour|concentrate|syrup|extract)\b/i;
// Specialty variants are fine matches, just not the default reading of a plain query.
const SPECIALTY = /\b(glutinous|sticky|meatless|imitation|vegetarian|vegan|plant-based|whole wheat|gluten-free|stuffed|reduced fat|low fat|lowfat|fat free|nonfat|light|diet|sugar free|from frozen|with fruit|low sodium|reduced sodium)\b/i;
const NICHE =/\b(baby food|infant formula|toddler|puree for|dehydrated|freeze-dried|powder|canned, drained solids|alaska native|frozen dinner)\b/i;

export function normalizeQuery(q: unknown): string {
  return String(q || '')
    .toLowerCase()
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

function ftsQuery(tokens: string[], op: 'AND' | 'OR') {
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(` ${op} `);
}

function score(row: SearchRow, tokens: string[], rawQuery: string) {
  const name = row.name.toLowerCase();
  const head = name.split(',')[0].trim();
  const headWords = head.split(/\s+/).map(singular);
  const qWords = tokens.map(singular);
  let s = -row.rank; // bm25: lower is better -> flip
  const inHead = qWords.filter((t) => headWords.some((w) => w.startsWith(t))).length;
  s += inHead * 4;
  if (headWords.join(' ') === qWords.join(' ')) s += 12; // "banana" == "Banana, raw"
  else if (headWords[0] === qWords[0]) s += 5;
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
  if (row.source === 'foundation') s += 0.5;
  return s;
}

/**
 * @param {string} query
 * @param {{limit?: number, offset?: number, source?: string}} opts
 */
export function searchFoods(query: string | null | undefined, { limit = 10, offset = 0, source }: SearchOptions = {}): SearchResult {
  const q = normalizeQuery(query);
  if (!q) return { query: q, total: 0, results: [] };
  const tokens = q.split(' ');
  const stmt = foods().prepare(`
    SELECT f.id, f.name, f.source, f.category, bm25(foods_fts, 10.0, 1.0) AS rank
    FROM foods_fts JOIN foods f ON f.id = foods_fts.rowid
    WHERE foods_fts MATCH ? ${source ? 'AND f.source = ?' : ''}
    ORDER BY rank LIMIT 400`);
  const args = (match: string) => (source ? [match, source] : [match]);
  let rows = stmt.all(...args(ftsQuery(tokens, 'AND'))) as unknown as SearchRow[];
  let relaxed = false;
  if (!rows.length && tokens.length > 1) {
    rows = stmt.all(...args(ftsQuery(tokens, 'OR'))) as unknown as SearchRow[];
    relaxed = true;
  }
  const ranked = rows
    .map((r) => ({ ...r, score: score(r, tokens, q) }))
    .sort((a, b) => b.score - a.score);
  return {
    query: q,
    relaxed,
    total: ranked.length,
    results: ranked.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      name: r.name,
      source: r.source,
      category: r.category,
      score: Math.round(r.score * 100) / 100,
    })),
  };
}
