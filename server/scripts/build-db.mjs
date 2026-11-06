// Builds data/foods.db from USDA FoodData Central CSV releases (public domain, CC0).
//
//   node scripts/build-db.mjs            (expects the extracted releases under data/raw/)
//
// Datasets: SR Legacy (generic foods), FNDDS survey foods (dishes "as eaten"),
// Foundation Foods (recent analytical data). Nutrient values are stored per 100 g.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { NUTRIENTS } from '../src/domain/nutrients.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'data/foods.db');

const DATASETS = [
  { dir: 'FoodData_Central_survey_food_csv_2024-10-31', source: 'survey', types: ['survey_fndds_food'] },
  { dir: 'FoodData_Central_foundation_food_csv_2026-04-30', source: 'foundation', types: ['foundation_food'] },
  { dir: 'FoodData_Central_sr_legacy_food_csv_2018-04', source: 'sr_legacy', types: ['sr_legacy_food'] },
];

// RFC 4180 CSV (quoted fields, "" escapes, embedded newlines) -> array of objects.
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const csv = (dir, name) => {
  const file = path.join(RAW, dir, `${name}.csv`);
  return fs.existsSync(file) ? readCsv(file) : [];
};

// Which catalog key each FDC nutrient id feeds, with its priority (lower wins).
const NUTRIENT_SLOTS = new Map();
for (const n of NUTRIENTS) n.fdc.forEach((id, priority) => NUTRIENT_SLOTS.set(id, { key: n.key, priority }));

fs.rmSync(OUT, { force: true });
const db = new DatabaseSync(OUT);
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  CREATE TABLE foods (
    id INTEGER PRIMARY KEY,          -- USDA fdc_id
    name TEXT NOT NULL,
    source TEXT NOT NULL,            -- survey | foundation | sr_legacy
    category TEXT,
    nutrients TEXT NOT NULL          -- JSON {key: amount per 100 g}
  );
  CREATE TABLE portions (
    food_id INTEGER NOT NULL REFERENCES foods(id),
    seq INTEGER NOT NULL,
    label TEXT NOT NULL,             -- e.g. "1 cup, chopped", "1 large"
    amount REAL NOT NULL,            -- how many units the label describes
    unit TEXT,                       -- normalised unit word (cup, tbsp, slice, large, ...)
    grams REAL NOT NULL
  );
  CREATE INDEX portions_food ON portions(food_id, seq);
  CREATE VIRTUAL TABLE foods_fts USING fts5(name, category, content='foods', content_rowid='id',
    tokenize = 'porter unicode61 remove_diacritics 2');
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`);

const insertFood = db.prepare('INSERT INTO foods (id, name, source, category, nutrients) VALUES (?, ?, ?, ?, ?)');
const insertPortion = db.prepare('INSERT INTO portions (food_id, seq, label, amount, unit, grams) VALUES (?, ?, ?, ?, ?, ?)');

const UNIT_ALIASES = {
  cups: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp',
  'fl oz': 'fl oz', 'fluid ounce': 'fl oz', ounce: 'oz', ounces: 'oz', slices: 'slice', pieces: 'piece',
};
const normUnit = (u) => {
  const s = (u || '').toLowerCase().trim();
  return UNIT_ALIASES[s] || s || null;
};

// Same-name foods across datasets: keep the record with values for more Nutrition Facts label nutrients; on a
// tie, the newest data (Foundation, then survey, then SR Legacy). Two records are different samples, so their
// values are never mixed into one food.
const LABEL_KEYS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'saturatedFat', 'cholesterol', 'sodium', 'potassium', 'calcium', 'iron', 'vitaminD'];
const SOURCE_RANK = { foundation: 0, survey: 1, sr_legacy: 2 };
const labelCoverage = (f) => LABEL_KEYS.filter((k) => f.n[k] != null).length;
const better = (a, b) => {
  const ka = labelCoverage(a), kb = labelCoverage(b);
  return ka !== kb ? ka > kb : SOURCE_RANK[a.source] < SOURCE_RANK[b.source];
};

const counts = {};
const kept = new Map(); // lowercase name -> food
let collisions = 0;
let clamped = 0;
for (const ds of DATASETS) {
  const dir = ds.dir;
  const nutrientRows = csv(dir, 'nutrient');
  // Survey files key food_nutrient by nutrient_nbr instead of id; map both to the id.
  const byNbr = new Map(nutrientRows.map((n) => [n.nutrient_nbr, Number(n.id)]));
  const categories = new Map(
    [...csv(dir, 'food_category'), ...csv(dir, 'wweia_food_category')].map((c) => [
      c.id || c.wweia_food_category, c.description || c.wweia_food_category_description,
    ])
  );
  const units = new Map(csv(dir, 'measure_unit').map((u) => [u.id, u.name]));

  const foods = new Map();
  for (const f of csv(dir, 'food')) {
    if (!ds.types.includes(f.data_type)) continue;
    foods.set(f.fdc_id, { id: Number(f.fdc_id), name: f.description.trim(), source: ds.source, category: categories.get(f.food_category_id) || null, n: {}, p: {} });
  }

  for (const fn of csv(dir, 'food_nutrient')) {
    const food = foods.get(fn.fdc_id);
    if (!food || fn.amount === '') continue;
    let id = Number(fn.nutrient_id);
    if (!NUTRIENT_SLOTS.has(id) && byNbr.has(fn.nutrient_id)) id = byNbr.get(fn.nutrient_id);
    const slot = NUTRIENT_SLOTS.get(id);
    if (!slot) continue;
    if (food.p[slot.key] === undefined || slot.priority < food.p[slot.key]) {
      // Carbohydrate "by difference" can round below zero; no nutrient amount is negative.
      const amount = Number(fn.amount);
      if (amount < 0) clamped++;
      food.n[slot.key] = Math.max(0, amount);
      food.p[slot.key] = slot.priority;
    }
  }

  const portions = new Map();
  for (const p of csv(dir, 'food_portion')) {
    if (!foods.has(p.fdc_id) || !Number(p.gram_weight)) continue;
    const unitName = p.measure_unit_id && p.measure_unit_id !== '9999' ? units.get(p.measure_unit_id) : '';
    const amount = Number(p.amount) || 1;
    // Survey portions carry a full description ("1 cup"); SR/Foundation build it from parts.
    let label = p.portion_description && !/^\d+$/.test(p.portion_description) ? p.portion_description : '';
    if (!label) label = [amount, unitName, p.modifier].filter(Boolean).join(' ').replace(/ ,/g, ',');
    // "Quantity not specified" and "Guideline amount per ..." are survey bookkeeping, not servings.
    if (!label || label === 'Quantity not specified' || /^guideline/i.test(label)) continue;
    const unitWord = normUnit(unitName || (label.match(/^[\d./\s]+(fl oz|[a-zA-Z]+)/i) || [])[1]);
    const list = portions.get(p.fdc_id) || [];
    list.push({ seq: Number(p.seq_num) || list.length + 1, label, amount, unit: unitWord, grams: Number(p.gram_weight) });
    portions.set(p.fdc_id, list);
  }

  for (const [fdcId, f] of foods) {
    if (f.n.calories == null) continue; // unusable for logging
    f.portions = (portions.get(fdcId) || []).sort((a, b) => a.seq - b.seq);
    const key = f.name.toLowerCase();
    const prev = kept.get(key);
    if (prev) collisions++;
    if (!prev || better(f, prev)) kept.set(key, f);
  }
}

db.exec('BEGIN');
for (const f of kept.values()) {
  insertFood.run(f.id, f.name, f.source, f.category, JSON.stringify(f.n));
  for (const p of f.portions) insertPortion.run(f.id, p.seq, p.label, p.amount, p.unit, p.grams);
  counts[f.source] = (counts[f.source] ?? 0) + 1;
}
db.exec("INSERT INTO foods_fts(foods_fts) VALUES ('rebuild')");
const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)');
insertMeta.run('built_at', new Date().toISOString());
insertMeta.run('sources', JSON.stringify(DATASETS.map((d) => d.dir)));
insertMeta.run('clamped', String(clamped));
insertMeta.run('collisions', String(collisions));
db.exec('COMMIT');
db.exec('VACUUM');

const totals = db.prepare('SELECT (SELECT count(*) FROM foods) foods, (SELECT count(*) FROM portions) portions').get();
console.log('foods by source', counts, '| totals', { ...totals }, '|', (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
