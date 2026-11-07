// Dishes the USDA datasets lack, composed from USDA catalog foods (data/recipes/*.json; none are shipped yet).
//
// Every recipe must come from a verifiable, licensed source that it names (`source.name`, `source.license`,
// `source.url`); the build refuses one that doesn't, so no unsourced or hand-estimated dish enters the catalog.
//
// A recipe lists catalog foods by FDC id and name with their weights in grams, the water added, and the cooked
// weight of the dish. Its nutrients per 100 g are the sum over its ingredients scaled to that cooked weight, so
// water absorbed or cooked off changes the concentration but never adds or removes nutrients. Ingredients are
// taken in the form the dish uses them (boiled beans, cooked rice), so USDA's own values already carry the
// cooking losses of that form.
import fs from 'node:fs';
import path from 'node:path';

export const RECIPE_ID_MIN = 900_000_000; // far above any USDA FDC id
// An ingredient this small a share of the dish (spices, salt) does not decide whether the dish has a nutrient.
const MINOR_SHARE = 0.02;

/** Read every recipe file in a directory, sorted by file name. */
export function loadRecipes(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

/**
 * Compose one recipe into a catalog food.
 * @param recipe parsed recipe file
 * @param findFood (fdcId) => { name, n } | undefined, where n is the food's per-100 g nutrients
 * @param keys nutrient keys, in catalog order
 * @returns {{ id, name, category, nutrients, portions }}
 * @throws Error naming the recipe file when the recipe is invalid or its values fail the sanity checks
 */
export function composeRecipe(recipe, findFood, keys) {
  const fail = (msg) => { throw new Error(`recipe ${recipe.file || recipe.name}: ${msg}`); };
  if (!Number.isInteger(recipe.id) || recipe.id < RECIPE_ID_MIN) fail(`id must be an integer >= ${RECIPE_ID_MIN}`);
  if (!recipe.name?.trim()) fail('name is required');
  const { source } = recipe;
  if (!source?.name?.trim() || !source?.license?.trim() || !source?.url?.trim()) fail('source.name, source.license and source.url are required');
  if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) fail('ingredients are required');
  if (!Array.isArray(recipe.portions)) fail('portions must be a list (it may be empty: amounts are then logged by weight)');

  const ingredients = recipe.ingredients.map((ing) => {
    const food = findFood(ing.fdcId);
    if (!food) fail(`ingredient ${ing.fdcId} (${ing.food}) is not in the catalog`);
    if (food.name !== ing.food) fail(`ingredient ${ing.fdcId} is "${food.name}" in the catalog, not "${ing.food}"`);
    if (!(ing.grams > 0)) fail(`ingredient ${ing.fdcId} needs grams > 0`);
    return { ...ing, n: food.n };
  });
  const rawGrams = ingredients.reduce((s, i) => s + i.grams, 0);
  const water = recipe.water ?? 0;
  if (!(water >= 0)) fail('water must be >= 0');
  // Cooking can only lose weight (steam), and a dish that loses more than half is almost certainly a typo.
  if (!(recipe.cookedGrams > 0) || recipe.cookedGrams > rawGrams + water || recipe.cookedGrams < (rawGrams + water) / 2) {
    fail(`cookedGrams ${recipe.cookedGrams} must be between half and all of the ${rawGrams + water} g that goes in`);
  }

  // A nutrient is reported only when every ingredient that matters to the dish has a value for it; otherwise the
  // sum would silently understate it, so it is left out and reads as missing.
  // An ingredient marked minor (herb sprigs, whose weight is only an upper-bound estimate) never decides it either.
  const major = ingredients.filter((i) => i.grams / rawGrams >= MINOR_SHARE && !i.minor);
  const nutrients = {};
  for (const key of keys) {
    if (!major.every((i) => i.n[key] != null)) continue;
    const total = ingredients.reduce((s, i) => s + ((i.n[key] ?? 0) * i.grams) / 100, 0);
    nutrients[key] = Math.round((total / recipe.cookedGrams) * 100 * 1000) / 1000;
  }
  if (nutrients.calories == null) fail('calories could not be composed');
  const atwater = 4 * (nutrients.protein ?? 0) + 4 * (nutrients.carbs ?? 0) + 9 * (nutrients.fat ?? 0) + 7 * (nutrients.alcohol ?? 0);
  if (Math.abs(atwater - nutrients.calories) > Math.max(30, 0.25 * nutrients.calories)) {
    fail(`calories ${nutrients.calories} per 100 g disagree with protein, carbs and fat (${atwater.toFixed(0)})`);
  }

  const portions = recipe.portions.map((p, i) => {
    if (!p.label || !(p.grams > 0)) fail(`portion ${i + 1} needs a label and grams > 0`);
    return { seq: i + 1, label: p.label, amount: p.amount ?? 1, unit: p.unit ?? null, grams: p.grams };
  });
  return { id: recipe.id, name: recipe.name.trim(), category: recipe.category ?? null, source, nutrients, portions };
}
