// Open Food Facts label checks (src/domain/barcode.ts) and the packaged-foods store built from an export
// (scripts/build-packaged.mjs, src/domain/packaged.ts), on small fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fromOpenFoodFacts, labelIssues, lookupBarcode, offImagePath } from '../src/domain/barcode.ts';
import { packagedByBarcode, packagedSource, resetPackaged, searchPackaged } from '../src/domain/packaged.ts';
import { fromExportRecord, frontImage } from '../scripts/build-packaged.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrikit-packaged-'));
after(() => { resetPackaged(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('consistent labels pass; mistyped ones are caught', () => {
  assert.deepEqual(labelIssues({ calories: 478, protein: 7, carbs: 72, fat: 18, sugar: 3, saturatedFat: 8.6 }, '100g'), []);
  assert.deepEqual(labelIssues({ calories: 0, protein: 0, carbs: 100, fat: 0 }, '100g'), [], 'erythritol: all carbohydrate, no energy');
  assert.deepEqual(labelIssues({ calories: 884, protein: 0, carbs: 0, fat: 100 }, '100g'), []);
  assert.match(labelIssues({ calories: 2000, protein: 8, carbs: 60, fat: 20 }, '100g')[0], /more than pure fat/, 'kJ typed as kcal');
  assert.match(labelIssues({ calories: 969, protein: 25.5, carbs: 242, fat: 76.5 }, '100g').join(), /add up to 344 g/);
  assert.match(labelIssues({ calories: 217, protein: 6.4, carbs: 54.2, fat: 34.7 }, '100g')[0], /does not match/);
  assert.match(labelIssues({ calories: 300, protein: 2, carbs: 10, fat: 30, sugar: 20 }, '100g').join(), /sugars exceed/);
  assert.match(labelIssues({ calories: 50, protein: -1, carbs: 10, fat: 1 }, '100g')[0], /negative/);
});

test('per-serving labels are allowed their rounding, scaled to 100 g', () => {
  // 130 kcal and 14 g fat per 15 ml tablespoon of coconut oil: 867-933 kcal per 100 ml after rounding.
  const oil = { calories: 866.7, protein: 0, carbs: 0, fat: 93.3 };
  assert.deepEqual(labelIssues({ ...oil, calories: 909 }, '100ml', 15), []);
  assert.match(labelIssues({ ...oil, calories: 909 }, '100ml')[0], /more than pure fat/, 'no allowance for labels given per 100 g');
  assert.deepEqual(labelIssues({ calories: 300, protein: 5, carbs: 100, fat: 0 }, '100g', 20), [], '1 g of carbohydrate in a 20 g pouch');
});

test('only label values are used: OFF estimates ("~") are dropped, sodium comes from salt', () => {
  const p = fromOpenFoodFacts({ code: '0000101209159', serving_quantity: 15, nutriments: {
    'energy-kcal_100g': 617, proteins_100g: 8, carbohydrates_100g: 36, fat_100g: 48, sugars_100g: 32,
    'added-sugars_100g': 13.83, 'added-sugars_modifier': '~', salt_100g: 0.01, sodium_100g: 0.004, sodium_modifier: '~',
  } });
  assert.equal(p.per100g.addedSugar, undefined, 'the added-sugar estimate is not a label value');
  assert.equal(p.per100g.sodium, 4, 'salt / 2.5, in mg');
  assert.deepEqual(p.issues, []);
  assert.equal(p.perServing.calories.amount, 93);
  const bad = fromOpenFoodFacts({ code: '1', nutriments: { 'energy-kcal_100g': 960, proteins_100g: 32, carbohydrates_100g: 240, fat_100g: 112 } });
  assert.deepEqual([bad.per100g, bad.perServing], [{}, null], 'contradicting values are withheld, not served');
  assert.equal(bad.issues.length, 2);
});

test('liquids are per 100 ml, and a serving converts only in the same unit', () => {
  const juice = fromOpenFoodFacts({ code: '2', serving_quantity: 200, serving_quantity_unit: 'ml', nutriments: { 'energy-kcal_100g': 59, proteins_100g: 0, carbohydrates_100g: 14.7, fat_100g: 0 } });
  assert.equal(juice.basis, '100ml');
  assert.deepEqual([juice.servingMl, juice.servingGrams, juice.perServing.calories.amount], [200, null, 118]);
  const mixed = fromOpenFoodFacts({ code: '3', serving_quantity: 250, serving_quantity_unit: 'ml', nutriments: { 'energy-kcal_100g': 60 } }, '100g');
  assert.equal(mixed.perServing, null, 'ml serving, per-100 g values: no density to convert');
});

const record = (over = {}) => ({
  code: '8901063154025', product_name: 'Ragi cookies', brands: 'Britannia', lang: 'en', countries_tags: ['en:india'],
  serving_size: '20 g', serving_quantity: 20, serving_quantity_unit: 'g', unique_scans_n: 40, last_modified_t: 1780000000,
  images: { selected: { front: { en: { rev: '7' } } } },
  nutrition: { aggregated_set: { per: '100g', preparation: 'as_sold', nutrients: {
    'energy-kcal': { source: 'packaging', value: 478, unit: 'kcal', source_per: '100g' },
    proteins: { source: 'packaging', value: 7, unit: 'g' }, carbohydrates: { source: 'packaging', value: 72, unit: 'g' },
    fat: { source: 'packaging', value: 18, unit: 'g' },
    'added-sugars': { source: 'estimate', value: 2, unit: 'g', modifier: '~' },
  } } },
  ...over,
});

test('export records: label sources only, prepared-only values and bad barcodes are skipped', () => {
  const { product } = fromExportRecord(record());
  assert.deepEqual(product.per100g, { calories: 478, protein: 7, fat: 18, carbs: 72 });
  assert.equal(product.imageUrl, 'https://images.openfoodfacts.org/images/products/890/106/315/4025/front_en.7.200.jpg');
  assert.equal(offImagePath('96385074'), '96385074');
  assert.equal(frontImage({ code: '1', images: {} }), undefined);
  assert.match(fromExportRecord(record({ code: '8901063154026' })).skipped, /invalid barcode/);
  assert.match(fromExportRecord(record({ product_name: '' })).skipped, /no name/);
  const prepared = record(); prepared.nutrition.aggregated_set.preparation = 'prepared';
  assert.match(fromExportRecord(prepared).skipped, /prepared/);
  assert.match(fromExportRecord(record({ nutrition: null, nutriments: { 'energy-kcal_100g': 400 } })).skipped, /no label energy/);
});

test('the build stores checked products, and lookups and search read them', async () => {
  const lines = [
    record(),
    record({ code: '0012000161155', product_name: 'Diet Cola', brands: 'Pepsi', countries_tags: ['en:united-states'], unique_scans_n: 9 }),
    record({ code: '4006381333931', product_name: 'Bad label', countries_tags: ['en:united-states'], nutrition: null, nutriments: { 'energy-kcal_100g': 960, proteins_100g: 32, carbohydrates_100g: 240, fat_100g: 112 } }),
    record({ code: '3017624010701', product_name: 'French only', countries_tags: ['en:france'] }),
  ];
  const input = path.join(TMP, 'export.jsonl');
  fs.writeFileSync(input, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const out = path.join(TMP, 'packaged.db');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-packaged.mjs', input, '--out', out], { cwd: ROOT, stdio: 'pipe' });
  process.env.NUTRIKIT_PACKAGED_DB = out;
  resetPackaged();

  const source = packagedSource();
  assert.equal(source.products, 2);
  assert.deepEqual(source.skipped, { 'label values contradict each other': 1 });
  assert.equal(packagedByBarcode('012000161155').name, 'Diet Cola', 'a 12-digit UPC finds its 13-digit EAN form');
  assert.equal(packagedByBarcode('4006381333931'), null, 'contradicting labels are not stored');
  assert.equal(packagedByBarcode('8901063154025').perServing.calories.amount, 96, 'per serving is computed on read');
  assert.deepEqual(searchPackaged('ragi cook').results.map((p) => p.name), ['Ragi cookies'], 'word prefixes');
  assert.deepEqual(searchPackaged('britannia', { country: 'us' }).results, []);
  assert.equal(searchPackaged('pepsi', { country: 'us' }).total, 1, 'brands are searchable');
  const hit = await lookupBarcode(null, '8901063154025');
  assert.deepEqual([hit.found, hit.local, hit.product.name], [true, true, 'Ragi cookies'], 'barcodes are served locally first');
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-packaged.mjs', input, '--out', path.join(TMP, 'foods.db')], { cwd: ROOT, stdio: 'pipe' }), /never write it into foods.db/);
});
