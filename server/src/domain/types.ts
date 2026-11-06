// Shared domain shapes (types only; nothing here exists at runtime).

/** Per-100 g nutrient values keyed by catalog key (see NUTRIENTS). */
export type Per100g = Record<string, number>;

export interface NutrientDef {
  key: string;
  name: string;
  unit: string;
  fdc: number[];
  dv: number | null;
  group: 'macro' | 'fat' | 'mineral' | 'vitamin' | 'other';
}

// A type alias so nutrient maps stay assignable to JSON value types (e.g. postgres sql.json()).
/** One scaled nutrient, as returned by scaleNutrients/sumNutrients. */
export type NutrientAmount = {
  amount: number | null;
  unit: string;
  dailyValuePercent: number | null;
  /** On totals only: how many of the summed foods had no value for this nutrient (absent when none). */
  missingFrom?: number;
};

export type NutrientMap = Record<string, NutrientAmount>;

/** A household portion of a catalog food ("1 cup", 1, 'cup', 158 g). */
export interface Portion {
  label: string;
  amount: number;
  unit: string | null;
  grams: number;
}

/** A catalog food as returned by getFood(). */
export interface Food {
  id: number;
  name: string;
  source: string;
  category: string | null;
  per100g: Per100g;
  portions: Portion[];
}

/** A quantity resolved to grams for a specific food. */
export interface ResolvedPortion {
  grams: number;
  quantity: number;
  unit: string;
  portion: string | null;
  method: string;
}

/** Model token usage reported by an AI provider, metered by auth.settle(). */
export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}
