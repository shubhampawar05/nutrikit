// The read-only food catalog (data/foods.db, built by scripts/build-db.mjs).
// The writable application store lives in Postgres (see ../pg.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { Food, Portion } from './types.ts';

export type { Food, Portion } from './types.ts';

interface FoodRow {
  id: number;
  name: string;
  source: string;
  category: string | null;
  nutrients: string; // JSON per-100 g map
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let foodsDb: DatabaseSync | undefined;
export function foods(): DatabaseSync {
  if (!foodsDb) {
    const file = path.join(ROOT, 'data/foods.db');
    if (!fs.existsSync(file)) throw new Error('data/foods.db missing - run `npm run build:db` first');
    foodsDb = new DatabaseSync(file, { readOnly: true });
  }
  return foodsDb;
}

// Shape a foods row (+ optional portions) for API output.
export function getFood(id: number | string): Food | null {
  const row = foods().prepare('SELECT id, name, source, category, nutrients FROM foods WHERE id = ?').get(Number(id)) as FoodRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    category: row.category,
    per100g: JSON.parse(row.nutrients),
    portions: (foods().prepare('SELECT label, amount, unit, grams FROM portions WHERE food_id = ? ORDER BY seq').all(row.id) as unknown as Portion[])
      .map((p) => ({ label: p.label, amount: p.amount, unit: p.unit, grams: p.grams })),
  };
}
