// The Set D food-matching review (2026-11-20): the 11 phrases that logged a wrong food, and the phrases next to them
// that must not change. A wrong food is never logged: a phrase naming one reviewed dish logs it; a phrase naming
// several foods, or a dish the catalog lacks, is asked about with the right foods offered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';
import { searchFoods } from '../src/domain/search.ts';

const items = (t) => logText(t).items.map((i) => i.food.name);
const asked = (t) => {
  const r = logText(t);
  assert.equal(r.items.length, 0, `${t}: nothing logged (logged ${r.items.map((i) => i.food.name)})`);
  assert.equal(r.unmatched.length, 1, t);
  assert.equal(r.unmatched[0].text, t, `${t}: kept as given`);
  return r.unmatched[0].suggestions?.map((s) => s.name) ?? [];
};

test('a phrase naming one reviewed dish logs that dish, not a different one that ranked first', () => {
  assert.deepEqual(items('chicken fried rice'), ['Rice, fried, with chicken'], 'not the CoFID chicken stir-fry');
  assert.deepEqual(items('fruit salad'), ['Fruit salad, fresh or raw, including citrus fruits, no dressing'], 'not with marshmallows');
  assert.deepEqual(items('chicken wings'), ['Chicken wing, NS as to cooking method'], 'not a marinated barbecued wing');
  assert.equal(logText('2 chicken wings').items[0].grams, 70);
  for (const t of ['mac and cheese', 'mac & cheese', 'macaroni and cheese']) {
    assert.deepEqual(items(t), ['Macaroni or noodles with cheese'], `${t}: not the Easy Mac packaged product`);
  }
});

test('a dish the catalog lacks is asked about, never logged as a different dish', () => {
  assert.deepEqual(asked('chicken tikka'), ['Chicken tikka masala'], 'dry tikka is not the curry; the curry is still offered');
  assert.ok(asked('murgh tikka').includes('Chicken tikka masala'));
  // INDB's tandoori chicken is the dish, but its only portion is a whole bird (1441 g): offered first, not logged.
  assert.equal(asked('tandoori chicken')[0], 'Tandoori chicken');
  assert.equal(asked('2 tandoori chicken')[0], 'Tandoori chicken');
  for (const t of ['veg spring roll', 'vegetable spring roll', '2 veg spring rolls']) {
    assert.ok(!asked(t).includes('Spring rolls, meat, takeaway'), `${t}: the meat roll is never offered for a veg roll`);
  }
});

test('a word naming several foods is asked about, the amount kept, with reviewed foods offered', () => {
  assert.ok(asked('egg roll').includes('Egg roll, meatless'), 'Indian or Chinese, veg or meat');
  assert.ok(asked('egg rolls').length >= 4);
  assert.deepEqual(asked('spring roll'), ['Spring rolls, meat, takeaway']);
  assert.ok(asked('1 tbsp oil').includes('Oil, mustard'), 'never palm oil by default; the 1 tbsp stays in the text');
  assert.ok(!asked('oil').includes('Oil, palm'));
  assert.ok(asked('raita').includes('Cucumber raita (Kheere ka raita)'));
  assert.deepEqual(asked('biscuits'), ['Sweet plain biscuit', 'Marie biscuit', 'Cookie, NFS', 'Biscuit, NFS'], 'Indian or British sweet biscuit, or a US bread biscuit');
});

test('in a meal, the clear foods log and only the ambiguous one is asked about', () => {
  const p = logText('2 paratha with raita');
  assert.deepEqual(p.items.map((i) => i.food.name), ['Bread, paratha']);
  assert.deepEqual(p.unmatched.map((u) => u.text), ['raita']);
  const t = logText('tea and biscuits');
  assert.deepEqual(t.items.map((i) => i.food.name), ['Tea, hot, leaf, black']);
  assert.deepEqual(t.unmatched.map((u) => u.text), ['biscuits']);
  const r = logText('rice with oil');
  assert.deepEqual(r.items.map((i) => i.food.name), ['Rice, cooked, NFS']);
  assert.deepEqual(r.unmatched.map((u) => u.text), ['oil']);
});

test('nearby phrases that name their food exactly are unchanged', () => {
  for (const [t, food] of [
    ['mustard oil', 'Oil, mustard'], ['1 tbsp olive oil', 'Olive oil'], ['coconut oil', 'Coconut oil'], ['ghee', 'Ghee, clarified butter'],
    ['cucumber raita', 'Cucumber raita (Kheere ka raita)'], ['marie biscuit', 'Marie biscuit'], ['sweet plain biscuit', 'Sweet plain biscuit'],
    ['chicken tikka masala', 'Chicken tikka masala'], ['paneer tikka', 'Paneer shaslik/tikka'], ['fried rice', 'Rice, fried, NFS'],
    ['chicken egg roll', 'Egg rolls, chicken, refrigerated, heated'], ['chicken wing', 'Chicken wing, NS as to cooking method'],
    ['tandoori chicken curry', 'Curry, chicken tandoori, retail, reheated'], ['salad', 'Lettuce, salad with assorted vegetables including tomatoes and/or carrots, no dressing'],
  ]) assert.deepEqual(items(t), [food], t);
  assert.deepEqual(items('dal with ghee'), ['Dal', 'Ghee, clarified butter']);
  // Search itself still lists every oil and raita: only logging asks.
  assert.ok(searchFoods('oil', { limit: 10 }).results.length >= 10);
  assert.ok(searchFoods('raita', { limit: 10 }).results.length >= 10);
});
