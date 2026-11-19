// Believable weights for one piece of foods that are counted in pieces (audit P0-5, task M3.1).
//
// The catalog's only weight for some of these is a recipe-yield serving: INDB divides the cooked recipe by the
// cookbook's serving count, so "1 serving" of rasgulla is 342 g (several pieces plus syrup). Counting pieces against
// that weight multiplies it ("2 rasgulla" = 684 g). These bounds decide only whether a weight can be one piece; they
// are sanity limits, not nutrition data, and no weight is ever made up from them.
//
// Same bounds as the food-specific entries of PIECES in scripts/indb-totals.mjs (the build's check on INDB serving
// names; test/nutrition-correctness.test.mjs keeps the two in step). Unit-word entries there ("slice", "piece") are
// not food names and are not used here.

/**
 * Checked at runtime so far (audit P0-5 starts with the sweets): the Indian sweets whose only catalog weight is a
 * recipe-yield serving, and kulfi. The other ranges below are the build's and need a per-food review before runtime
 * use: "egg" (40-200 g) would wrongly flag egg whites (33 g) and quail eggs (9 g).
 */
export const RUNTIME_PIECE_RANGES: [RegExp, number, number][] = [
  [/jamun|rasgull|chum chum|rasmalai|rajbogh|rasbhari|dil bahar/, 15, 80],
  [/ladoo|laddu/, 15, 80],
  [/burfi|barfi/, 10, 80],
  [/^kulfi$/, 30, 150],
];

/** [pattern on a food's main name, lowest and highest believable grams for one piece]: the build's full table. */
export const PIECE_RANGES: [RegExp, number, number][] = [
  [/jamun|rasgull|chum chum|rasmalai|rajbogh|rasbhari|dil bahar/, 15, 80],
  [/cutlet|tikki|patty|patties/, 30, 150],
  [/ladoo|laddu/, 15, 80],
  [/burfi|barfi/, 10, 80],
  [/samosa/, 20, 160],
  [/^(roti|chapati|phulka|thepla|pesarattu)$/, 20, 100],
  [/parantha|paratha/, 40, 160],
  [/^(naan|bhatura|poori|puri|kachori)$/, 15, 160],
  [/^idli$/, 20, 70],
  [/^(dosa|uttapam|appam|cheela)$/, 25, 300],
  [/^(vada|bonda|pakora|mulik\/fritter)$/, 8, 120],
  [/^(biscuit|cookie|cookies|gingerman)$/, 4, 60],
  [/^egg$/, 40, 200],
  [/^(kofta|kabab|kebab)$/, 15, 150],
  [/^kulfi$/, 30, 150],
];

/** The piece range for a food, matched on its main name (before the first comma or bracket), or null. */
export function pieceRange(foodName: string): { low: number; high: number } | null {
  const head = foodName.toLowerCase().split(/[,(]/)[0].trim();
  const hit = RUNTIME_PIECE_RANGES.find(([pattern]) => pattern.test(head));
  return hit ? { low: hit[1], high: hit[2] } : null;
}

/** Units that count pieces of a food: none at all ("2 rasgulla"), or a piece word. */
const PIECE_UNITS = new Set(['piece', 'pieces', 'pc', 'pcs', 'nos', 'no']);
export const countsPieces = (unit: string | null | undefined, foodName: string) => {
  if (!unit) return true;
  const u = unit.toLowerCase().replace(/s$/, '');
  return PIECE_UNITS.has(unit.toLowerCase()) || foodName.toLowerCase().split(/[^a-z]+/).some((w) => w === u || w.replace(/s$/, '') === u);
};

/**
 * Why a resolved weight can't be `count` pieces of this food, or null when it can (or the food isn't a piece food):
 * the weight of one piece is outside the food's believable range.
 */
export function implausiblePiece(foodName: string, count: number, grams: number): string | null {
  const range = pieceRange(foodName);
  if (!range || !(count > 0)) return null;
  const each = grams / count;
  if (each >= range.low && each <= range.high) return null;
  return `the catalog's only weight for "${foodName}" is ${Math.round(each)} g a piece, not believable for one piece (${range.low}-${range.high} g); give the weight in grams`;
}
