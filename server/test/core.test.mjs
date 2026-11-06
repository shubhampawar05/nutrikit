import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity, canonicalUnit, resolvePortion } from '../src/domain/units.ts';
import { searchFoods } from '../src/domain/search.ts';
import { getFood } from '../src/domain/db.ts';
import { logText, splitMealText } from '../src/domain/textlog.ts';
import { parseLabelText } from '../src/domain/label.ts';
import { scaleNutrients, sumNutrients } from '../src/domain/nutrients.ts';
import { generateMealPlan } from '../src/domain/mealplan.ts';

const top = (q) => searchFoods(q, { limit: 1 }).results[0]?.name;
const food = (q) => getFood(searchFoods(q, { limit: 1 }).results[0].id);

test('parseQuantity handles digits, fractions, unicode and words', () => {
  const cases = [['2 eggs', 2, 'eggs'], ['1 1/2 cups rice', 1.5, 'cups rice'], ['1/2 cup', 0.5, 'cup'], ['½ avocado', 0.5, 'avocado'],
    ['1½ cups', 1.5, 'cups'], ['a banana', 1, 'banana'], ['half an avocado', 0.5, 'avocado'], ['two slices', 2, 'slices'],
    ['a dozen eggs', 12, 'eggs'], ['2.5 oz', 2.5, 'oz'], ['banana', null, 'banana']];
  for (const [text, value, rest] of cases) assert.deepEqual(parseQuantity(text), { value, rest }, text);
});

test('canonicalUnit classifies mass, volume and count units', () => {
  assert.equal(canonicalUnit('grams').kind, 'mass');
  assert.equal(canonicalUnit('oz').grams, 28.3495);
  assert.equal(canonicalUnit('tbsp').kind, 'volume');
  assert.equal(canonicalUnit('slices').unit, 'slice');
  assert.equal(canonicalUnit('banana'), null);
});

test('search ranks the generic, as-eaten food first', () => {
  assert.equal(top('banana'), 'Banana, raw');
  assert.equal(top('apple'), 'Apple, raw');
  assert.equal(top('coffee'), 'Coffee, brewed');
  assert.equal(top('peanut butter'), 'Peanut butter');
  assert.match(top('white rice'), /^Rice, white, cooked/);
  assert.match(top('fries'), /french fries/i);
  assert.equal(searchFoods('zzzzqqq').total, 0);
  assert.equal(searchFoods('').total, 0);
});

test('search prefers whole-word matches over prefix matches', () => {
  // "roti" prefix-matches "rotisserie"; the bread is what people mean.
  assert.match(top('roti'), /chapp?att?i or roti/);
  assert.match(top('rotis'), /chapp?att?i or roti/);
  assert.match(top('rotisserie chicken'), /rotisserie/i);
  assert.match(top('bana'), /^Banana/); // a partial word still finds the food
  const r = logText('2 rotis and a bowl of dal');
  assert.deepEqual(r.items.map((i) => i.food.name.split(',')[0]), ['Bread', 'Dal']);
});

test('resolvePortion converts mass, volume, counts and drinks', () => {
  const banana = food('banana');
  assert.equal(resolvePortion(banana, 2, null).grams, 2 * 126);
  assert.equal(resolvePortion(banana, 150, 'g').grams, 150);
  assert.equal(resolvePortion(banana, 1, 'cup').method, 'portion');
  const oj = food('orange juice');
  const r = resolvePortion(oj, 12, 'oz');
  assert.equal(r.unit, 'fl oz', '"oz" of a drink means fluid ounces');
  assert.equal(Math.round(r.grams), 372);
  const almonds = food('almonds');
  assert.ok(resolvePortion(almonds, null, null).grams >= 15, 'unquantified foods avoid tiny units');
  assert.equal(Math.round(resolvePortion(almonds, 1, 'handful').grams), 28);
});

test('resolvePortion never uses a dry-yield portion as a volume', () => {
  const grits = {
    name: 'Grits, NFS',
    portions: [
      { label: '1 cup, dry, yields', amount: 1, unit: 'cup', grams: 965 },
      { label: '1 cup, cooked', amount: 1, unit: 'cup', grams: 240 },
    ],
  };
  assert.equal(resolvePortion(grits, 1, 'cup').grams, 240);
  assert.equal(resolvePortion(grits, 2, 'tbsp').grams, 30, 'converted through the cooked cup');
});

test('a bare count prefers the regular size over small, mini or thin', () => {
  const portions = (...labels) => labels.map(([label, unit, grams]) => ({ label, amount: 1, unit, grams }));
  const samosa = { name: 'Samosa', portions: portions(['1 small/individual', 'small', 25], ['1 regular/large', 'regular', 100]) };
  assert.equal(resolvePortion(samosa, 1, null).grams, 100);
  const bagel = { name: 'Bagel', portions: portions(['1 miniature', 'miniature', 26], ['1 regular', 'regular', 105], ['1 Bagel Thin', 'bagel', 46]) };
  assert.equal(resolvePortion(bagel, 1, null).grams, 105);
  const onlySmall = { name: 'Samosa', portions: portions(['1 small/individual', 'small', 25]) };
  assert.equal(resolvePortion(onlySmall, 1, null).grams, 25, 'a size-down portion is still used when it is the only one');
});

test('meal text splits into items with quantities, units and add-ons', () => {
  const { meal, items } = splitMealText('For lunch I had 200g chicken breast, 1 1/2 cups brown rice and coffee with milk');
  assert.equal(meal, 'lunch');
  assert.deepEqual(items.map((i) => [i.food, i.quantity, i.unit, i.addOn]), [
    ['chicken breast', 200, 'g', false], ['brown rice', 1.5, 'cups', false], ['coffee', null, null, false], ['milk', null, null, true],
  ]);
});

test('logText resolves foods, portions and totals', () => {
  const r = logText('2 eggs, a slice of whole wheat toast and a cup of coffee with milk');
  assert.deepEqual(r.items.map((i) => i.food.name), ['Egg, whole, raw', 'Bread, whole wheat, toasted', 'Coffee, brewed', 'Milk, NFS']);
  assert.equal(r.items[0].grams, 100);
  assert.equal(r.items[3].portionMethod, 'add-on-smallest-portion');
  const sum = r.items.reduce((s, i) => s + i.nutrients.calories.amount, 0);
  assert.ok(Math.abs(sum - r.totals.calories.amount) <= 1);
  assert.equal(logText('').items.length, 0);
  assert.equal(logText('qwertyuiop zxcv').unmatched.length, 1);
});

test('nutrient scaling and %DV', () => {
  const n = scaleNutrients({ calories: 200, sodium: 1000, protein: 10 }, 50);
  assert.deepEqual(n.calories, { amount: 100, unit: 'kcal', dailyValuePercent: 5 });
  assert.deepEqual(n.sodium, { amount: 500, unit: 'mg', dailyValuePercent: 22 });
  assert.equal(sumNutrients([n, n]).protein.amount, 10);
});

test('label text: current FDA format', () => {
  const r = parseLabelText(`Nutrition Facts 8 servings per container Serving size 2/3 cup (55g)
    Amount per serving Calories 230 % Daily Value* Total Fat 8g 10% Saturated Fat 1g 5% Trans Fat 0g
    Cholesterol 0mg 0% Sodium 160mg 7% Total Carbohydrate 37g 13% Dietary Fiber 4g 14% Total Sugars 12g
    Includes 10g Added Sugars 20% Protein 3g Vitamin D 2mcg 10% Calcium 260mg 20% Iron 8mg 45% Potassium 240mg 6%`);
  assert.equal(r.servingGrams, 55);
  assert.equal(r.servingsPerContainer, 8);
  assert.equal(r.perServing.calories.amount, 230);
  assert.equal(r.perServing.addedSugar.amount, 10);
  assert.equal(r.perServing.sugar.amount, 12);
  assert.equal(r.perServing.saturatedFat.amount, 1);
  assert.equal(r.perServing.fat.amount, 8);
  assert.equal(r.perServing.vitaminD.unit, 'mcg');
  assert.equal(r.per100g.calories, 418.18);
  assert.deepEqual(r.warnings, []);
});

test('label text: legacy format and missing fields', () => {
  const r = parseLabelText('Serving Size 1 cup (228g) Servings Per Container 2 Calories 250 Calories from Fat 110 Total Fat 12 g Sodium 0.47g');
  assert.equal(r.perServing.calories.amount, 250);
  assert.equal(r.perServing.fat.amount, 12);
  assert.equal(r.perServing.sodium.amount, 470);
  assert.equal(r.servingsPerContainer, 2);
  const empty = parseLabelText('hello');
  assert.deepEqual(empty.warnings, ['serving size not found', 'calories not found']);
});

test('meal plans are deterministic, near target and respect diets', () => {
  const a = generateMealPlan({ calories: 2200, seed: 42, days: 2 });
  assert.deepEqual(a, generateMealPlan({ calories: 2200, seed: 42, days: 2 }));
  for (const d of a.days) assert.ok(Math.abs(d.totals.calories.amount - 2200) / 2200 < 0.1, `day ${d.day}: ${d.totals.calories.amount}`);
  const meat = /\b(beef|pork|chicken|turkey|bacon|ham|sausage|fish|salmon|tuna|shrimp)\b/i;
  for (const seed of [1, 2, 3, 4, 5]) {
    const veg = generateMealPlan({ diet: 'vegetarian', seed });
    for (const i of veg.days[0].meals.flatMap((m) => m.items)) assert.doesNotMatch(i.food.name, meat);
    const vegan = generateMealPlan({ diet: 'vegan', seed });
    // The vegan filter allows at most 1 mg cholesterol per 100 g (rounding noise in plant foods).
    for (const i of vegan.days[0].meals.flatMap((m) => m.items)) assert.ok(((i.nutrients.cholesterol?.amount ?? 0) / i.grams) * 100 <= 1.05, i.food.name);
  }
  const noNuts = generateMealPlan({ exclude: ['nut', 'almond'], seed: 3, days: 3 });
  for (const i of noNuts.days.flatMap((d) => d.meals.flatMap((m) => m.items))) assert.doesNotMatch(i.food.name, /nut|almond/i);
});

test('meal totals flag nutrients some foods lack, and leave out nutrients none have', () => {
  const a = scaleNutrients({ calories: 100, vitaminD: 2 }, 100);
  const b = scaleNutrients({ calories: 50 }, 100);
  const totals = sumNutrients([a, b]);
  assert.equal(totals.calories.amount, 150);
  assert.equal(totals.calories.missingFrom, undefined, 'every food had calories');
  assert.equal(totals.vitaminD.amount, 2);
  assert.equal(totals.vitaminD.missingFrom, 1, 'one of the two foods had no vitamin D value');
  assert.equal(totals.vitaminC, undefined, 'no food had vitamin C');
  assert.deepEqual(sumNutrients([]), {});
});
