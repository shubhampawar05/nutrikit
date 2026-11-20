// Indian household measures as volumes.
//
// A katori is 200 ml: ICMR-NIN Dietary Guidelines 2024, Annexure I (medium katori). A volume becomes grams through
// the food's own density (see units.ts), never one weight for all. A small or large katori has no single published
// size (NIN lists two small katoris, 155 ml and 115 ml, and no large one), so its amount is asked for, not guessed
// (openspec/changes/portion-logging-v2/serving-reference.md, D1).

export interface Utensil {
  /** The volume, or null when the measure has no supported size (then `basis` says why). */
  ml: number | null;
  /** How the volume is shown to the caller, or why it can't be given. */
  basis: string;
}

const KATORI_ML = 200;

const UNSIZED: Record<'small' | 'large', string> = {
  small: 'a small katori has no single size (ICMR-NIN lists 155 ml and 115 ml); give the amount in grams, ml or katoris',
  large: 'a large katori has no published size; give the amount in grams, ml or katoris',
};

/** "katori", "small katori", "2 large katoris" -> its volume (null ml for a size with no source), or null for anything else. */
export function utensil(word: string | null | undefined): Utensil | null {
  const m = String(word ?? '').toLowerCase().trim().match(/^(?:(small|medium|large|big)\s+)?katoris?$/);
  if (!m) return null;
  const size = m[1] === 'big' ? 'large' : m[1];
  if (size === 'small' || size === 'large') return { ml: null, basis: UNSIZED[size] };
  return { ml: KATORI_ML, basis: `katori, 200 ml (ICMR-NIN 2024)` };
}
