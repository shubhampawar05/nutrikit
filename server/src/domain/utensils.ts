// Indian household measures as volumes, with where each number comes from.
//
// Katori volumes: ICMR-NIN, Dietary Guidelines for Indians 2024, Annexure I "Suggested measuring katori/cups and
// spoons" (printed page 111). They are standardised measuring utensils, not every household's bowl. The annexure
// lists two small katoris, C8 = 155 ml and C9 = 115 ml (page 112 calls both intentional); "small" uses C8, the
// first one listed. A volume becomes grams through the food's own density (see units.ts), never one weight for all.

export interface Utensil {
  ml: number;
  /** How the volume is shown to the caller, with its source. */
  basis: string;
}

const NIN = 'ICMR-NIN Dietary Guidelines 2024, Annexure I';

const KATORI: Record<'small' | 'medium' | 'large', { ml: number; code: string }> = {
  small: { ml: 155, code: 'C8' },
  medium: { ml: 200, code: 'C7' },
  large: { ml: 360, code: 'C6' },
};

const SIZE_WORDS: Record<string, keyof typeof KATORI> = { small: 'small', medium: 'medium', large: 'large', big: 'large' };

/** "katori", "small katori", "2 large katoris" -> its volume and source, or null for anything else. */
export function utensil(word: string | null | undefined): Utensil | null {
  const m = String(word ?? '').toLowerCase().trim().match(/^(?:(small|medium|large|big)\s+)?katoris?$/);
  if (!m) return null;
  const size = SIZE_WORDS[m[1] ?? 'medium'];
  const { ml, code } = KATORI[size];
  return { ml, basis: `${size} katori (${ml} ml, ${NIN} ${code})` };
}
