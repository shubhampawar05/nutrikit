// Types and pure helpers for the homepage live demo.

export interface DemoNutrient { amount: number; unit?: string; dailyValuePercent?: number | null }
export type Totals = Partial<Record<string, DemoNutrient>>;

export interface DemoItem {
  input: string;
  food: { id?: number | string; name: string };
  quantity: number;
  unit: string;
  grams: number;
  portionBasis?: string | null;
  nutrients: Totals;
}

export interface DemoResult {
  items: DemoItem[];
  unmatched: { text: string }[];
  totals: Totals;
}

type Round = (v: number) => number;

// FDA-style rounding for the label (simplified 21 CFR 101.9 rules).
export const r: Record<'kcal' | 'g' | 'mg' | 'mcg', Round> = {
  kcal: (v) => (v < 5 ? 0 : v <= 50 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10),
  g: (v) => (v < 0.5 ? 0 : v < 5 ? Math.round(v * 2) / 2 : Math.round(v)),
  mg: (v) => (v < 5 ? 0 : v <= 140 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10),
  mcg: (v) => Math.round(v * 10) / 10,
};

export interface LabelRow {
  key: string;
  label: string;
  unit: string;
  round: Round;
  sub?: boolean;
  thick?: boolean;
  bold?: boolean;
  noDv?: boolean;
}

export const CALORIES: LabelRow = { key: 'calories', label: 'Calories', unit: '', round: r.kcal };

export const ROWS: LabelRow[] = [
  { key: 'fat', label: 'Total Fat', unit: 'g', round: r.g },
  { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g', round: r.g, sub: true, bold: false },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', round: r.mg },
  { key: 'sodium', label: 'Sodium', unit: 'mg', round: r.mg },
  { key: 'carbs', label: 'Total Carbohydrate', unit: 'g', round: r.g },
  { key: 'fiber', label: 'Dietary Fiber', unit: 'g', round: r.g, sub: true, bold: false },
  { key: 'sugar', label: 'Total Sugars', unit: 'g', round: r.g, sub: true, bold: false, noDv: true },
  { key: 'protein', label: 'Protein', unit: 'g', round: r.g, thick: true },
  { key: 'vitaminD', label: 'Vitamin D', unit: 'mcg', round: r.mcg, bold: false },
  { key: 'calcium', label: 'Calcium', unit: 'mg', round: r.mg, bold: false },
  { key: 'iron', label: 'Iron', unit: 'mg', round: r.mcg, bold: false },
  { key: 'potassium', label: 'Potassium', unit: 'mg', round: r.mg, bold: false },
];

/** The label text for one nutrient, e.g. "8g". */
export function valueText(totals: Totals, row: LabelRow): string {
  const n = totals[row.key];
  return `${n ? row.round(n.amount) : 0}${row.unit}`;
}

/** Text of every label line, keyed by nutrient, used to spot values that changed. */
export function labelTexts(totals: Totals): Record<string, string> {
  return Object.fromEntries([CALORIES, ...ROWS].map((row) => [row.key, valueText(totals, row)]));
}

// Decorative EAN-13 bars for 3017624010701, drawn from its real encoding.
function ean13Bits(code: string): string {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map((c) => [...c].map((b) => (b === '0' ? '1' : '0')).reverse().join(''));
  const R = L.map((c) => [...c].map((b) => (b === '0' ? '1' : '0')).join(''));
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const digits = code.split('').map(Number);
  const parity = PARITY[digits[0]];
  let bits = '101';
  digits.slice(1, 7).forEach((d, i) => (bits += (parity[i] === 'L' ? L : G)[d]));
  bits += '01010';
  digits.slice(7).forEach((d) => (bits += R[d]));
  bits += '101';
  return bits;
}

export const BARCODE_BITS = ean13Bits('3017624010701');
