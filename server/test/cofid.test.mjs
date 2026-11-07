// CoFID conversion rules (scripts/cofid.mjs) on rows shaped like the workbook's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cofidFoods, convertCofid, cofidId, cofidNumber, verifyCofidFile, DISH_GROUPS } from '../scripts/cofid.mjs';

const COLUMNS = {
  '1.3 Proximates': ['Water (g)', 'Protein (g)', 'Fat (g)', 'Energy (kcal) (kcal)', 'Starch (g)', 'Oligosaccharide (g)',
    'Total sugars (g)', 'Glucose (g)', 'Galactose (g)', 'Fructose (g)', 'Sucrose (g)', 'Maltose (g)', 'Lactose (g)',
    'Alcohol (g)', 'NSP (g)', 'AOAC fibre (g)', 'Satd FA /100g fd (g)', 'Mono FA /100g food (g)', 'Poly FA /100g food (g)',
    'Trans FAs /100g food (g)', 'Cholesterol (mg)'],
  '1.4 Inorganics': ['Sodium (mg)', 'Potassium (mg)', 'Calcium (mg)', 'Magnesium (mg)', 'Phosphorus (mg)', 'Iron (mg)', 'Zinc (mg)'],
  '1.5 Vitamins': ['Retinol (µg)', 'Carotene (µg)', 'Vitamin D (µg)', 'Vitamin E (mg)', 'Vitamin K1 (µg)', 'Thiamin (mg)',
    'Riboflavin (mg)', 'Niacin (mg)', 'Vitamin B6 (mg)', 'Vitamin B12 (µg)', 'Folate (µg)', 'Vitamin C (mg)'],
  '1.6 Vitamin Fractions': ['Cholecalciferol (µg)', '25-hydroxy vitamin D3 (µg)', 'Alpha-tocopherol (mg)'],
};
const BASE = {
  'Water (g)': '75', 'Protein (g)': '5', 'Fat (g)': '5', 'Energy (kcal) (kcal)': '100', 'Starch (g)': '11', 'Oligosaccharide (g)': '',
  'Total sugars (g)': '2.1', 'Glucose (g)': '0.5', 'Galactose (g)': '0', 'Fructose (g)': '0.5', 'Sucrose (g)': '1.05', 'Maltose (g)': 'Tr', 'Lactose (g)': '0',
  'Alcohol (g)': '0', 'NSP (g)': '2', 'AOAC fibre (g)': '3', 'Satd FA /100g fd (g)': '1', 'Mono FA /100g food (g)': '2', 'Poly FA /100g food (g)': '1.5',
  'Trans FAs /100g food (g)': 'Tr', 'Cholesterol (mg)': '0', 'Sodium (mg)': '250', 'Potassium (mg)': '300', 'Calcium (mg)': '40',
  'Magnesium (mg)': '30', 'Phosphorus (mg)': '80', 'Iron (mg)': '1.5', 'Zinc (mg)': '0.6', 'Retinol (µg)': '10', 'Carotene (µg)': '120',
  'Vitamin D (µg)': '0.5', 'Vitamin E (mg)': '2', 'Vitamin K1 (µg)': '4', 'Thiamin (mg)': '0.1', 'Riboflavin (mg)': '0.05', 'Niacin (mg)': '0.5',
  'Vitamin B6 (mg)': '0.1', 'Vitamin B12 (µg)': '0', 'Folate (µg)': '30', 'Vitamin C (mg)': '5',
  'Cholecalciferol (µg)': '0.3', '25-hydroxy vitamin D3 (µg)': '0.04', 'Alpha-tocopherol (mg)': '1.2',
};
// Sheets like the workbook's: a header row, an acronym row (skipped), then one row per food.
function sheets(foods) {
  return Object.fromEntries(Object.entries(COLUMNS).map(([title, cols]) => [title, [
    ['Food Code', 'Food Name', 'Description', 'Group', 'Previous', 'Main data references', 'Footnote', ...cols],
    ['', '', '', '', '', '', '', ...cols.map((c) => c.toUpperCase())],
    ...foods.map(({ code, group = 'DR', ...over }) => [code, `Dish ${code}`, 'Recipe', group, '', '', '', ...cols.map((c) => (c in over ? over[c] : BASE[c]))]),
  ]]));
}
const convert = (over = {}) => convertCofid(cofidFoods(sheets([{ code: '15-001', ...over }]))[0]);

test('values are published as is where definitions match; N is missing and Tr is 0', () => {
  const { nutrients: n } = convert({ 'Sodium (mg)': 'N', 'Trans FAs /100g food (g)': 'Tr' });
  assert.equal(n.calories, 100);
  assert.equal(n.protein, 5);
  assert.equal(n.saturatedFat, 1);
  assert.equal(n.sodium, undefined, 'N: not determined');
  assert.equal(n.transFat, 0, 'Tr: trace');
  assert.equal(n.folate, undefined, 'folate is never converted');
});

test('carbohydrate and sugars are exact from their components, else by the documented conversion', () => {
  const exact = convert();
  assert.equal(exact.carbsMethod, 'exact');
  assert.equal(exact.nutrients.sugar, 2); // 0.5 + 0.5 (monosaccharides) + 1.05 / 1.05 (sucrose)
  assert.equal(exact.nutrients.carbs, 15); // sugars 2 + starch 11 / 1.1 + AOAC fibre 3
  assert.equal(exact.nutrients.fiber, 3);

  const documented = convert({ 'Glucose (g)': 'N', 'AOAC fibre (g)': '' });
  assert.equal(documented.carbsMethod, 'documented');
  assert.equal(documented.nutrients.sugar, 2); // total sugars 2.1 / 1.05
  assert.equal(documented.nutrients.carbs, 14); // 2.1 / 1.05 + 11 / 1.1 + NSP 2
  assert.equal(documented.nutrients.fiber, undefined, 'NSP is never reported as fibre');

  const none = convert({ 'Starch (g)': 'N' });
  assert.equal(none.carbsMethod, null);
  assert.equal(none.nutrients.carbs, undefined);
});

test('vitamin A is RAE, vitamin D and E come only from the matching fractions', () => {
  const { nutrients: n } = convert();
  assert.equal(n.vitaminA, 20); // retinol 10 + carotene 120 / 12
  assert.equal(n.vitaminD, 0.3, 'cholecalciferol, not the total with 25-hydroxy D3');
  assert.equal(n.vitaminE, 1.2, 'alpha-tocopherol, not alpha-tocopherol equivalents');
  assert.equal(convert({ 'Carotene (µg)': 'N' }).nutrients.vitaminA, undefined);
  assert.equal(convert({ 'Cholecalciferol (µg)': '', 'Vitamin D (µg)': '0' }).nutrients.vitaminD, 0);
  assert.equal(convert({ 'Cholecalciferol (µg)': '', 'Vitamin D (µg)': '0.5' }).nutrients.vitaminD, undefined);
  assert.equal(convert({ 'Alpha-tocopherol (mg)': '' }).nutrients.vitaminE, undefined);
});

test('foods are joined across sheets, and only the dish groups count as dishes', () => {
  const foods = cofidFoods(sheets([{ code: '15-146' }, { code: '11-1081', group: 'AP' }]));
  assert.deepEqual(foods.map((f) => [f.code, f.group in DISH_GROUPS]), [['15-146', true], ['11-1081', false]]);
  assert.equal(foods[0].cells['inorg:Sodium (mg)'], '250');
});

test('ids are stable, reversible and above every USDA id', () => {
  assert.equal(cofidId('15-146'), 800_150_146);
  assert.equal(cofidId('11-1081'), 800_111_081);
  assert.throws(() => cofidId('abc'), /unexpected CoFID food code/);
});

test('unexpected values, a missing column or a different file fail loudly', () => {
  assert.throws(() => cofidNumber('12,5'), /unexpected CoFID value/);
  const s = sheets([{ code: '15-001' }]);
  s['1.4 Inorganics'] = s['1.4 Inorganics'].map((row) => row.slice(0, 8));
  assert.throws(() => convertCofid(cofidFoods(s)[0]), /CoFID column "Potassium \(mg\)"/);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cofid-')), 'other.xlsx');
  fs.writeFileSync(file, 'different file');
  assert.throws(() => verifyCofidFile(file), /not the pinned CoFID 2021 workbook/);
});
