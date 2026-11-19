// Pure arithmetic for the estimate benchmark: how set A references are formed from independent sources, and how
// estimates are scored against them. No I/O, so test/eval-metrics.test.mjs can pin every rule.

export const MACROS = ['protein', 'carbs', 'fat'] as const;
export type Macro = (typeof MACROS)[number];
export type Values = { calories: number } & Partial<Record<Macro, number | null>>;

/** Families agree when the lowest kcal is at least this share of the highest. */
export const POINT_AGREEMENT = 0.85;
/** Beyond this ratio (highest / lowest) the sources disagree too much to say anything: the dish is not scored. */
export const RANGE_MAX_RATIO = 1.5;

export type Reference =
  | { kind: 'point'; calories: number; macros: Partial<Record<Macro, number>>; low: number; high: number }
  | { kind: 'range'; low: number; high: number; macros: Partial<Record<Macro, number>> }
  | { kind: 'excluded'; low: number; high: number; reason: string };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The reference for a dish from one value per independent family (at least two). point: every family within 15% of
 * the highest, reference = their mean. range: further apart but within 1.5x, reference = [low, high]. excluded:
 * further apart than that. Macros are the family mean where every family gives that macro.
 */
export function consensus(values: Values[]): Reference {
  if (values.length < 2) throw new Error('consensus needs values from at least two independent families');
  const kcal = values.map((v) => v.calories);
  const low = Math.min(...kcal);
  const high = Math.max(...kcal);
  if (!(low > 0)) throw new Error('every family must give a positive calorie value');
  const macros: Partial<Record<Macro, number>> = {};
  for (const m of MACROS) {
    const xs = values.map((v) => v[m]);
    if (xs.every((x): x is number => typeof x === 'number')) macros[m] = mean(xs);
  }
  if (low >= POINT_AGREEMENT * high) return { kind: 'point', calories: mean(kcal), macros, low, high };
  if (high <= RANGE_MAX_RATIO * low) return { kind: 'range', low, high, macros };
  return { kind: 'excluded', low, high, reason: `sources differ ${(high / low).toFixed(2)}x (${Math.round(low)}-${Math.round(high)} kcal/100 g)` };
}

/**
 * Relative calorie error of an estimate against a reference: |est - ref| / ref for a point; 0 inside a range,
 * otherwise the distance to the nearer end over that end. Null for an excluded reference.
 */
export function calorieError(estimate: number, ref: Reference): number | null {
  if (ref.kind === 'excluded') return null;
  if (ref.kind === 'point') return Math.abs(estimate - ref.calories) / ref.calories;
  if (estimate < ref.low) return (ref.low - estimate) / ref.low;
  if (estimate > ref.high) return (estimate - ref.high) / ref.high;
  return 0;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const avg = (xs: number[]): number | null => (xs.length ? mean(xs) : null);

/** Density metrics over scored rows (estimate and reference for each dish that has both). */
export function densitySummary(rows: { estimate: Values | null; ref: Reference }[]) {
  const eligible = rows.filter((r) => r.ref.kind !== 'excluded');
  const scored = eligible.filter((r): r is { estimate: Values; ref: Exclude<Reference, { kind: 'excluded' }> } => r.estimate != null);
  const err = scored.map((r) => calorieError(r.estimate.calories, r.ref)!);
  const points = scored.filter((r) => r.ref.kind === 'point') as { estimate: Values; ref: Extract<Reference, { kind: 'point' }> }[];
  const absKcal = points.map((r) => Math.abs(r.estimate.calories - r.ref.calories));
  const macroMae = Object.fromEntries(MACROS.map((m) => {
    const d = scored.flatMap((r) => (r.ref.macros[m] != null && r.estimate[m] != null ? [Math.abs(r.estimate[m]! - r.ref.macros[m]!)] : []));
    return [m, avg(d)];
  })) as Record<Macro, number | null>;
  return {
    eligible: eligible.length,
    scored: scored.length,
    coverage: eligible.length ? scored.length / eligible.length : null,
    calorieMaeKcal: avg(absKcal), // points only: a range has no single value to subtract
    calorieMape: avg(err),
    calorieMedianError: median(err),
    within10: scored.length ? err.filter((e) => e <= 0.1).length / scored.length : null,
    within20: scored.length ? err.filter((e) => e <= 0.2).length / scored.length : null,
    over50: err.filter((e) => e > 0.5).length,
    macroMaeGrams: macroMae,
  };
}

/** Portion metrics: logged grams against reference grams. */
export function portionSummary(rows: { grams: number | null; ref: number }[]) {
  const scored = rows.filter((r): r is { grams: number; ref: number } => r.grams != null);
  const rel = scored.map((r) => Math.abs(r.grams - r.ref) / r.ref);
  return {
    eligible: rows.length,
    scored: scored.length,
    coverage: rows.length ? scored.length / rows.length : null,
    maeGrams: avg(scored.map((r) => Math.abs(r.grams - r.ref))),
    medianRelativeError: median(rel),
    within25: scored.length ? rel.filter((e) => e <= 0.25).length / scored.length : null,
    over2x: scored.filter((r) => r.grams > 2 * r.ref || r.grams < r.ref / 2).length,
  };
}

/** Mean and spread (min-max) of one metric across runs, ignoring runs where it is null. */
export function acrossRuns(values: (number | null)[]): { mean: number | null; min: number | null; max: number | null; runs: number } {
  const xs = values.filter((x): x is number => x != null);
  return { mean: avg(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, runs: xs.length };
}

/** Per-nutrient median of several estimates of the same food (the 3-sample experiment). */
export function medianValues(samples: Record<string, number | null>[]): Record<string, number | null> {
  const keys = [...new Set(samples.flatMap((s) => Object.keys(s)))];
  return Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]).filter((x): x is number => typeof x === 'number'))]));
}
