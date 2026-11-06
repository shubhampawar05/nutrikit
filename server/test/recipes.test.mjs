// Recipe composition (scripts/recipes.mjs): the arithmetic, and every check that makes the catalog build fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeRecipe } from '../scripts/recipes.mjs';

const KEYS = ['calories', 'protein', 'fat', 'carbs', 'vitaminD', 'sodium'];
const CATALOG = new Map([
  [1, { name: 'Beans, boiled', n: { calories: 120, protein: 8, fat: 0.5, carbs: 21, vitaminD: 0, sodium: 2 } }],
  [2, { name: 'Oil', n: { calories: 884, protein: 0, fat: 100, carbs: 0, sodium: 0 } }], // no vitamin D value
  [3, { name: 'Salt', n: { calories: 0, protein: 0, fat: 0, carbs: 0, sodium: 38758 } }],
]);
const find = (id) => CATALOG.get(id);
const recipe = (over = {}) => ({
  file: 'test.json', id: 900_000_001, name: 'Bean stew',
  ingredients: [{ fdcId: 1, food: 'Beans, boiled', grams: 400 }, { fdcId: 3, food: 'Salt', grams: 4 }],
  water: 200, cookedGrams: 500, portions: [{ label: '1 cup', amount: 1, unit: 'cup', grams: 240 }],
  ...over,
});

test('nutrients are the ingredient sum scaled to the cooked weight', () => {
  const r = composeRecipe(recipe(), find, KEYS);
  assert.equal(r.nutrients.calories, (120 * 4) / 500 * 100); // 96 per 100 g
  assert.equal(r.nutrients.sodium, Math.round(((2 * 4 + 38758 * 0.04) / 500) * 100 * 1000) / 1000);
  assert.deepEqual(r.portions, [{ seq: 1, label: '1 cup', amount: 1, unit: 'cup', grams: 240 }]);
});

test('a nutrient a major ingredient lacks is left out rather than understated', () => {
  const withOil = recipe({ ingredients: [{ fdcId: 1, food: 'Beans, boiled', grams: 400 }, { fdcId: 2, food: 'Oil', grams: 20 }], cookedGrams: 550 });
  assert.equal(composeRecipe(withOil, find, KEYS).nutrients.vitaminD, undefined, 'oil (5% of the dish) has no vitamin D value');
  const pinch = recipe({ ingredients: [{ fdcId: 1, food: 'Beans, boiled', grams: 400 }, { fdcId: 2, food: 'Oil', grams: 4 }], cookedGrams: 500 });
  assert.equal(composeRecipe(pinch, find, KEYS).nutrients.vitaminD, 0, 'an ingredient under 2% of the dish does not decide it');
});

test('the build fails on an unknown ingredient or a renamed one', () => {
  assert.throws(() => composeRecipe(recipe({ ingredients: [{ fdcId: 99, food: 'Ghost', grams: 10 }] }), find, KEYS), /test\.json: ingredient 99 \(Ghost\) is not in the catalog/);
  assert.throws(() => composeRecipe(recipe({ ingredients: [{ fdcId: 1, food: 'Beans, canned', grams: 400 }] }), find, KEYS), /is "Beans, boiled" in the catalog, not "Beans, canned"/);
});

test('the build fails on an impossible yield, a bad id or missing parts', () => {
  assert.throws(() => composeRecipe(recipe({ cookedGrams: 700 }), find, KEYS), /cookedGrams 700/, 'cooking cannot add weight');
  assert.throws(() => composeRecipe(recipe({ cookedGrams: 200 }), find, KEYS), /cookedGrams 200/, 'losing over half is a typo');
  assert.throws(() => composeRecipe(recipe({ id: 12345 }), find, KEYS), /id must be/);
  assert.throws(() => composeRecipe(recipe({ portions: [] }), find, KEYS), /portions are required/);
  assert.throws(() => composeRecipe(recipe({ ingredients: [] }), find, KEYS), /ingredients are required/);
});

test('the build fails when calories disagree with protein, carbs and fat', () => {
  const odd = new Map(CATALOG).set(4, { name: 'Odd', n: { calories: 500, protein: 1, fat: 1, carbs: 1 } });
  assert.throws(() => composeRecipe(recipe({ ingredients: [{ fdcId: 4, food: 'Odd', grams: 400 }] }), (id) => odd.get(id), KEYS), /disagree/);
});
