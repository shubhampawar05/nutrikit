// UK CoFID 2021 (McCance and Widdowson's Composition of Foods Integrated Dataset, Public Health England):
// the dishes it lists, converted to the catalog's nutrient definitions. Crown copyright, Open Government
// Licence v3.0. Definitions follow the CoFID 2021 user guide; see openspec/changes/import-cofid-dishes/design.md.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const COFID_SOURCE = {
  name: "McCance and Widdowson's Composition of Foods Integrated Dataset 2021",
  publisher: 'Public Health England',
  url: 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid',
  file: 'McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx',
  sha256: '436e9445ef2adb2a75f3d7edd51302de3adad25385f9795fc94ba58bd030e97d',
  licence: 'Open Government Licence v3.0',
  attribution: 'Contains public sector information licensed under the Open Government Licence v3.0.',
};

// The groups CoFID names as dishes (user guide Appendix B, food sub-group codes).
export const DISH_GROUPS = {
  DR: 'Vegetable dishes', MR: 'Meat dishes', JR: 'Fish products and dishes',
  CD: 'Egg dishes', CDE: 'Savoury egg dishes', CDH: 'Sweet egg dishes',
};
export const COFID_ID_BASE = 800_000_000; // above every USDA FDC id

/** Fail unless the file is the pinned gov.uk workbook. */
export function verifyCofidFile(file) {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha !== COFID_SOURCE.sha256) {
    throw new Error(`${file}: SHA-256 ${sha} is not the pinned CoFID 2021 workbook (${COFID_SOURCE.sha256}); download it from ${COFID_SOURCE.url}`);
  }
}

/** CoFID food code ("15-146") -> catalog id (800,150,146). */
export function cofidId(code) {
  const m = /^(\d{1,2})-(\d{1,4})$/.exec(code);
  if (!m) throw new Error(`unexpected CoFID food code "${code}"`);
  return COFID_ID_BASE + Number(m[1]) * 10_000 + Number(m[2]);
}

/** A CoFID cell as a number: N (not determined) and blank are missing, Tr (trace) is 0. */
export function cofidNumber(cell) {
  const s = String(cell ?? '').trim();
  if (s === '' || s === 'N') return null;
  if (s === 'Tr') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`unexpected CoFID value "${s}"`);
  return n;
}

const SHEETS = { prox: '1.3 Proximates', inorg: '1.4 Inorganics', vit: '1.5 Vitamins', frac: '1.6 Vitamin Fractions' };

/**
 * Join the four nutrient sheets by food code.
 * @param {Record<string, string[][]>} sheets from readXlsx
 * @returns {{ code, name, description, group, cells: Record<string, string> }[]} every CoFID food, sheet order
 */
export function cofidFoods(sheets) {
  const byCode = new Map();
  for (const [part, title] of Object.entries(SHEETS)) {
    const rows = sheets[title];
    if (!rows) throw new Error(`CoFID workbook has no "${title}" sheet`);
    const header = rows[0];
    for (const row of rows) {
      if (!/^\d+-\d+$/.test(row[0] ?? '')) continue; // headers, acronym and description rows
      const food = byCode.get(row[0]) ?? { code: row[0], name: row[1].trim(), description: row[2] ?? '', group: row[3], cells: {} };
      header.forEach((h, i) => { if (i >= 7 && h) food.cells[`${part}:${h.trim()}`] = row[i] ?? ''; });
      byCode.set(row[0], food);
    }
  }
  return [...byCode.values()];
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Convert one CoFID food to catalog nutrients per 100 g, following design §3.
 * @returns {{ nutrients: Record<string, number>, carbsMethod: 'exact' | 'documented' | null }}
 */
export function convertCofid(food) {
  const get = (part, col) => {
    const key = `${part}:${col}`;
    if (!(key in food.cells)) throw new Error(`CoFID column "${col}" (${SHEETS[part]}) is missing; has the workbook layout changed?`);
    return cofidNumber(food.cells[key]);
  };
  const n = {};
  const put = (key, v) => { if (v != null) n[key] = r3(v); };

  // Published as is: definitions match the catalog's.
  for (const [key, part, col] of [
    ['calories', 'prox', 'Energy (kcal) (kcal)'], ['protein', 'prox', 'Protein (g)'], ['fat', 'prox', 'Fat (g)'],
    ['water', 'prox', 'Water (g)'], ['alcohol', 'prox', 'Alcohol (g)'],
    ['saturatedFat', 'prox', 'Satd FA /100g fd (g)'], ['monounsaturatedFat', 'prox', 'Mono FA /100g food (g)'],
    ['polyunsaturatedFat', 'prox', 'Poly FA /100g food (g)'], ['transFat', 'prox', 'Trans FAs /100g food (g)'],
    ['cholesterol', 'prox', 'Cholesterol (mg)'],
    ['sodium', 'inorg', 'Sodium (mg)'], ['potassium', 'inorg', 'Potassium (mg)'], ['calcium', 'inorg', 'Calcium (mg)'],
    ['magnesium', 'inorg', 'Magnesium (mg)'], ['phosphorus', 'inorg', 'Phosphorus (mg)'], ['iron', 'inorg', 'Iron (mg)'],
    ['zinc', 'inorg', 'Zinc (mg)'],
    ['vitaminK', 'vit', 'Vitamin K1 (µg)'], ['thiamin', 'vit', 'Thiamin (mg)'], ['riboflavin', 'vit', 'Riboflavin (mg)'],
    ['niacin', 'vit', 'Niacin (mg)'], ['vitaminB6', 'vit', 'Vitamin B6 (mg)'], ['vitaminB12', 'vit', 'Vitamin B12 (µg)'],
    ['vitaminC', 'vit', 'Vitamin C (mg)'],
  ]) put(key, get(part, col));

  // Sugars and carbohydrate: CoFID gives available carbohydrate as monosaccharide equivalents, without fibre.
  // Exact when every component is measured; otherwise the documented conversion from the published totals.
  const mono = ['Glucose (g)', 'Galactose (g)', 'Fructose (g)'].map((c) => get('prox', c));
  const di = ['Sucrose (g)', 'Maltose (g)', 'Lactose (g)'].map((c) => get('prox', c));
  const starch = get('prox', 'Starch (g)');
  const oligo = get('prox', 'Oligosaccharide (g)') ?? 0; // rarely reported; small where it is
  const totalSugars = get('prox', 'Total sugars (g)');
  const aoac = get('prox', 'AOAC fibre (g)');
  const nsp = get('prox', 'NSP (g)');
  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  const sugarsExact = [...mono, ...di].every((x) => x != null) ? sum(mono) + sum(di) / 1.05 : null;
  const sugars = sugarsExact ?? (totalSugars != null ? totalSugars / 1.05 : null);
  put('sugar', sugars);
  put('fiber', aoac); // AOAC only: NSP is a different method
  let carbsMethod = null;
  if (sugarsExact != null && starch != null && aoac != null) {
    put('carbs', sugarsExact + starch / 1.1 + oligo / 1.1 + aoac);
    carbsMethod = 'exact';
  } else if (totalSugars != null && starch != null && (aoac ?? nsp) != null) {
    put('carbs', totalSugars / 1.05 + starch / 1.1 + oligo / 1.1 + (aoac ?? nsp));
    carbsMethod = 'documented';
  }

  // Vitamin A as RAE: carotene is beta-carotene equivalents, so retinol + carotene / 12 is exact.
  const retinol = get('vit', 'Retinol (µg)');
  const carotene = get('vit', 'Carotene (µg)');
  if (retinol != null && carotene != null) put('vitaminA', retinol + carotene / 12);
  // Vitamin D: CoFID's total counts 25-hydroxy vitamin D3, which the catalog's (USDA) definition does not.
  const cholecalciferol = get('frac', 'Cholecalciferol (µg)');
  const vitD = get('vit', 'Vitamin D (µg)');
  put('vitaminD', cholecalciferol ?? (vitD === 0 ? 0 : null));
  // Vitamin E: CoFID's total is alpha-tocopherol equivalents; the catalog's is alpha-tocopherol.
  put('vitaminE', get('frac', 'Alpha-tocopherol (mg)'));
  // Folate stays absent: CoFID's total food folate has no folic acid split, so folate DFE can't be derived.
  return { nutrients: n, carbsMethod };
}

/**
 * Validate the reviewed alias list (data/aliases/cofid.json) against the workbook's dishes.
 * Each entry: { alias, cofidCode, cofidName, reference } — the reference is a public https URL for the name.
 * @returns {Map<string, string[]>} CoFID food code -> its aliases (lowercase)
 * @throws Error naming the entry when an alias is unreferenced, unknown, renamed or used twice
 */
export function cofidAliases(entries, dishes) {
  const byCode = new Map(dishes.map((d) => [d.code, d]));
  const out = new Map();
  const seen = new Set();
  for (const e of entries) {
    const label = `CoFID alias "${e.alias}"`;
    const alias = String(e.alias ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z '-]*$/.test(alias)) throw new Error(`${label}: aliases are plain lowercase words`);
    if (!/^https:\/\/\S+$/.test(e.reference ?? '')) throw new Error(`${label}: a public https reference is required`);
    const dish = byCode.get(e.cofidCode);
    if (!dish) throw new Error(`${label}: ${e.cofidCode} is not a CoFID dish`);
    if (dish.name !== e.cofidName) throw new Error(`${label}: ${e.cofidCode} is "${dish.name}" in the workbook, not "${e.cofidName}"`);
    if (seen.has(alias)) throw new Error(`${label}: used for more than one food`);
    seen.add(alias);
    out.set(e.cofidCode, [...(out.get(e.cofidCode) ?? []), alias]);
  }
  return out;
}
