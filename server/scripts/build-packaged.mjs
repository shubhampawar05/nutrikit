// Builds data/packaged.db: packaged foods sold in India or the US, from an Open Food Facts JSONL export
// (https://world.openfoodfacts.org/data, database under ODbL 1.0, contents under DbCL 1.0).
//
//   node --import tsx scripts/build-packaged.mjs <openfoodfacts-products.jsonl> [--out data/packaged.db]
//
// The export is read one line at a time (it is ~80 GB), and only lines tagged with a target country are parsed.
// A product is kept when it has a valid barcode, a name, and label values for energy, protein, carbohydrate and
// fat that agree with each other (labelIssues in src/domain/barcode.ts). Only values printed on the label are
// used: OFF's own estimates are dropped. The file is a separate ODbL database, never merged into data/foods.db.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fromOpenFoodFacts, isValidGtin, offImagePath } from '../src/domain/barcode.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const OFF_SOURCE = {
  name: 'Open Food Facts',
  url: 'https://world.openfoodfacts.org/data',
  license: 'ODbL 1.0 (database), DbCL 1.0 (contents)',
  attribution: 'Data from Open Food Facts contributors, https://world.openfoodfacts.org',
};
export const COUNTRY_TAGS = { 'en:india': 'in', 'en:united-states': 'us' };
// OFF records each nutrient's origin; label values are typed from the package or sent by the manufacturer.
const LABEL_SOURCES = new Set(['packaging', 'manufacturer']);
const LABEL_UNITS = new Set(['g', 'kcal', 'kJ']); // the export normalises masses to grams
const IMAGES = 'https://images.openfoodfacts.org/images/products';
const CORE = ['calories', 'protein', 'carbs', 'fat'];

/** The front image OFF selected, preferring the product's own language, then English. */
export function frontImage(record) {
  const selected = record.images?.selected?.front ?? {};
  const lc = [record.lang, 'en', ...Object.keys(selected)].find((l) => l && selected[l]?.rev);
  return lc ? `${IMAGES}/${offImagePath(record.code)}/front_${lc}.${selected[lc].rev}.200.jpg` : undefined;
}

/**
 * One export record -> { product } or { skipped: reason }.
 * Newer records carry per-nutrient sources (nutrition.aggregated_set); older ones only the flat nutriments, where
 * OFF's computed values are marked with the "~" modifier (handled by fromOpenFoodFacts).
 */
export function fromExportRecord(record) {
  const code = String(record.code ?? '');
  if (!isValidGtin(code)) return { skipped: 'invalid barcode' };
  const name = (record.product_name || record.product_name_en || '').trim();
  if (!name) return { skipped: 'no name' };
  const agg = record.nutrition?.aggregated_set;
  let nutriments = record.nutriments ?? {};
  let basis, per = record.nutrition_data_per;
  if (agg?.nutrients && Object.keys(agg.nutrients).length) {
    if (agg.preparation !== 'as_sold') return { skipped: 'values for the prepared food only' };
    if (agg.per !== '100g' && agg.per !== '100ml') return { skipped: `values per ${agg.per ?? "an unstated amount"}` };
    basis = agg.per;
    per = ['energy-kcal', 'proteins', 'carbohydrates', 'fat'].some((k) => agg.nutrients[k]?.source_per === 'serving') ? 'serving' : agg.per;
    nutriments = {};
    for (const [key, v] of Object.entries(agg.nutrients)) {
      if (!LABEL_SOURCES.has(v.source) || !LABEL_UNITS.has(v.unit)) continue;
      nutriments[`${key}_100g`] = v.value;
      if (v.modifier) nutriments[`${key}_modifier`] = v.modifier;
    }
  }
  const product = fromOpenFoodFacts({
    code, product_name: name, brands: record.brands, quantity: record.quantity,
    product_quantity_unit: record.product_quantity_unit, serving_size: record.serving_size,
    serving_quantity: record.serving_quantity, serving_quantity_unit: record.serving_quantity_unit, nutrition_data_per: per,
    image_front_small_url: frontImage(record), last_modified_t: record.last_modified_t, nutriments,
  }, basis);
  if (product.issues.length) return { skipped: 'label values contradict each other' };
  if (!CORE.every((k) => product.per100g[k] != null)) return { skipped: 'no label energy, protein, carbohydrate and fat' };
  return { product };
}

const COUNTRIES_RE = /"countries_tags":\[([^\]]*)\]/;
const countriesOf = (line) => {
  const tags = COUNTRIES_RE.exec(line)?.[1];
  return tags ? Object.entries(COUNTRY_TAGS).filter(([tag]) => tags.includes(`"${tag}"`)).map(([, c]) => c) : [];
};

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = path.resolve(ROOT, outAt >= 0 ? args[outAt + 1] : 'data/packaged.db');
  const [input] = args.filter((a, i) => !a.startsWith('--') && !(outAt >= 0 && i === outAt + 1));
  if (!input || !fs.existsSync(input)) throw new Error('usage: build-packaged.mjs <openfoodfacts-products.jsonl> [--out data/packaged.db]');
  if (path.basename(out) === 'foods.db') throw new Error('Open Food Facts data is a separate ODbL database: never write it into foods.db');

  const tmp = `${out}.tmp`;
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE products (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT,
      country_in INTEGER NOT NULL, country_us INTEGER NOT NULL,
      scans INTEGER NOT NULL, last_modified INTEGER NOT NULL,
      payload TEXT NOT NULL -- the BarcodeProduct served by the API
    );`);
  // A code seen twice keeps its most recently edited record.
  const insert = db.prepare(`INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (code) DO UPDATE SET name = excluded.name, brand = excluded.brand, country_in = excluded.country_in,
      country_us = excluded.country_us, scans = excluded.scans, last_modified = excluded.last_modified, payload = excluded.payload
    WHERE excluded.last_modified > products.last_modified`);

  const counts = { lines: 0, inScope: { in: 0, us: 0 }, stored: { in: 0, us: 0 }, skipped: {} };
  let newest = 0, pending = 0;
  const started = Date.now();
  db.exec('BEGIN');
  const lines = readline.createInterface({ input: fs.createReadStream(input, { highWaterMark: 1 << 22 }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (++counts.lines % 500_000 === 0) console.error(`${counts.lines.toLocaleString()} lines, ${Math.round((Date.now() - started) / 1000)} s`);
    const countries = countriesOf(line);
    if (!countries.length) continue;
    let record;
    try { record = JSON.parse(line); } catch { counts.skipped['unreadable line'] = (counts.skipped['unreadable line'] ?? 0) + 1; continue; }
    for (const c of countries) counts.inScope[c]++;
    newest = Math.max(newest, record.last_modified_t ?? 0);
    const { product, skipped } = fromExportRecord(record);
    if (skipped) { counts.skipped[skipped] = (counts.skipped[skipped] ?? 0) + 1; continue; }
    for (const c of countries) counts.stored[c]++;
    insert.run(product.barcode, product.name, product.brand, +countries.includes('in'), +countries.includes('us'),
      Number(record.unique_scans_n) || 0, record.last_modified_t ?? 0, JSON.stringify({ ...product, perServing: undefined }));
    if (++pending === 50_000) { db.exec('COMMIT; BEGIN'); pending = 0; }
  }
  db.exec('COMMIT');

  db.exec(`
    CREATE VIRTUAL TABLE products_fts USING fts5(name, brand, content='products', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    INSERT INTO products_fts(products_fts) VALUES ('rebuild');`);
  const total = db.prepare('SELECT count(*) n FROM products').get().n;
  const source = {
    ...OFF_SOURCE, file: path.basename(input), bytes: fs.statSync(input).size,
    newestEdit: newest ? new Date(newest * 1000).toISOString().slice(0, 10) : null,
    builtAt: new Date().toISOString(), products: total, ...counts,
  };
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('source', JSON.stringify(source));
  db.exec('VACUUM');
  db.close();
  fs.renameSync(tmp, out);
  console.log(JSON.stringify({ out: path.relative(ROOT, out), ...source }, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
