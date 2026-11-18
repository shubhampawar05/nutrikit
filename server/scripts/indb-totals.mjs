// Indian Nutrient Databank dish totals from INDB.xlsx (per 100 g as published). When this file is present at build
// time, the catalog uses these values instead of composing the same dishes from USDA proxies (indb.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { readXlsx } from './xlsx.mjs';
import { INDB_SOURCE, indbDisplayAliases } from './indb.mjs';

export const INDB_ID_BASE = 850_000_000;

/**
 * Ids for codes whose hash clashes with an earlier code's: code -> a free id in [INDB_ID_BASE, INDB_ID_BASE + 49M).
 * Only ever add entries; the clashing earlier food keeps its id.
 */
const ID_OVERRIDES = {};

/** A stable id from the INDB food code. Hashed into a 49M range, so indbTotalFoods() fails the build on a clash. */
export function indbFoodId(code) {
  if (Object.hasOwn(ID_OVERRIDES, code)) return ID_OVERRIDES[code];
  let h = 0;
  for (const c of String(code)) h = Math.imul(31, h) + c.charCodeAt(0) | 0;
  return INDB_ID_BASE + (Math.abs(h) % 49_000_000);
}

const r3 = (x) => Math.round(x * 1000) / 1000;

function num(cell) {
  const n = Number(String(cell ?? '').replace(/^\.+/, '0.'));
  return Number.isFinite(n) ? n : null;
}

/** mg per 100 g → g per 100 g for fatty acids. */
const mgToG = (v) => (v == null ? null : r3(v / 1000));

/**
 * @param {Record<string, number|null>} cols keyed by INDB column name
 */
export function nutrientsFromIndbRow(cols) {
  const d2 = cols.vitd2_ug ?? 0;
  const d3 = cols.vitd3_ug ?? 0;
  const vitD = cols.vitd2_ug == null && cols.vitd3_ug == null ? null : r3(d2 + d3);
  const folate = cols.folate_ug ?? cols.vitb9_ug ?? null;
  const n = {
    calories: cols.energy_kcal == null ? null : r3(cols.energy_kcal),
    protein: cols.protein_g == null ? null : r3(cols.protein_g),
    fat: cols.fat_g == null ? null : r3(cols.fat_g),
    carbs: cols.carb_g == null ? null : r3(cols.carb_g),
    fiber: cols.fibre_g == null ? null : r3(cols.fibre_g),
    sugar: cols.freesugar_g == null ? null : r3(cols.freesugar_g),
    saturatedFat: mgToG(cols.sfa_mg),
    monounsaturatedFat: mgToG(cols.mufa_mg),
    polyunsaturatedFat: mgToG(cols.pufa_mg),
    cholesterol: cols.cholesterol_mg == null ? null : r3(cols.cholesterol_mg),
    sodium: cols.sodium_mg == null ? null : r3(cols.sodium_mg),
    potassium: cols.potassium_mg == null ? null : r3(cols.potassium_mg),
    calcium: cols.calcium_mg == null ? null : r3(cols.calcium_mg),
    iron: cols.iron_mg == null ? null : r3(cols.iron_mg),
    magnesium: cols.magnesium_mg == null ? null : r3(cols.magnesium_mg),
    phosphorus: cols.phosphorus_mg == null ? null : r3(cols.phosphorus_mg),
    zinc: cols.zinc_mg == null ? null : r3(cols.zinc_mg),
    vitaminA: cols.vita_ug == null ? null : r3(cols.vita_ug),
    vitaminC: cols.vitc_mg == null ? null : r3(cols.vitc_mg),
    vitaminD: vitD,
    vitaminE: cols.vite_mg == null ? null : r3(cols.vite_mg),
    vitaminK: cols.vitk1_ug == null ? null : r3(cols.vitk1_ug),
    folate: folate == null ? null : r3(folate),
    thiamin: cols.vitb1_mg == null ? null : r3(cols.vitb1_mg),
    riboflavin: cols.vitb2_mg == null ? null : r3(cols.vitb2_mg),
    niacin: cols.vitb3_mg == null ? null : r3(cols.vitb3_mg),
    vitaminB6: cols.vitb6_mg == null ? null : r3(cols.vitb6_mg),
  };
  const out = {};
  for (const [k, v] of Object.entries(n)) if (v != null) out[k] = v;
  return out;
}

// INDB's serving names ("tall glass", "small bowl", "idli") become the portion label, so "1 glass lemonade" or
// "2 idli" match the dish's own published serving. A name is kept only when its weight is believable for it: a
// cup or spoon also tells the portion engine the dish's density, so a wrong one would skew every volume. Anything
// else, and servings with no real name ("ml", "gm", blank), stay "1 serving" as before.
const UNNAMED = new Set(['', 'ml', 'gm', 'g', 'small', 'portion', 'serving']);
/**
 * [pattern on the INDB name, portion unit, lowest and highest believable grams for one]. A typed "cup" or "glass"
 * means a standard 236.6 ml everywhere in the API, and INDB's cups and glasses are its own vessel sizes (a "glass"
 * is about 340 g), so those keep their name only as the dish's default serving (unit `serving`), never as the size
 * of a typed cup or glass.
 */
const VESSELS = [
  [/^(tea )?cup$/, 'serving', 100, 300],
  [/^tablespoon$/, 'tbsp', 5, 25],
  [/^teaspoon$/, 'tsp', 2, 8],
  [/(^|\s)glass$/, 'serving', 150, 450],
  [/(^|\s)bowl$/, 'bowl', 80, 600],
  [/(^|\s)plate$/, 'plate', 80, 700],
];
const singular = (w) => (/[^s]s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w);

/**
 * The portion for one INDB serving: `{ label, unit, flagged }`. `flagged` names a serving whose weight is not
 * believable for its name; it is listed at build time for review and stays "1 serving".
 * @param {string} name INDB servings_unit
 * @param {number} grams one serving, from the published per-serving and per-100 g energy
 */
export function indbServing(name, grams) {
  const unitName = String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (UNNAMED.has(unitName)) return { label: '1 serving', unit: 'serving', flagged: null };
  const vessel = VESSELS.find(([pattern]) => pattern.test(unitName));
  if (vessel) {
    const [, unit, low, high] = vessel;
    if (grams < low || grams > high) return { label: '1 serving', unit: 'serving', flagged: `1 ${unitName} = ${grams} g (expected ${low}-${high} g)` };
    return { label: `1 ${unitName}`, unit, flagged: null };
  }
  // A piece of something ("idli", "large slice", "kaathi roll"): its last word is the unit, so "2 idli" or
  // "1 slice" finds it.
  if (grams < 5) return { label: '1 serving', unit: 'serving', flagged: `1 ${unitName} = ${grams} g (under 5 g)` };
  return { label: `1 ${unitName}`, unit: singular(unitName.split(' ').at(-1)), flagged: null };
}

/**
 * @param {string} dir INDB clone directory (contains INDB.xlsx)
 * @returns {Array<{ id, name, source: 'indb', category, n, portions, aliases, code }>}
 */
export function indbTotalFoods(dir) {
  const xlsx = path.join(dir, 'INDB.xlsx');
  if (!fs.existsSync(xlsx)) return [];
  const rows = readXlsx(xlsx)['Nutrient Data'];
  if (!rows?.length) return [];
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const out = [];
  const flagged = [];
  const codeById = new Map();
  for (const row of rows.slice(1)) {
    const code = String(row[col('food_code')] ?? '').trim();
    const name = String(row[col('food_name')] ?? '').trim();
    if (!code || !name) continue;
    const cols = Object.fromEntries(
      ['energy_kcal', 'protein_g', 'fat_g', 'carb_g', 'fibre_g', 'freesugar_g', 'sfa_mg', 'mufa_mg', 'pufa_mg',
        'cholesterol_mg', 'sodium_mg', 'potassium_mg', 'calcium_mg', 'iron_mg', 'magnesium_mg', 'phosphorus_mg',
        'zinc_mg', 'vita_ug', 'vite_mg', 'vitd2_ug', 'vitd3_ug', 'vitk1_ug', 'folate_ug', 'vitb1_mg', 'vitb2_mg',
        'vitb3_mg', 'vitb6_mg', 'vitb9_ug', 'vitc_mg', 'unit_serving_energy_kcal'].map((k) => [k, num(row[col(k)])]),
    );
    const n = nutrientsFromIndbRow(cols);
    if (n.calories == null) continue;
    const per100 = cols.energy_kcal;
    const perServ = cols.unit_serving_energy_kcal;
    let grams = 200;
    if (per100 > 0 && perServ > 0) grams = Math.max(20, Math.round((100 * perServ) / per100));
    // servings_unit is text ("tall glass"); it is read from the row, not through num().
    const serving = indbServing(row[col('servings_unit')], grams);
    if (serving.flagged) flagged.push(`${name}: ${serving.flagged}`);
    const id = indbFoodId(code);
    const clash = codeById.get(id);
    if (clash != null) {
      // Ids are stored in users' logs, so an existing food's id never changes: resolve a clash by hand.
      throw new Error(clash === code
        ? `INDB.xlsx lists food code ${code} twice`
        : `INDB food codes ${clash} and ${code} hash to the same catalog id ${id}; add ${code} to ID_OVERRIDES in indb-totals.mjs`);
    }
    codeById.set(id, code);
    out.push({
      id,
      code,
      name,
      source: 'indb',
      category: 'Indian dishes',
      n,
      portions: [{
        seq: 1,
        label: serving.label,
        amount: 1,
        unit: serving.unit,
        grams,
      }],
      aliases: indbDisplayAliases(name),
    });
  }
  if (flagged.length) {
    console.warn(`INDB: ${flagged.length} servings kept as "1 serving" because their weight is not believable for their name:`);
    for (const f of flagged) console.warn(`  ${f}`);
  }
  return out;
}

export const INDB_TOTALS_SOURCE = {
  ...INDB_SOURCE,
  file: 'INDB.xlsx',
  mode: 'published_totals_per_100g',
};
