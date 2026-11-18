// Checks recipe files against the built catalog without rebuilding it: the same validation and composition as the
// build (scripts/recipes.mjs), printing each dish's nutrients per 100 g and per portion.
// Usage: node --import tsx scripts/check-recipe.mjs data/recipes/poha.json [more.json ...]
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { composeRecipe } from './recipes.mjs';
import { NUTRIENTS } from '../src/domain/nutrients.ts';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = new DatabaseSync(path.join(ROOT, 'data/foods.db'), { readOnly: true });
const get = db.prepare("SELECT name, nutrients FROM foods WHERE id = ? AND source <> 'recipe'");
const findFood = (id) => {
  const row = get.get(id);
  return row ? { name: row.name, n: JSON.parse(row.nutrients) } : undefined;
};
let failed = 0;
for (const file of process.argv.slice(2)) {
  try {
    const recipe = { file: path.basename(file), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    const r = composeRecipe(recipe, findFood, NUTRIENTS.map((n) => n.key));
    const n = r.nutrients;
    console.log(`OK ${r.name}: per 100 g ${n.calories} kcal, P ${n.protein} C ${n.carbs} F ${n.fat}`);
    for (const p of r.portions) console.log(`   ${p.label} = ${p.grams} g -> ${Math.round((n.calories * p.grams) / 100)} kcal`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${file}: ${err.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
