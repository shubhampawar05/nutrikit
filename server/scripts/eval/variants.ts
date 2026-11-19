// Prompt variants the benchmark compares. `baseline` is exactly what logging uses (no override is passed).
import { ESTIMATE_SYSTEM, estimateMessage } from '../../src/domain/providers/prompts.ts';
import type { CatalogCandidate, EstimatePrompt } from '../../src/domain/providers/index.ts';

const clean = (s: string) => s.replace(/\s+/g, ' ').slice(0, 100);
const g = (x: number | null | undefined) => (x == null ? '?' : `${Math.round(x * 10) / 10} g`);

/**
 * Reference anchoring: catalog entries carry protein, carbs and fat as well as kcal, and the model is asked to reason
 * from the closest similar foods when none is the same dish, instead of only using them for sameAs.
 */
export const ANCHORED: EstimatePrompt = {
  system: `${ESTIMATE_SYSTEM}

Reference points:
- The catalog entries also give protein, carbs and fat per 100 g. They are measured or published values.
- When no entry is the same dish, use the most similar entries as reference points: start from the closest one and
  adjust for how this food differs from it (more or less oil, sugar, water, meat, or a different main ingredient).
  Ignore entries that are clearly unrelated.`,
  message: (foods: string[], candidates?: CatalogCandidate[][]) => `Foods:\n${foods.map((f, i) => {
    const list = candidates?.[i] ?? [];
    const catalog = list.map((c) => `\n  catalog [${c.id}] ${clean(c.name)}: ${c.calories == null ? '?' : Math.round(c.calories)} kcal, protein ${g(c.protein)}, carbs ${g(c.carbs)}, fat ${g(c.fat)} per 100 g`).join('');
    return `- ${clean(f)}${catalog}`;
  }).join('\n')}`,
};

export const BASELINE_PROMPT: EstimatePrompt = { system: ESTIMATE_SYSTEM, message: estimateMessage };

export const VARIANTS = ['baseline', 'anchored', 'median3', 'detailed'] as const;
export type Variant = (typeof VARIANTS)[number];
