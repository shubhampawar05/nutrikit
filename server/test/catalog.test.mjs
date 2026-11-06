// The built food catalog (data/foods.db): invariants the build guarantees, and pinned collision outcomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foods } from '../src/domain/db.ts';

const meta = (key) => foods().prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
const byName = (name) => foods().prepare('SELECT id, source FROM foods WHERE name = ?').all(name);

test('no nutrient amount is negative', () => {
  const negatives = foods().prepare("SELECT f.name, j.key, j.value FROM foods f, json_each(f.nutrients) j WHERE j.value < 0").all();
  assert.deepEqual(negatives, []);
  assert.ok(Number(meta('clamped')) > 0, 'the build records how many source values it clamped');
});

test('every food has calories and a single record per name', () => {
  assert.equal(foods().prepare("SELECT count(*) n FROM foods WHERE json_extract(nutrients, '$.calories') IS NULL").get().n, 0);
  assert.equal(foods().prepare('SELECT count(*) n FROM (SELECT lower(name) FROM foods GROUP BY 1 HAVING count(*) > 1)').get().n, 0);
  assert.ok(Number(meta('collisions')) > 0, 'the build records how many same-name collisions it resolved');
});

test('same-name collisions keep the record with more label nutrients, newest data on a tie', () => {
  // Equal label coverage: Foundation over SR Legacy.
  assert.deepEqual(byName("Pears, raw, bartlett (Includes foods for USDA's Food Distribution Program)").map((r) => r.source), ['foundation']);
  // Foundation lacks label values the SR Legacy record has.
  assert.deepEqual(byName('Kiwifruit, green, raw').map((r) => r.source), ['sr_legacy']);
  // FNDDS survey keeps its record against Foundation and SR Legacy.
  assert.deepEqual(byName('Broccoli, raw').map((r) => r.source), ['survey']);
});

// Typical kcal per 100 g ranges for each recipe dish: a composed value outside its band means a wrong
// ingredient, weight or yield.
const RECIPE_KCAL_BANDS = {
  'Rajma (red kidney bean curry)': [70, 160], 'Chole (chana masala, chickpea curry)': [80, 180],
  'Khichdi (rice and moong dal porridge)': [70, 160], 'Poha (flattened rice with onion and peanuts)': [150, 260],
  'Gulab jamun (fried milk dumplings in syrup)': [280, 420], 'Lassi, sweet': [60, 120], 'Lassi, salted': [35, 80],
  'Butter chicken (murgh makhani)': [120, 230], 'Chicken tikka masala': [110, 210], 'Egg curry (anda curry)': [80, 170],
  'Aloo paratha (potato-stuffed flatbread)': [170, 300], 'Aloo gobi (potato and cauliflower)': [60, 140],
  'Pav bhaji (vegetable mash with buttered rolls)': [110, 220], 'Raita (cucumber yogurt)': [40, 90],
  'Jeera rice (cumin rice)': [130, 200], 'Kadhi (yogurt and gram flour curry)': [50, 120],
  'Bhindi masala (spiced okra)': [60, 150], 'Masala dosa (dosa with potato filling)': [120, 220],
  'Kheer (rice pudding)': [120, 220], 'Matar paneer (peas and paneer curry)': [100, 200],
};

test('recipe dishes are in the catalog, in a plausible calorie band, with portions', () => {
  const rows = foods().prepare("SELECT id, name, nutrients FROM foods WHERE source = 'recipe'").all();
  assert.deepEqual(rows.map((r) => r.name).sort(), Object.keys(RECIPE_KCAL_BANDS).sort());
  for (const r of rows) {
    const n = JSON.parse(r.nutrients);
    const [lo, hi] = RECIPE_KCAL_BANDS[r.name];
    assert.ok(n.calories >= lo && n.calories <= hi, `${r.name}: ${n.calories} kcal per 100 g, expected ${lo}–${hi}`);
    assert.ok(r.id >= 900_000_000, `${r.name}: recipe ids are above every USDA id`);
    assert.ok(Object.keys(n).length >= 25, `${r.name}: carries most nutrients`);
    assert.ok(foods().prepare('SELECT count(*) n FROM portions WHERE food_id = ?').get(r.id).n > 0, `${r.name}: has a portion`);
  }
});
