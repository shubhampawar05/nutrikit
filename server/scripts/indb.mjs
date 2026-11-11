// Indian Nutrient Databank (INDB): turn its ingredient lists into catalog recipes composed from USDA foods.
// Values are never copied from INDB.xlsx — only ingredient weights and names, via scripts/recipes.mjs.
// See data/indb/README.md for licensing before public redistribution.
import fs from 'node:fs';
import path from 'node:path';
import { readXlsx } from './xlsx.mjs';
import { RECIPE_ID_MIN } from './recipes.mjs';

export const INDB_SOURCE = {
  name: 'Indian Nutrient Databank (INDB)',
  publisher: 'Anuvaad Solutions / Jaacks Lab',
  url: 'https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-',
  paper: 'https://doi.org/10.1016/j.cdnut.2024.103790',
  licence: 'INDB files on GitHub carry no SPDX licence; confirm redistribution with awasthi@anuvaad.org.in before shipping a public product. Nutrients here are composed from USDA (CC0), not copied from INDB.',
};

const INDB_REPO_DIR = 'Indian-Nutrient-Databank-INDB--main';

/** Directory with recipes.xlsx (either a clone of the GitHub repo or data/raw/indb/). */
export function indbDataDir(rawRoot) {
  for (const rel of [`indb/${INDB_REPO_DIR}`, `indb`, `indb-repo/${INDB_REPO_DIR}`]) {
    const dir = path.join(rawRoot, rel);
    if (fs.existsSync(path.join(dir, 'recipes.xlsx'))) return dir;
  }
  return null;
}

function recipeId(code) {
  let h = 0;
  for (const c of String(code)) h = Math.imul(31, h) + c.charCodeAt(0) | 0;
  return RECIPE_ID_MIN + (Math.abs(h) % 89_000_000);
}

/** Heuristic grams from INDB amount + unit strings. */
export function amountToGrams(amount, unit, foodName) {
  const n = Number(String(amount ?? '').replace(/^\.+/, '0.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit ?? 'g').toLowerCase().trim();
  // INDB uses "C" for cup in beverage recipes (e.g. ASC001 hot tea).
  if (u === 'c') return n * 240;
  if (u === 'g' || u === 'gm' || u === 'gram' || u === 'grams') return n;
  if (u === 'ml' || u === 'millilitre' || u === 'milliliter') return n;
  if (u === 'l' || u === 'litre' || u === 'liter') return n * 1000;
  if (u === 'tsp' || u === 'teaspoon' || u === 'teaspoons') {
    if (/sugar|jaggery/i.test(foodName)) return n * 4;
    if (/oil|ghee|butter|cream/i.test(foodName)) return n * 5;
    return n * 2.5;
  }
  if (u === 'tbsp' || u === 'tablespoon' || u === 'tablespoons') {
    if (/oil|ghee|butter/i.test(foodName)) return n * 14;
    return n * 12;
  }
  if (u === 'cup' || u === 'cups') return n * 240;
  if (u === 'sprig' || u === 'pinch' || u === 'sprinkle') return n * 0.5;
  if (u === 'nos' || u === 'no' || u === 'number') {
    if (/egg/i.test(foodName)) return n * 50;
    if (/reetha|soap\s*nut/i.test(foodName)) return n * 3;
    return n * 20;
  }
  if (u === 'sheet' || u === 'sheets') return n * 35;
  if (u === 'drops' || u === 'drop') return n * 0.05;
  // A few rows leave unit blank but mean grams or count.
  if (!u) return n;
  if (u.includes('ml')) return n;
  return null;
}

const MINOR = 0.02;

function cleanLabel(name) {
  return String(name ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchToken(name) {
  const c = cleanLabel(name).split(/[,/]/)[0].trim();
  const words = c.toLowerCase().split(/\s+/).filter(Boolean);
  return words.slice(0, Math.min(4, words.length)).join(' ');
}

/** IFCT labels that almost never match the catalog literally — map to a USDA search phrase. */
const INFER_SEARCH = [
  [/chilli powder|chili powder/i, 'chili powder'],
  [/cumin seeds?/i, 'cumin seed'],
  [/turmeric/i, 'turmeric, ground'],
  [/coriander seeds?/i, 'coriander seed'],
  [/mustard seeds?|mustard powder/i, 'mustard seed'],
  [/fennel seeds?/i, 'fennel seed'],
  [/fenugreek seeds?/i, 'fenugreek seed'],
  [/poppy seeds?/i, 'poppy seed'],
  [/curry leaves?/i, 'curry powder'],
  [/chillies?, red/i, 'hot chili, red'],
  [/ground nut|peanut/i, 'peanuts, nfs'],
  [/green gram/i, 'mung beans, mature seeds, cooked'],
  [/french beans/i, 'beans, snap, green, raw'],
  [/button mushroom/i, 'mushrooms, white'],
  [/spring onions?/i, 'onions, spring'],
  [/bicarbonate of soda|baking soda/i, 'baking soda'],
  [/mint leaves?/i, 'spearmint, fresh'],
  [/brinjal|eggplant/i, 'eggplant, raw'],
  [/lentil dal/i, 'lentils, mature seeds, cooked'],
  [/gelatine|gelatin/i, 'gelatin desserts, dry mix'],
  [/gingelly|sesame seeds?/i, 'sesame seeds, whole'],
  [/citric acid/i, 'lemon juice'],
  [/water, distilled/i, 'water, tap'],
  [/stock cubes?, vegetable/i, 'bouillon cubes'],
  [/stock cubes?, chicken/i, 'chicken broth, bouillon'],
  [/pomfret/i, 'fish, pompano'],
  [/beansprouts?, mung/i, 'bean sprouts, cooked'],
  [/bottle gourd/i, 'zucchini, raw'],
  [/rajmah|kidney bean/i, 'beans, kidney, mature seeds, cooked'],
  [/rice puffed/i, 'rice, puffed'],
  [/mixed nuts/i, 'mixed nuts, nfs'],
  [/jaggery/i, 'molasses'],
  [/kewra/i, 'water, tap'],
  [/amchur|amhur|dry mango powder/i, 'tamarinds, raw'],
  [/himalayan black salt|black salt/i, 'salt, table'],
  [/ajwain/i, 'caraway seed'],
  [/asafoetida/i, 'onion powder'],
  [/capsicum, green/i, 'peppers, bell, green'],
  [/celery stalk/i, 'celery, raw'],
  [/colour|color/i, 'sugar, white'],
  [/ladies finger|okra/i, 'okra, raw'],
  [/sago/i, 'tapioca, pearl, dry'],
  [/bathua/i, 'mustard spinach'],
  [/jack\s*fruit/i, 'jackfruit, raw'],
  [/porridge oats|oats, unfortified/i, 'oats, raw'],
  [/breakfast cereal|crunchy clusters/i, 'corn flakes, ready-to-eat'],
  [/soya bean|soybean/i, 'soybeans, green, raw'],
  [/colocasia|arbi/i, 'taro, cooked'],
  [/lentil whole/i, 'lentils, raw'],
  [/maize,\s*dry|maize dry/i, 'corn flour'],
  [/mint sauce/i, 'vinegar, distilled'],
  [/bacon rashers?/i, 'bacon, cooked'],
  [/custard powder/i, 'custards, dry mix'],
  [/sultanas?/i, 'raisins, golden'],
  [/dried mango/i, 'tamarinds, raw'],
  [/roasted chickpeas|chickpeas.*roast/i, 'garbanzo beans, bengal gram), mature seeds, cooked'],
  [/strawberry jam/i, 'jams, strawberry'],
  [/tutti frutti/i, 'candied fruit'],
  [/essence/i, 'water, tap'],
  [/tiger prawns?|prawns?/i, 'shrimp, nfs'],
  [/jowar|sorghum vulgare/i, 'sorghum grain'],
  [/amaranth seed/i, 'amaranth grain, uncooked'],
  [/wheat flour,\s*refined/i, 'wheat flour, white, all-purpose'],
  [/whey,\s*acid/i, 'whey, acid, fluid'],
  [/reetha/i, 'water, tap'],
];

function inferCatalogHit(label, search) {
  const c = cleanLabel(label);
  for (const [re, q] of INFER_SEARCH) {
    if (re.test(c)) {
      const hit = search(q);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * @param {Map<string, { id, name, n }>} catalog lowercased exact name -> food
 * @param {Record<string, { fdcId, food }>} overrides from data/indb/ingredient-map.json
 * @param {(q: string) => { id: number, name: string } | undefined} search catalog search
 */
export function resolveIngredient(foodName, catalog, overrides, search) {
  const key = String(foodName ?? '').trim();
  for (const k of [key, cleanLabel(key)]) {
    if (overrides[k]) {
      const o = overrides[k];
      return { fdcId: o.fdcId, food: o.food };
    }
  }
  const token = searchToken(key);
  const exact = catalog.get(token.toLowerCase());
  if (exact) return { fdcId: exact.id, food: exact.name };
  const hit = search(token) ?? inferCatalogHit(key, search);
  if (hit) return { fdcId: hit.id, food: hit.name };
  return null;
}

/** After resolve, keep the catalog's exact name for composeRecipe. */
export function normalizeIngredients(ingredients, findFood) {
  return ingredients.map((ing) => {
    const f = findFood(ing.fdcId);
    if (!f) throw new Error(`ingredient ${ing.fdcId} missing from catalog`);
    return { ...ing, food: f.name };
  });
}

function sourceFor(code, primary, links) {
  const url = links.get(code)?.replace(/\s+/g, '').trim();
  if (url?.startsWith('http')) {
    return {
      name: `Open recipe (${code}) via INDB`,
      license: 'Ingredient amounts as listed in the cited recipe; nutrients composed from USDA FoodData Central (CC0)',
      url,
    };
  }
  const manual = primary === 'asc_manual'
    ? "The Art & Science of Cooking, 5th ed. (University of Delhi)"
    : primary === 'bfp_manual'
      ? 'Basic Food Preparation, 4th ed. (University of Delhi)'
      : 'Indian Nutrient Databank recipe corpus';
  return {
    name: manual,
    license: INDB_SOURCE.licence,
    url: INDB_SOURCE.paper,
  };
}

/**
 * Parse INDB workbooks into recipe payloads for composeRecipe.
 * @param {string} dir INDB data directory
 * @param {Map<string, { id, name, n }>} catalog foods by exact lower name
 * @param {Record<string, { fdcId, food }>} overrides
 * @param {(q: string) => { id: number, name: string } | undefined} search
 */
export function indbRecipes(dir, catalog, overrides, search) {
  const rows = readXlsx(path.join(dir, 'recipes.xlsx')).Sheet1;
  const servings = readXlsx(path.join(dir, 'recipes_servingsize.xlsx')).Sheet1;
  const linksRows = readXlsx(path.join(dir, 'recipe_links.xlsx'))[Object.keys(readXlsx(path.join(dir, 'recipe_links.xlsx')))[0]];
  const links = new Map();
  for (const row of linksRows.slice(1)) links.set(String(row[1]).trim(), String(row[2] ?? ''));
  const primaryByCode = new Map();
  for (const row of servings.slice(1)) primaryByCode.set(String(row[1]).trim(), row[4]);

  const byCode = new Map();
  for (const row of rows.slice(1)) {
    const code = row[1];
    if (!code) continue;
    (byCode.get(code) ?? byCode.set(code, { code, name: row[3], ingredients: [] }).get(code)).ingredients.push(row);
  }

  const out = [];
  const seenNames = new Set();
  for (const { code, name, ingredients } of byCode.values()) {
    const display = cleanLabel(name) || cleanLabel(ingredients[0]?.[2]);
    if (!display) continue;
    const lower = display.toLowerCase();
    if (seenNames.has(lower)) continue;
    seenNames.add(lower);

    const mapped = [];
    let raw = 0;
    let failed = false;
    for (const row of ingredients) {
      const foodName = row[10] || row[8];
      const grams = amountToGrams(row[11], row[12], foodName);
      if (grams == null) { failed = true; break; }
      const ing = resolveIngredient(foodName, catalog, overrides, search);
      if (!ing) {
        if (grams / Math.max(raw + grams, 1) > MINOR) failed = true;
        continue;
      }
      mapped.push({ fdcId: ing.fdcId, food: ing.food, grams });
      raw += grams;
    }
    if (failed || !mapped.length || raw < 20) continue;

    const cookedGrams = Math.round(raw * 0.94);
    out.push({
      file: `indb-${code}.json`,
      id: recipeId(code),
      name: display,
      category: 'Indian dishes',
      source: sourceFor(code, primaryByCode.get(code), links),
      ingredients: mapped,
      water: 0,
      cookedGrams,
      portions: [{ label: '1 cup', amount: 1, unit: 'cup', grams: 240 }],
      aliases: indbDisplayAliases(display),
    });
  }
  return out;
}

/** Common English / Hindi fragments from INDB names → extra searchable tokens. */
export function indbDisplayAliases(display) {
  const aliases = [];
  const paren = /\(([^)]+)\)/.exec(display);
  if (paren) {
    for (const part of paren[1].split(/[/,]/)) {
      const a = part.trim().toLowerCase();
      if (a.length >= 3 && a !== display.toLowerCase()) aliases.push(a);
    }
  }
  if (/butter chicken/i.test(display)) aliases.push('butter chicken', 'murgh makhani');
  if (/pav bhaji/i.test(display)) aliases.push('pav bhaji', 'pav bhaji');
  if (/poha/i.test(display) && !/cutlet/i.test(display)) aliases.push('poha');
  if (/lassi/i.test(display) && /salt/i.test(display)) aliases.push('lassi', 'chaas', 'buttermilk lassi');
  if (/lassi/i.test(display) && /sweet|meethi/i.test(display)) aliases.push('lassi', 'sweet lassi');
  if (/gulab jamun/i.test(display)) aliases.push('gulab jamun');
  if (/kheer/i.test(display)) aliases.push('kheer');
  if (/jalebi/i.test(display)) aliases.push('jalebi');
  if (/dhokla/i.test(display)) aliases.push('dhokla');
  if (/halwa/i.test(display)) aliases.push('halwa');
  if (/parantha|paratha/i.test(display) && /potato|aloo/i.test(display)) aliases.push('aloo paratha');
  if (/tikka masala/i.test(display)) aliases.push('chicken tikka masala');
  return [...new Set(aliases)];
}
