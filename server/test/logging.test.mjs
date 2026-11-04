// Food-logging accuracy for everyday phrases (food-logging spec).
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';
import { searchFoods } from '../src/domain/search.ts';

const items = (text) => logText(text).items;
const item = (text, i = 0) => items(text)[i];
const between = (g, lo, hi, what) => assert.ok(g >= lo && g <= hi, `${what}: ${g} g, expected ${lo}–${hi} g`);

test('an unquantified sweetener or fat is a spoonful, not a cup', () => {
  between(item('a cup of tea with sugar', 1).grams, 3, 15, 'sugar in tea');
  between(item('coffee with sugar', 1).grams, 3, 15, 'sugar in coffee');
  between(item('oatmeal with honey', 1).grams, 3, 15, 'honey');
  between(item('rice with ghee', 1).grams, 3, 15, 'ghee');
  assert.ok(item('a cup of tea with sugar', 1).nutrients.calories.amount < 60, 'a teaspoon of sugar is well under 60 kcal');
});

test('other unquantified add-ons are capped at 60 g', () => {
  between(item('coffee with milk', 1).grams, 15, 60, 'milk in coffee');
  between(item('a bowl of oatmeal with blueberries', 1).grams, 3, 60, 'blueberries');
});

test('a stated amount beats the add-on cap', () => {
  const sugar = item('tea with 2 tbsp sugar', 1);
  assert.equal(sugar.quantity, 2);
  assert.equal(sugar.unit, 'tbsp');
  between(sugar.grams, 20, 30, 'two tablespoons of sugar');
});

test('bare everyday words match the everyday food', () => {
  assert.equal(item('tea').food.name, 'Tea, hot, leaf, black');
  assert.equal(item('a cup of chai').food.name, 'Tea, hot, leaf, black');
  assert.match(item('a salad').food.name, /^Lettuce/);
  assert.match(item('green tea').food.name, /^Tea, hot, leaf, green/);
});

test('words that ask for a variant still get it', () => {
  assert.match(item('iced tea').food.name, /iced/i);
  assert.match(item('chicken salad').food.name, /chicken/i);
});

test('searching a bare word lists the default first and still the rest', () => {
  const tea = searchFoods('tea', { limit: 10 }).results.map((r) => r.name);
  assert.equal(tea[0], 'Tea, hot, leaf, black');
  assert.ok(tea.length >= 5, 'other teas are still listed');
});

test('hot drinks without a size are one cup', () => {
  between(item('tea').grams, 230, 250, 'tea');
  between(item('coffee').grams, 230, 250, 'coffee');
  between(item('hot chocolate').grams, 230, 260, 'hot chocolate');
});

test('size words get realistic, ordered servings', () => {
  const [small, medium, large] = ['small', 'medium', 'large'].map((s) => item(`${s} fries`).grams);
  between(medium, 100, 140, 'medium fries');
  assert.ok(small < medium && medium < large, `${small} < ${medium} < ${large}`);
  assert.equal(item('2 medium fries').grams, 2 * medium);
});

test('search does not repeat the same food from another source', () => {
  const names = searchFoods('greek yogurt', { limit: 10 }).results.map((r) => r.name.toLowerCase());
  const wholePlain = names.filter((n) => /whole milk/.test(n) && /plain/.test(n));
  assert.equal(wholePlain.length, 1, names.join(' | '));
  const banana = searchFoods('banana', { limit: 10 }).results.map((r) => r.name);
  assert.ok(!(banana.includes('Banana, raw') && banana.includes('Bananas, raw')), 'singular and plural are one food');
  assert.equal(searchFoods('banana', { limit: 5 }).results.length, 5, 'a page stays full');
});

test('nonsense is unmatched, not guessed', () => {
  const r = logText('asdfgh qwerty');
  assert.equal(r.items.length, 0);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.totals.calories?.amount ?? 0, 0);
});
