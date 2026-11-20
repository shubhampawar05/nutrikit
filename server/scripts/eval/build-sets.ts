// Builds the estimate benchmark (data/eval/sets/{A,B,C,P}.json) from the hand-reviewed source files beside them.
// The source files hold only ids, codes, phrases and reasons; every value here is read from the data itself:
// foods.db (USDA, INDB, cited recipes) and the pinned CoFID 2021 workbook (data/raw/cofid, checked by SHA-256).
//
//   npm run eval:sets -w server
//
// Each output carries its source version and a SHA-256 of its content, which every eval result records, so a
// result can always be traced to the exact references it was scored against.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foods, getFood } from '../../src/domain/db.ts';
import { readXlsx } from '../xlsx.mjs';
import { COFID_SOURCE, cofidFoods, convertCofid, verifyCofidFile } from '../cofid.mjs';
import { consensus, type Values } from './metrics.ts';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SETS = path.join(ROOT, 'data/eval/sets');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(SETS, f), 'utf8'));
const USDA = new Set(['survey', 'sr_legacy', 'foundation']);

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const catalogBuild = () => (foods().prepare("SELECT value FROM meta WHERE key = 'built_at'").get() as { value: string }).value;

function write(name: string, body: object) {
  const content = JSON.stringify(body, null, 2);
  const out = { ...body, sha256: sha256(content) };
  fs.writeFileSync(path.join(SETS, `${name}.json`), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

const values = (n: Record<string, number | undefined>): Values => ({ calories: n.calories!, protein: n.protein ?? null, carbs: n.carbs ?? null, fat: n.fat ?? null });

// CoFID: every food in the workbook (the catalog keeps only its dishes), by code.
const cofidFile = path.join(ROOT, 'data/raw/cofid', COFID_SOURCE.file);
verifyCofidFile(cofidFile);
const cofid = new Map(cofidFoods(readXlsx(cofidFile)).map((f: { code: string; name: string; description: string }) => [f.code, f]));

type Ref = { family: 'usda' | 'cofid' | 'indb'; id?: number; code?: string; note?: string };
function resolve(ref: Ref) {
  if (ref.family === 'cofid') {
    const f = cofid.get(ref.code!);
    if (!f) throw new Error(`CoFID ${ref.code} is not in the workbook`);
    return { ...ref, name: f.name, description: f.description, values: values(convertCofid(f).nutrients) };
  }
  const f = getFood(ref.id!);
  if (!f) throw new Error(`${ref.family} food ${ref.id} is not in foods.db`);
  const ok = ref.family === 'usda' ? USDA.has(f.source) : f.source === 'indb';
  if (!ok) throw new Error(`food ${ref.id} (${f.name}) is ${f.source}, not ${ref.family}`);
  return { ...ref, name: f.name, source: f.source, values: values(f.per100g as Record<string, number>) };
}

// --- Set A: consensus references
const aSrc = read('A.source.json');
const keys = new Set<string>();
const dishes = aSrc.dishes.map((d: { key: string; query: string; detailed: string; hide: string; refs: Ref[]; excludedRefs?: Ref[] }) => {
  if (keys.has(d.key)) throw new Error(`set A lists ${d.key} twice`);
  keys.add(d.key);
  const fams = d.refs.map((r) => r.family);
  if (new Set(fams).size !== fams.length) throw new Error(`${d.key}: one reference per family`);
  new RegExp(d.hide, 'i'); // a bad pattern fails the build, not the eval
  const refs = d.refs.map(resolve);
  return { key: d.key, query: d.query, detailed: d.detailed, hide: d.hide, refs, excludedRefs: d.excludedRefs ?? [], reference: consensus(refs.map((r) => r.values)) };
});
const A = write('A', { set: 'A', version: aSrc.version, title: aSrc.title, rules: aSrc.rules, catalogBuild: catalogBuild(), cofidSha256: COFID_SOURCE.sha256, dishes, notCovered: aSrc.notCovered });

// --- Set B: cited recipes with no yield assumption
const bSrc = read('B.source.json');
const recipes = bSrc.recipes.map((r: { file: string; noCooking: string }) => {
  const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/recipes', r.file), 'utf8'));
  const inGrams = recipe.ingredients.reduce((s: number, i: { grams: number }) => s + i.grams, 0) + (recipe.water ?? 0);
  if (Math.abs(recipe.cookedGrams - inGrams) > 0.01 * inGrams) throw new Error(`${r.file}: cooked weight ${recipe.cookedGrams} g is not the ${inGrams} g that goes in`);
  const food = getFood(recipe.id);
  if (!food) throw new Error(`${r.file}: recipe ${recipe.id} is not in foods.db`);
  const v = values(food.per100g as Record<string, number>);
  return {
    key: r.file.replace(/\.json$/, ''), query: recipe.aliases?.[0] ?? recipe.name, detailed: recipe.name, hide: recipe.aliases?.length ? recipe.aliases.map((a: string) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') : recipe.name,
    noCooking: r.noCooking, source: recipe.source, id: recipe.id,
    reference: { kind: 'point', calories: v.calories, macros: { protein: v.protein, carbs: v.carbs, fat: v.fat }, low: v.calories, high: v.calories },
  };
});
const B = write('B', { set: 'B', version: bSrc.version, title: bSrc.title, rules: bSrc.rules, catalogBuild: catalogBuild(), dishes: recipes, excludedRecipes: bSrc.excludedRecipes });

// --- Set C: phrases for set A dishes
const cSrc = read('C.source.json');
for (const p of cSrc.phrases) {
  for (const k of p.items ?? [p.dish]) if (k != null && !keys.has(k)) throw new Error(`set C phrase "${p.text}" names unknown dish ${k}`);
  if (!p.items && p.dish == null && !('expect' in p)) throw new Error(`set C phrase "${p.text}" needs a dish or an expect pattern`);
  if (p.expect) new RegExp(p.expect, 'i'); // a bad pattern fails the build
}
const C = write('C', { set: 'C', version: cSrc.version, title: cSrc.title, rules: cSrc.rules, aVersion: A.version, aSha256: A.sha256, phrases: cSrc.phrases });

// --- Set P: portion weights
const pSrc = read('P.source.json');
const portionRow = foods().prepare('SELECT label, grams FROM portions WHERE food_id = ? AND label = ?');
const portions = pSrc.portions.map((p: { phrase: string; dish: string; hide?: string; id: number; label: string }) => {
  const food = getFood(p.id);
  if (!food || !USDA.has(food.source)) throw new Error(`set P: ${p.id} is not a USDA food in foods.db`);
  const row = portionRow.get(p.id, p.label) as { label: string; grams: number } | undefined;
  if (!row) throw new Error(`set P: ${food.name} has no portion "${p.label}"`);
  const hide = p.hide ?? dishes.find((d: { key: string }) => d.key === p.dish)?.hide;
  if (!hide) throw new Error(`set P: ${p.phrase} needs a hide pattern (its dish is not in set A)`);
  return { phrase: p.phrase, dish: p.dish, hide, food: { id: food.id, name: food.name, source: food.source }, label: row.label, grams: row.grams };
});
const P = write('P', { set: 'P', version: pSrc.version, title: pSrc.title, rules: pSrc.rules, catalogBuild: catalogBuild(), portions });

// --- Set D: everyday regression gate (expected behavior per phrase; see D.source.json rules)
const dSrc = read('D.source.json');
const allNames = (foods().prepare('SELECT name FROM foods').all() as { name: string }[]).map((r) => r.name);
const phrasesSeen = new Set<string>();
for (const c of dSrc.cases) {
  if (phrasesSeen.has(c.phrase)) throw new Error(`set D lists "${c.phrase}" twice`);
  phrasesSeen.add(c.phrase);
  if (!['log', 'suggest', 'flag'].includes(c.expect?.behavior)) throw new Error(`set D "${c.phrase}": behavior must be log, suggest or flag`);
  if (c.expect.behavior === 'log' && !c.expect.items?.length) throw new Error(`set D "${c.phrase}": a log case needs items`);
  if (c.expect.ask && (c.expect.behavior !== 'log' || !c.expect.ask.every((a: string) => typeof a === 'string' && a))) throw new Error(`set D "${c.phrase}": ask lists foods to ask about in a log case`);
  if (c.expect.uncertain !== undefined && (c.expect.uncertain !== true || !c.expect.ask?.length)) throw new Error(`set D "${c.phrase}": uncertain is true, only on a log case that asks about a food`);
  for (const it of c.expect.items ?? []) {
    const re = new RegExp(it.food, 'i');
    if (!allNames.some((n) => re.test(n))) throw new Error(`set D "${c.phrase}": no catalog food matches ${it.food}, so the case can't expect it to be logged`);
    // Each alternative must name a catalog food on its own, so a misspelt alternative can't hide behind a valid one.
    for (const alt of it.food.split('|')) {
      if (!allNames.some((n) => new RegExp(alt, 'i').test(n))) throw new Error(`set D "${c.phrase}": alternative ${alt} matches no catalog food`);
    }
    if (it.grams && !(it.grams[0] <= it.grams[1])) throw new Error(`set D "${c.phrase}": bad grams range`);
  }
  if (c.expect.behavior === 'log' && !c.rationale) throw new Error(`set D "${c.phrase}": needs a rationale`);
}
const D = write('D', { set: 'D', version: dSrc.version, title: dSrc.title, rules: dSrc.rules, catalogBuild: catalogBuild(), cases: dSrc.cases });
console.log(`D v${D.version}: ${dSrc.cases.length} cases sha256 ${D.sha256.slice(0, 12)}`);

const kinds = (ds: { reference: { kind: string } }[]) => Object.fromEntries(['point', 'range', 'excluded'].map((k) => [k, ds.filter((d) => d.reference.kind === k).length]));
console.log(`A v${A.version}: ${dishes.length} dishes ${JSON.stringify(kinds(dishes))} sha256 ${A.sha256.slice(0, 12)}`);
console.log(`B v${B.version}: ${recipes.length} recipes (${bSrc.excludedRecipes.length} excluded) sha256 ${B.sha256.slice(0, 12)}`);
console.log(`C v${C.version}: ${cSrc.phrases.length} phrases sha256 ${C.sha256.slice(0, 12)}`);
console.log(`P v${P.version}: ${portions.length} portions sha256 ${P.sha256.slice(0, 12)}`);
for (const d of dishes) {
  const r = d.reference;
  console.log(`  ${r.kind.padEnd(8)} ${d.key.padEnd(20)} ${d.refs.map((x: { family: string; values: Values }) => `${x.family}:${Math.round(x.values.calories)}`).join(' ')}`);
}
