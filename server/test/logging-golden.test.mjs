// Meal phrases the parser already gets right. Rule changes in textlog/search/units must keep these:
// the same foods, and grams within 10% (null = only the food is pinned, its size is meant to change).
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';

const GOLDEN = {
  '2 rotis and dal': [['Bread, chapati or roti, plain, commercially prepared', 136], ['Dal', 240]],
  'rice with ghee': [['Rice, cooked, NFS', 158], ['Ghee, clarified butter', 14]],
  'a handful of almonds': [['Almonds, NFS', 28.4]],
  'a bowl of oatmeal with blueberries': [['Oatmeal, NFS', 240], ['Blueberries, raw', null]],
  'toast with jam': [['Bread, white, toasted', 25], ['Jam', 14]],
  '1 cup rice, chicken curry': [['Rice, cooked, NFS', 158], ['Chicken curry', 240]],
  '2 eggs, a slice of whole wheat toast and a cup of coffee with milk': [['Egg, whole, raw', 100], ['Bread, whole wheat, toasted', 33], ['Coffee, brewed', 240], ['Milk, NFS', 30.5]],
  'For lunch I had a cheeseburger and medium fries': [['Cheeseburger, NFS', 165], ['Potato, french fries, NFS', null]],
  'a banana and a coffee': [['Banana, raw', 126], ['Coffee, brewed', 240]],
};

for (const [phrase, expected] of Object.entries(GOLDEN)) {
  test(`golden: ${phrase}`, () => {
    const items = logText(phrase).items;
    assert.deepEqual(items.map((i) => i.food.name), expected.map(([name]) => name));
    expected.forEach(([, grams], i) => {
      if (grams == null) return;
      assert.ok(Math.abs(items[i].grams - grams) <= grams * 0.1, `${items[i].food.name}: ${items[i].grams} g, expected about ${grams} g`);
    });
  });
}
