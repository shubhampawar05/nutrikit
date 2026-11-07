// The personal INDB pack (scripts/indb.mjs): units, cooking water, frying, servings and aliases, on small fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeIndbDish, indbAliases, indbId, isDeepFrying, lineGrams, mappingIndex } from '../scripts/indb.mjs';

const KEYS = ['calories', 'protein', 'fat', 'carbs'];
const FOODS = new Map([
  [1, { name: 'Lentils, raw', n: { calories: 352, protein: 24.6, fat: 1.1, carbs: 63.4 }, portions: [] }],
  [2, { name: 'Lentils, cooked', n: { calories: 116, protein: 9.02, fat: 0.38, carbs: 20.1 }, portions: [] }],
  [3, { name: 'Oil', n: { calories: 884, protein: 0, fat: 100, carbs: 0 }, portions: [{ label: '1 tbsp', amount: 1, unit: 'tbsp', grams: 13.6 }, { label: '1 cup', amount: 1, unit: 'cup', grams: 218 }] }],
  [4, { name: 'Salt', n: { calories: 0, protein: 0, fat: 0, carbs: 0 }, portions: [{ label: '1 tsp', amount: 1, unit: 'tsp', grams: 6 }] }],
]);
const MAPPING = [
  { indbCode: 'B013', indbName: 'Lentil dal', kind: 'food', fdcId: 1, food: 'Lentils, raw', cooked: { fdcId: 2, food: 'Lentils, cooked' } },
  { indbCode: 'T508', indbName: 'Oil, sunflower', kind: 'food', fdcId: 3, food: 'Oil' },
  { indbCode: 'G528', indbName: 'Salt', kind: 'food', fdcId: 4, food: 'Salt' },
  { indbCode: 'K505', indbName: 'Water, distilled', kind: 'water' },
  { indbCode: '', indbName: 'Kewra essence', kind: 'negligible' },
  { indbCode: 'G010', indbName: 'Curry leaves', kind: 'unmapped' },
];
const dish = (lines, servings = { count: 2, size: 1, unit: 'bowl' }) => ({
  code: 'ASC165', name: 'Lentil curry (Masoor dal)', servings,
  lines: lines.map(([amount, unit, code, name, original = '']) => ({ amount, unit, code, name, original })),
});
const compose = (d) => composeIndbDish(d, mappingIndex(MAPPING), (id) => FOODS.get(id), KEYS);

test('ids come from the recipe code, above CoFID and USDA ids', () => {
  assert.equal(indbId('ASC165'), 910_010_165);
  assert.equal(indbId('OSR012'), 910_030_012);
  assert.throws(() => indbId('XYZ1'), /unexpected INDB recipe code/);
});

test('units: grams as listed, INDB cups of 240 ml, spoons through the food portions, water at 1 g/ml', () => {
  assert.equal(lineGrams({ amount: 30, unit: 'g' }, FOODS.get(1)), 30);
  assert.equal(lineGrams({ amount: 1, unit: 'C' }, null), 240, 'a cup of water');
  assert.equal(lineGrams({ amount: 2, unit: 'tbsp' }, FOODS.get(3)), 27.2, 'two of the food\'s own tablespoons');
  assert.equal(lineGrams({ amount: 1, unit: 'tsp' }, FOODS.get(4)), 6);
  assert.equal(lineGrams({ amount: 2, unit: 'sprig' }, null), 7);
  assert.equal(lineGrams({ amount: 1, unit: 'nos' }, FOODS.get(1)), null, 'unconvertible');
});

test('dry pulses take up cooking water from USDA\'s raw-to-cooked protein ratio', () => {
  const { food, hydrationGrams } = compose(dish([[100, 'g', 'B013', 'Lentil dal'], [1, 'tsp', 'G528', 'Salt']]));
  assert.ok(Math.abs(hydrationGrams - (100 * 24.6 / 9.02 - 100)) < 1e-9);
  // 100 g dry lentils + 6 g salt + 172.7 g water absorbed; calories are the lentils' 352 over the cooked weight.
  assert.ok(Math.abs(food.nutrients.calories - (352 / (106 + hydrationGrams)) * 100) < 0.01);
  assert.equal(food.portions[0].label, '1 bowl');
  assert.ok(Math.abs(food.portions[0].grams - (106 + hydrationGrams) / 2) < 0.1, 'a bowl is half the cooked dish');
});

test('listed water that exceeds what the pulses absorb is kept; a serving can be several pieces', () => {
  const { food } = compose(dish([[100, 'g', 'B013', 'Lentil dal'], [2, 'C', 'K505', 'Water, distilled']], { count: 1, size: 4, unit: 'piece' }));
  assert.equal(food.portions[0].grams, Math.round(((100 + 480) / 4) * 10) / 10);
});

test('deep-frying oil makes a dish skipped; a few tablespoons for frying stay in the dish', () => {
  const fried = compose(dish([[100, 'g', 'B013', 'Lentil dal'], [2, 'C', 'T508', 'Oil, sunflower', 'Oil (for frying) 2 cups']]));
  assert.match(fried.skipped, /deep-fried/);
  const sauteed = compose(dish([[100, 'g', 'B013', 'Lentil dal'], [2, 'tbsp', 'T508', 'Oil, sunflower', 'Fat for frying 2 tbsp']]));
  assert.ok(sauteed.food, 'sauteing fat is eaten with the dish');
  assert.equal(isDeepFrying({ original: 'Fat for deep frying' }, 20), true);
  assert.equal(isDeepFrying({ original: 'Oil 2 tbsp' }, 300), false, 'only frying oil');
});

test('unmapped ingredients are allowed only as a small share; negligible ones add weight only', () => {
  assert.match(compose(dish([[100, 'g', 'B013', 'Lentil dal'], [20, 'g', 'G010', 'Curry leaves']])).skipped, /unmapped ingredient "Curry leaves" is \d+% of the dish/);
  assert.ok(compose(dish([[100, 'g', 'B013', 'Lentil dal'], [1, 'g', 'G010', 'Curry leaves'], [1, 'tsp', '', 'Kewra essence']])).food);
  assert.match(compose(dish([[100, 'g', 'X999', 'Mystery']])).skipped, /not in the mapping/);
});

test('INDB aliases need a reference and must match the recipe code and name', () => {
  const dishes = [{ code: 'ASC282', name: 'Rice kheer (Chawal ki kheer)' }];
  const ok = { alias: 'kheer', indbCode: 'ASC282', indbName: 'Rice kheer (Chawal ki kheer)', reference: 'https://en.wikipedia.org/wiki/Kheer' };
  assert.deepEqual([...indbAliases([ok], dishes)], [['ASC282', ['kheer']]]);
  assert.throws(() => indbAliases([{ ...ok, reference: '' }], dishes), /reference is required/);
  assert.throws(() => indbAliases([{ ...ok, indbName: 'Kheer' }], dishes), /not "Kheer"/);
});
