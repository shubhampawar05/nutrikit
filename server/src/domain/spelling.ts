// Spelling suggestions for food searches ("panner" -> "paneer", "chiken" -> "chicken").
//
// The vocabulary is read from the loaded catalog (every word of every food name and alias) the first time it is
// needed, so it always matches the foods.db the server runs on and needs no build step.
import { foods } from './db.ts';

interface Vocabulary {
  counts: Map<string, number>; // word -> how many foods use it (more common words win ties)
  byLength: Map<number, string[]>;
}

let vocab: Vocabulary | undefined;

const WORDS = /[a-z]+/g;

export function vocabulary(): Vocabulary {
  if (vocab) return vocab;
  const counts = new Map<string, number>();
  const rows = foods().prepare('SELECT name, aliases FROM foods').all() as { name: string; aliases: string | null }[];
  for (const { name, aliases } of rows) {
    const words = new Set(`${name} ${aliases ?? ''}`.toLowerCase().match(WORDS) ?? []);
    for (const w of words) if (w.length >= 3) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const byLength = new Map<number, string[]>();
  for (const w of counts.keys()) {
    const bucket = byLength.get(w.length);
    if (bucket) bucket.push(w);
    else byLength.set(w.length, [w]);
  }
  vocab = { counts, byLength };
  return vocab;
}

/** Edit distance (insertions, deletions, substitutions, adjacent swaps), or max + 1 once it exceeds max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** A word's consonants in order, with doubled letters collapsed: "panir" and "paneer" are both "pnr". */
export const consonants = (w: string) => w.replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');

/**
 * The catalog word closest to a word the catalog doesn't have: one edit away for words of 4-7 letters, two for
 * longer ones. Closer words win, then words starting with the same letter, then words more foods use.
 * One exception: a closest word that loses one of the word's consonants (other than a plural s) is likely a
 * different word ("panir" -> pani), so a spelling with the same consonants one edit further wins when there is one
 * ("panir" -> paneer: 5+ letters, same first and last letter). This only ever makes a suggestion (didYouMean); a
 * respelled word is never logged as a food.
 */
export function closestWord(word: string): string | null {
  const best = nearestWord(word);
  if (!best || word.length < 5) return best;
  const lost = consonants(best).length < consonants(word).length && !(word.endsWith('s') && best === word.slice(0, -1));
  if (!lost) return best;
  const skeleton = consonants(word);
  const max = word.length >= 8 ? 3 : 2;
  const { counts, byLength } = vocabulary();
  let alt: { w: string; d: number; count: number } | null = null;
  for (let len = word.length - max; len <= word.length + max; len++) {
    for (const w of byLength.get(len) ?? []) {
      if (w[0] !== word[0] || w.at(-1) !== word.at(-1) || consonants(w) !== skeleton) continue;
      const d = editDistance(word, w, max);
      if (d > max) continue;
      if (!alt || d < alt.d || (d === alt.d && (counts.get(w) ?? 0) > alt.count)) alt = { w, d, count: counts.get(w) ?? 0 };
    }
  }
  return alt?.w ?? best;
}

/** The nearest catalog word by edit distance alone (see closestWord). */
function nearestWord(word: string): string | null {
  if (word.length < 4) return null;
  const max = word.length >= 8 ? 2 : 1;
  const { counts, byLength } = vocabulary();
  let best: { w: string; d: number; first: number; plural: number; count: number } | null = null;
  const rank = (c: NonNullable<typeof best>) => c.d * 1e9 + c.first * 1e8 + c.plural * 1e7 - c.count;
  for (let len = word.length - max; len <= word.length + max; len++) {
    for (const w of byLength.get(len) ?? []) {
      const d = editDistance(word, w, max);
      if (d > max) continue;
      // A plural loses to its singular at the same distance ("samosaa" -> samosa, not samosas).
      const plural = w.endsWith('s') && counts.has(w.slice(0, -1)) ? 1 : 0;
      const cand = { w, d, first: w[0] === word[0] ? 0 : 1, plural, count: counts.get(w) ?? 0 };
      if (!best || rank(cand) < rank(best)) best = cand;
    }
  }
  return best?.w ?? null;
}

/**
 * A romanised word's transliteration key: spellings of one Hindi word share it. Aspirated consonants lose their h
 * (bh dh gh kh ph th -> b d g k p t), long vowels shorten (aa -> a, ee/ii -> i, oo/uu -> u), doubled consonants
 * collapse, and a Tamil -ai ending is -a ("dosai"). "paneer"/"panir", "daal"/"dal"/"dhal", "chapathi"/"chapati",
 * "jeera"/"jira", "mattar"/"matar" each share a key. Deliberately narrow: a dropped or extra letter ("chiken") is a
 * typo, left to the spelling suggestions.
 */
export const transliterationKey = (w: string) => w.toLowerCase()
  .replace(/(?<=[bdgkpt])h/g, '')
  .replace(/aa+/g, 'a').replace(/ee+|ii+/g, 'i').replace(/oo+|uu+/g, 'u')
  .replace(/([bcdfgjklmnpqrstvwxyz])\1+/g, '$1')
  .replace(/ai$/, 'a');

let keyIndex: Map<string, string> | undefined;
/**
 * The catalog's usual spelling of a word: for a word it doesn't know, the catalog word with the same transliteration
 * key (the one more foods use); for one it has, a commoner spelling with the same key. Null when there is none. A
 * Hindi plural in -e ("samose") is tried as its -a singular ("samosa"). Used only for equivalent forms of a query.
 */
export function catalogSpelling(word: string): string | null {
  if (word.length < 4) return null;
  const { counts } = vocabulary();
  if (!keyIndex) {
    keyIndex = new Map();
    for (const [w, n] of counts) {
      const k = transliterationKey(w);
      const have = keyIndex.get(k);
      if (!have || (counts.get(have) ?? 0) < n) keyIndex.set(k, w);
    }
  }
  const best = keyIndex.get(transliterationKey(word));
  // A word the catalog has is only respelled to a commoner spelling of it ("daal" -> dal, "bharta" -> bhartha).
  if (counts.has(word)) return best && best !== word && (counts.get(best) ?? 0) > (counts.get(word) ?? 0) ? best : null;
  return best ?? (word.endsWith('e') ? keyIndex.get(transliterationKey(`${word.slice(0, -1)}a`)) ?? null : null);
}
