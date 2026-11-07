// Personal data pack: the dishes of the Indian Nutrient Databank (INDB), recomputed from their ingredient lists.
//
// INDB has no licence, so these foods are built only into data/foods.personal.db (npm run build:db -- --personal),
// never into the committed catalog. INDB's own nutrient values are not used: they come from IFCT 2017 (not
// distributed) and ignore cooking water for many dishes. Each ingredient is mapped to a catalog food
// (data/indb/ingredients.json, reviewed by hand) and the dish is composed with scripts/recipes.mjs.
import path from 'node:path';
import { readXlsx } from './xlsx.mjs';
import { composeRecipe } from './recipes.mjs';
import { resolvePortion } from '../src/domain/units.ts';

export const INDB_SOURCE = {
  name: 'Indian Nutrient Databank (INDB)',
  url: 'https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-',
  commit: 'fbdb62bec519c6e2468582a799fb47e194b42558',
  license: 'None: personal use only, permission pending',
};
export const INDB_ID_BASE = 910_000_000; // within the recipe range, above CoFID and every USDA id
const BOOKS = { ASC: 1, BFP: 2, OSR: 3 }; // Art & Science of Cooking, Basic Food Preparation, open-source recipes
// From INDB's Units.xlsx: a cup is 240 ml; a pinch is a quarter teaspoon; a sprig is defined by weight only for mint
// (6-8 leaves of 0.5 g). Other herbs' sprigs have fewer or lighter leaves, so this is an upper bound: herb sprigs add
// their nutrients but never decide whether a dish has a nutrient (they are marked minor).
const CUP_ML = 240;
const SPRIG_G = 3.5;
const MINOR_SHARE = 0.02; // an unmapped ingredient below this share of the dish is counted as weight only

/** INDB recipe code ("ASC165") -> catalog id (910,010,165). */
export function indbId(code) {
  const m = /^(ASC|BFP|OSR)(\d{1,4})$/.exec(code);
  if (!m) throw new Error(`unexpected INDB recipe code "${code}"`);
  return INDB_ID_BASE + BOOKS[m[1]] * 10_000 + Number(m[2]);
}

const rowsOf = (file) => {
  const [rows] = Object.values(readXlsx(file));
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
};

/** Read INDB's recipes and serving sizes from its raw folder: one entry per dish, ingredient lines in order. */
export function readIndb(dir) {
  const dishes = new Map();
  for (const r of rowsOf(path.join(dir, 'recipes.xlsx'))) {
    const d = dishes.get(r.recipe_code) ?? { code: r.recipe_code, name: r.recipe_name.trim(), lines: [] };
    d.lines.push({
      code: r.food_code, name: r.food_name, amount: Number(r.amount), unit: r.unit.trim(),
      original: `${r.ingredient_name_org} ${r.amount_org} ${r.unit_org}`.trim(), // as printed in the source recipe
    });
    dishes.set(r.recipe_code, d);
  }
  for (const s of rowsOf(path.join(dir, 'recipes_servingsize.xlsx'))) {
    const d = dishes.get(s.recipe_code);
    // A serving can be several pieces ("1 serving = 3 parantha"), so a piece is the dish / (servings x size).
    if (d) d.servings = { count: Number(s.no_of_servings) || null, size: Number(s.size_of_servings) || 1, unit: s.servings_unit.trim() || 'serving' };
  }
  return [...dishes.values()];
}

/** The mapping entry for an ingredient line: by code and name, then by name alone (INDB reuses some codes). */
export function mappingIndex(entries) {
  const byKey = new Map(entries.map((e) => [`${e.indbCode}\t${e.indbName}`, e]));
  return (line) => byKey.get(`${line.code}\t${line.name}`);
}

/**
 * Grams of one ingredient line. Weights are as listed; volumes go through the mapped food's own household
 * portions (resolvePortion), water and no-nutrient items at 1 g/ml.
 * @returns {number|null} null when the unit can't be converted
 */
export function lineGrams(line, food) {
  const { amount, unit } = line;
  if (!(amount > 0)) return null;
  const ml = unit === 'ml' ? amount : unit === 'C' ? amount * CUP_ML : unit === 'tbsp' ? amount * 15 : unit === 'tsp' ? amount * 5 : unit === 'pinch' ? 1.25 : null;
  if (unit === 'g') return amount;
  if (unit === 'sprig') return amount * SPRIG_G;
  if (ml == null) return null;
  if (!food) return ml; // water and no-nutrient items
  // tsp/tbsp use the food's own spoon portion where it has one; ml and cups go through its cup weight.
  if (unit === 'tsp' || unit === 'tbsp') return resolvePortion(food, amount, unit).grams;
  return resolvePortion(food, ml, 'ml').grams;
}

const servingUnit = (unit) => unit.split(/\s+/).at(-1).toLowerCase();

// Deep frying: the recipe lists the whole pan of oil, of which the food absorbs an unknown share. INDB's own
// values count all of it (poori 738 kcal per 100 g). With no verified absorption figure such dishes are skipped;
// a few tablespoons "for frying" (sauteing) stay in the dish and are counted.
export function isDeepFrying(line, grams) {
  return /\bfry|frying/i.test(line.original ?? '') && (/\bdeep\b/i.test(line.original) || grams >= 100);
}

/**
 * Compose one INDB dish.
 * @param dish from readIndb
 * @param mapping (line) -> mapping entry
 * @param findFood (fdcId) -> catalog food { name, n, portions }
 * @param keys nutrient keys
 * @returns {{ food?: object, skipped?: string, hydrationGrams?: number }}
 */
export function composeIndbDish(dish, mapping, findFood, keys) {
  const ingredients = [];
  let water = 0, inert = 0, hydration = 0, unmapped = [];
  for (const line of dish.lines) {
    const m = mapping(line);
    if (!m) return { skipped: `ingredient "${line.name}" (${line.code}) is not in the mapping` };
    const food = m.kind === 'food' ? findFood(m.fdcId) : null;
    if (m.kind === 'food' && !food) return { skipped: `mapped food ${m.fdcId} (${m.food}) is not in the catalog` };
    const grams = lineGrams(line, food);
    if (grams == null) return { skipped: `"${line.amount} ${line.unit} ${line.name}" can't be converted to grams` };
    if (isDeepFrying(line, grams)) return { skipped: `deep-fried: the share of the ${Math.round(grams)} g of "${line.name}" absorbed is not known` };
    if (m.kind === 'water') { water += grams; continue; }
    if (m.kind !== 'food') { inert += grams; if (m.kind === 'unmapped') unmapped.push([line.name, grams]); continue; }
    ingredients.push({ fdcId: m.fdcId, food: m.food, grams, ...(line.unit === 'sprig' ? { minor: true } : {}) });
    // Dry pulses and grains absorb water as they cook: USDA's raw and cooked forms carry the same protein, so
    // the cooked weight is raw grams x protein(raw) / protein(cooked).
    if (m.cooked) {
      const cooked = findFood(m.cooked.fdcId);
      if (!cooked) return { skipped: `cooked form ${m.cooked.fdcId} (${m.cooked.food}) is not in the catalog` };
      hydration += grams * food.n.protein / cooked.n.protein - grams;
    }
  }
  const total = ingredients.reduce((s, i) => s + i.grams, 0) + inert;
  for (const [name, grams] of unmapped) {
    if (grams / total >= MINOR_SHARE) return { skipped: `unmapped ingredient "${name}" is ${Math.round((100 * grams) / total)}% of the dish` };
  }
  if (!ingredients.length) return { skipped: 'no mapped ingredients' };
  // Water listed in the recipe covers what the dry ingredients absorb; where it is less, the rest is added.
  const added = Math.max(water, hydration) + inert;
  const cookedGrams = ingredients.reduce((s, i) => s + i.grams, 0) + added;
  const { count, size = 1, unit } = dish.servings ?? {};
  // Without a serving size the dish still has its per-100 g values; amounts are then logged by weight or volume.
  const portions = count ? [{ label: `1 ${unit}`, amount: 1, unit: servingUnit(unit), grams: Math.round((cookedGrams / (count * size)) * 10) / 10 }] : [];
  try {
    const food = composeRecipe({
      file: `INDB ${dish.code}`, id: indbId(dish.code), name: dish.name, category: 'Indian Nutrient Databank recipes',
      source: { name: INDB_SOURCE.name, license: INDB_SOURCE.license, url: INDB_SOURCE.url },
      ingredients, water: added, cookedGrams, portions,
    }, findFood, keys);
    return { food, hydrationGrams: hydration };
  } catch (err) {
    return { skipped: err.message };
  }
}

/**
 * Validate the reviewed alias list for INDB dishes (data/aliases/indb.json), like the CoFID one:
 * { alias, indbCode, indbName, reference } with a public https reference for the name.
 * @returns {Map<string, string[]>} INDB recipe code -> its aliases
 */
export function indbAliases(entries, dishes) {
  const byCode = new Map(dishes.map((d) => [d.code, d]));
  const out = new Map();
  const seen = new Set();
  for (const e of entries) {
    const label = `INDB alias "${e.alias}"`;
    const alias = String(e.alias ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z '-]*$/.test(alias)) throw new Error(`${label}: aliases are plain lowercase words`);
    if (!/^https:\/\/\S+$/.test(e.reference ?? '')) throw new Error(`${label}: a public https reference is required`);
    const dish = byCode.get(e.indbCode);
    if (!dish) throw new Error(`${label}: ${e.indbCode} is not an INDB dish`);
    if (dish.name !== e.indbName) throw new Error(`${label}: ${e.indbCode} is "${dish.name}" in INDB, not "${e.indbName}"`);
    if (seen.has(alias)) throw new Error(`${label}: used for more than one food`);
    seen.add(alias);
    out.set(e.indbCode, [...(out.get(e.indbCode) ?? []), alias]);
  }
  return out;
}
