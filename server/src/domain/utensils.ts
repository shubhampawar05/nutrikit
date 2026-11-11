// Indian household measures as volumes.
//
// A katori has no standard size, so, like a bowl, it is taken in US cups: small ¾ cup, medium 1 cup (the default),
// large 1½ cups. These are Nutrikit's own conventions, not a published standard. A volume becomes grams through the
// food's own density (see units.ts), never one weight for all.

export interface Utensil {
  ml: number;
  /** How the volume is shown to the caller. */
  basis: string;
}

const CUP_ML = 236.588;

const KATORI: Record<'small' | 'medium' | 'large', { cups: number; label: string }> = {
  small: { cups: 0.75, label: '¾ cup' },
  medium: { cups: 1, label: '1 cup' },
  large: { cups: 1.5, label: '1½ cups' },
};

const SIZE_WORDS: Record<string, keyof typeof KATORI> = { small: 'small', medium: 'medium', large: 'large', big: 'large' };

/** "katori", "small katori", "2 large katoris" -> its volume, or null for anything else. */
export function utensil(word: string | null | undefined): Utensil | null {
  const m = String(word ?? '').toLowerCase().trim().match(/^(?:(small|medium|large|big)\s+)?katoris?$/);
  if (!m) return null;
  const size = SIZE_WORDS[m[1] ?? 'medium'];
  const { cups, label } = KATORI[size];
  const ml = cups * CUP_ML;
  return { ml, basis: `${size} katori, taken as ${label} (${ml.toFixed(1)} ml)` };
}
