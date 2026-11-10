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
  for (const w of counts.keys()) byLength.set(w.length, [...(byLength.get(w.length) ?? []), w]);
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

/**
 * The catalog word closest to a word the catalog doesn't have: one edit away for words of 4-7 letters, two for
 * longer ones. Closer words win, then words starting with the same letter, then words more foods use.
 */
export function closestWord(word: string): string | null {
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
