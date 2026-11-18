// Regressions from a code review of meal-text parsing, portions, labels, search and meal plans.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity } from '../src/domain/units.ts';
import { logText, splitMealText } from '../src/domain/textlog.ts';
import { parseLabelText } from '../src/domain/label.ts';
import { searchFoods } from '../src/domain/search.ts';
import { generateMealPlan } from '../src/domain/mealplan.ts';
import { sampleProvider } from '../src/domain/providers/sample.ts';
import { NUTRIENTS } from '../src/domain/nutrients.ts';

const only = (text) => {
  const r = logText(text);
  assert.equal(r.items.length, 1, `${text}: ${JSON.stringify(r.items.map((i) => i.food.name))}`);
  return r.items[0];
};

test('a fat, sweetener or condiment named without an amount is a spoonful, not a cup', () => {
  for (const [text, max] of [['butter', 15], ['ghee', 15], ['oil', 15], ['olive oil', 15], ['honey', 21], ['jam', 21],
    ['ketchup', 20], ['mayonnaise', 15], ['maple syrup', 21], ['sugar', 5]]) {
    const item = only(text);
    assert.ok(item.grams > 2 && item.grams <= max, `${text}: ${item.grams} g`);
    assert.match(item.portionMethod, /^spoonful/, text);
  }
  assert.equal(only('sugar').unit, 'tsp');
  assert.equal(only('butter').unit, 'tbsp');
  // Stated amounts and dishes named after a fat are untouched.
  assert.equal(only('1 cup butter').grams, 224);
  assert.equal(only('2 tbsp butter').grams, 28);
  assert.ok(only('butter chicken').grams > 100);
  // "toast and butter" is as sensible as "toast with butter".
  const and = logText('toast and butter').items.find((i) => /^Butter/.test(i.food.name));
  const withButter = logText('toast with butter').items.find((i) => /^Butter/.test(i.food.name));
  assert.equal(and.grams, withButter.grams);
});

test('a quantity that is not a finite number is no quantity; an explicit zero stays zero', () => {
  for (const text of ['1/0 cup rice', '0/0 cup rice', '1 1/0 cup rice']) {
    const { value } = parseQuantity(text);
    assert.equal(value, null, text);
  }
  const [item] = splitMealText('1/0 cup rice').items;
  assert.equal(item.quantity, null);
  assert.ok(Number.isFinite(only('1/0 cup rice').grams));
  assert.equal(parseQuantity('0 eggs').value, 0);
  assert.equal(only('0 eggs').grams, 0);
});

test('label numbers with thousands commas are thousands; a decimal comma is still a decimal', () => {
  const l = parseLabelText('Serving size 1 cup (240g) Calories 1,200 Total Fat 2,5 g Sodium 1,250mg Potassium 1,234 mg Protein 12g');
  assert.equal(l.perServing.calories.amount, 1200);
  assert.equal(l.perServing.sodium.amount, 1250);
  assert.equal(l.perServing.potassium.amount, 1234);
  assert.equal(l.perServing.fat.amount, 2.5);
  assert.equal(parseLabelText('Serving size 1,000 ml Calories 230').servingGrams, 1000);
  assert.equal(parseLabelText('Serving size 30g Calories 230').perServing.calories.amount, 230);
});

test('a dish named with "and" or "with" is one food; a list of foods is still split', () => {
  const mac = only('mac and cheese');
  assert.match(mac.food.name, /macaroni/i);
  assert.equal(splitMealText('2 mac and cheese').items[0].quantity, 2);
  assert.match(only('beans and rice').food.name, /^Beans and rice/);
  assert.match(only('peanut butter and jelly').food.name, /^Peanut butter and jelly/);
  assert.equal(logText('eggs and toast').items.length, 2);
  assert.equal(logText('bread and butter').items.length, 2); // not "Bread and butter pudding"
  // The catalog's best match is the add-on itself ("Salad dressing") or another dish ("Chicken curry with rice").
  const salad = logText('salad with dressing').items;
  assert.equal(salad.length, 2);
  assert.ok(salad[0].grams > salad[1].grams, 'the salad, then a spoonful of dressing');
  assert.ok(logText('chicken with rice').items.every((i) => !/curry/i.test(i.food.name)));
  const coffee = logText('coffee with milk').items;
  assert.equal(coffee.length, 2);
  assert.equal(coffee[1].portionMethod, 'add-on-smallest-portion');
  assert.equal(logText('2 eggs and a cup of coffee with milk').items.length, 3);
});

test('cooked eggs are searched as cooked, not raw', () => {
  for (const q of ['boiled eggs', 'fried eggs', '2 fried eggs', 'scrambled eggs', 'poached eggs', 'hard-boiled eggs']) {
    const [top] = searchFoods(q, { limit: 1 }).results;
    assert.doesNotMatch(top.name, /raw/i, q);
    assert.match(top.name, /egg/i, q);
  }
  assert.match(searchFoods('2 eggs', { limit: 1 }).results[0].name, /Egg, whole, raw/);
});

test('search total counts the ranked matches, so paging to it returns everything', () => {
  const first = searchFoods('chicken', { limit: 50 });
  const last = searchFoods('chicken', { limit: 50, offset: first.total - 1 });
  assert.equal(last.total, first.total);
  assert.equal(last.results.length, 1);
  assert.equal(searchFoods('chicken', { limit: 50, offset: first.total }).results.length, 0);
});

test('meal plans apply exclusions per request from a shared pool', () => {
  const plain = generateMealPlan({ seed: 3, days: 2 });
  const names = (p) => p.days.flatMap((d) => d.meals.flatMap((m) => m.items.map((i) => i.food.name.toLowerCase())));
  const banned = names(plain)[0].split(/[ ,]+/)[0];
  const without = generateMealPlan({ seed: 3, days: 2, exclude: [banned] });
  assert.ok(names(without).length > 0);
  assert.ok(names(without).every((n) => !n.includes(banned)), banned);
  // The shared pool is not narrowed by an earlier request's exclusions.
  assert.deepEqual(generateMealPlan({ seed: 3, days: 2 }), plain);
});

test('the sample label uses the catalog nutrient keys', async () => {
  const keys = new Set(NUTRIENTS.map((n) => n.key));
  const { perServing } = await sampleProvider.readLabel({ image: '', mediaType: 'image/png' });
  for (const k of Object.keys(perServing)) assert.ok(keys.has(k), k);
  assert.equal(perServing.carbs, 40);
  assert.equal(perServing.sugar, 9);
});
