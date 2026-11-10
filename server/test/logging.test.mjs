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
  assert.equal(item('a cup of chai').food.name, 'Tea, hot, with milk', 'chai is milk tea, as drunk in India');
  assert.match(item('a salad').food.name, /^Lettuce/);
  assert.match(item('green tea').food.name, /^Tea, hot, leaf, green/);
});

test('search matches whole words before prefixes', () => {
  assert.ok(searchFoods('chole').results.every((r) => !/cholesterol/i.test(r.name)), 'never a "cholesterol-free" food');
  const partial = searchFoods('chicke');
  assert.equal(partial.match, 'prefix', 'partial typing still works');
  assert.match(partial.results[0].name, /^Chicken/);
  assert.equal(searchFoods('egg').match, 'all-words');
});

test('category-led names match their food', () => {
  assert.match(item('100 g salmon').food.name, /^Fish, salmon, (raw|NFS|baked)/);
  assert.equal(item('100 g paneer').food.name, 'Cheese, paneer');
  assert.equal(item('1 naan').grams, 177, 'a whole naan, not a quarter piece');
});

test('regional and spelling variants match the right food', () => {
  assert.match(item('1 cup curd').food.name, /^Yogurt/);
  assert.match(item('1 cup dahi').food.name, /^Yogurt/);
  assert.match(item('100 g bean curd').food.name, /^Tofu/);
  assert.match(item('1 donut').food.name, /^Doughnut/);
});

test('plain foods are preferred over prepared forms', () => {
  assert.doesNotMatch(item('1 chicken breast').food.name, /coated|breaded|battered/i);
  assert.match(item('1 cup brown rice').food.name, /no added fat/);
});

test('a weak partial match is unmatched with suggestions, not logged', () => {
  const r = logText('1 cup butter paneer');
  assert.equal(r.items.length, 0, 'not logged as a cup of butter');
  assert.equal(r.unmatched[0].reason, 'no confident match');
  assert.ok(r.unmatched[0].suggestions.length > 0);
  assert.deepEqual(r.totals, {});
  assert.match(item('homemade veggie burger').food.name, /^Veggie burger/, 'a word counts in its typed form too');
});

test('a misspelled search returns the respelled foods with didYouMean', () => {
  const r = searchFoods('panner', { limit: 3 });
  assert.equal(r.didYouMean, 'paneer');
  assert.match(r.results[0].name, /paneer/i);
  assert.equal(searchFoods('chiken curry').didYouMean, 'chicken curry');
  assert.equal(searchFoods('bananna').didYouMean, 'banana');
  assert.equal(searchFoods('samosaa').didYouMean, 'samosa', 'the singular wins over the plural');
});

test('correct spellings, partial typing and nonsense are not respelled', () => {
  for (const q of ['paneer', 'chicken curry', 'chick', 'tomatoe']) assert.equal(searchFoods(q).didYouMean, undefined, q);
  const nonsense = searchFoods('asdfgh');
  assert.equal(nonsense.didYouMean, undefined);
  assert.equal(nonsense.results.length, 0);
});

test('logging suggests a respelling instead of logging it', () => {
  const r = logText('2 rotis and 1 cup panner');
  assert.equal(r.items.length, 1, 'the roti is logged, the misspelled phrase is not');
  assert.equal(r.unmatched[0].text, '1 cup panner');
  assert.equal(r.unmatched[0].didYouMean, '1 cup paneer', 'the amount is kept in the respelled phrase');
  assert.match(r.unmatched[0].suggestions[0].name, /paneer/i);
  assert.equal(logText('asdfgh').unmatched[0].didYouMean, undefined);
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

test('dishes the catalog lacks are unmatched, never logged as another food', () => {
  for (const phrase of ['2 gulab jamun', '1 glass lassi', '1 cup butter chicken', '1 cup kheer']) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, `${phrase} is not logged`);
    assert.equal(r.unmatched.length, 1, `${phrase} is listed as unmatched`);
  }
});

test('common phrasings reach the USDA food that exists', () => {
  assert.equal(item('dal tadka').food.name, 'Dal');
  assert.equal(item('1 cup dal fry').food.name, 'Dal');
  assert.equal(item('masala chai').food.name, 'Tea, hot, with milk');
});

test('CoFID dishes are logged by English name or cited alias, without invented portions', () => {
  const rajma = item('1 cup rajma');
  assert.equal(rajma.food.name, 'Curry, red kidney bean, Punjabi, homemade');
  assert.equal(rajma.food.source, 'cofid');
  assert.equal(rajma.portionMethod, 'density-estimate', 'CoFID has no household portions; the estimate is labelled');
  for (const [phrase, name] of [
    ['chana masala', /^Curry, chick pea, whole and tomato, Punjabi/], ['1 cup masoor dal', /red\/masoor dahl/],
    ['toor dal', /pigeon pea dahl/], ['khichdi', /^Khichadi/], ['aloo gobi', /^Curry, cauliflower and potato/],
    ['red kidney bean curry', /^Curry, red kidney bean/], ['chicken korma', /^Curry, chicken korma/],
  ]) assert.match(item(phrase).food.name, name, phrase);
  assert.equal(item('100 g rajma').grams, 100);
});

test('a USDA food named exactly what was searched comes before CoFID dishes', () => {
  assert.equal(item('1 cup sambar').food.source, 'survey');
  assert.equal(item('1 samosa').food.name, 'Samosa');
  assert.equal(item('1 cup dal').food.name, 'Dal');
  assert.equal(searchFoods('sambar').results[0].source, 'survey');
});
