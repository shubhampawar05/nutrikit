// Accuracy audit of data/foods.db, run after `npm run build:db`:
//
//   npm run audit:data
//
// Prints nutrient sanity checks, coverage by source, portion outliers and how everyday phrases are logged.
// Exits 1 on a broken invariant (a negative value); everything else is a report to read, not a failure,
// since USDA's own values legitimately trip some heuristics (fiber-rich foods and the Atwater check).
import { foods } from '../src/domain/db.ts';
import { logText } from '../src/domain/textlog.ts';
import { NUTRIENTS } from '../src/domain/nutrients.ts';
import type { Per100g } from '../src/domain/types.ts';

interface Row { id: number; name: string; source: string; nutrients: string }
interface PortionRow { food_id: number; label: string; amount: number; unit: string | null; grams: number }

const rows = (foods().prepare('SELECT id, name, source, nutrients FROM foods').all() as unknown as Row[])
  .map((r) => ({ ...r, n: JSON.parse(r.nutrients) as Per100g }));
const pct = (a: number, b: number) => `${Math.round((100 * a) / b)}%`;
const SAMPLE = 6;

// 1. Nutrient sanity
const checks: [string, (n: Per100g) => string | null][] = [
  ['negative value', (n) => Object.entries(n).filter(([, v]) => v < 0).map(([k, v]) => `${k}=${v}`).join(' ') || null],
  // The carbohydrate checks skip foods without a carbohydrate value: missing is reported, not wrong.
  ['calories disagree with 4P + 4C + 9F + 7A by over 25%', (n) => {
    if (n.carbs == null) return null;
    const atwater = 4 * (n.protein ?? 0) + 4 * (n.carbs ?? 0) + 9 * (n.fat ?? 0) + 7 * (n.alcohol ?? 0);
    return Math.abs(atwater - n.calories) > Math.max(30, 0.25 * n.calories) ? `kcal ${n.calories} vs ${atwater.toFixed(0)}` : null;
  }],
  ['sugars exceed carbohydrate', (n) => (n.carbs != null && (n.sugar ?? 0) > n.carbs + 1 ? `sugar ${n.sugar} carbs ${n.carbs}` : null)],
  ['fiber exceeds carbohydrate', (n) => ((n.fiber ?? 0) > (n.carbs ?? 0) + 1 ? `fiber ${n.fiber} carbs ${n.carbs}` : null)],
  ['saturated fat exceeds fat', (n) => ((n.saturatedFat ?? 0) > (n.fat ?? 0) + 0.5 ? `sat ${n.saturatedFat} fat ${n.fat}` : null)],
];
console.log(`\n== Nutrient sanity (${rows.length} foods)`);
let negatives = 0;
for (const [label, check] of checks) {
  const hits = rows.map((r) => ({ r, detail: check(r.n) })).filter((h) => h.detail);
  if (label === 'negative value') negatives = hits.length;
  console.log(`${label}: ${hits.length}`);
  for (const { r, detail } of hits.slice(0, SAMPLE)) console.log(`   ${r.id} ${r.name.slice(0, 60)} | ${detail}`);
}

// 2. Coverage by source
console.log('\n== Nutrient coverage by source (share of foods with a value)');
const sources = [...new Set(rows.map((r) => r.source))];
console.log(`${'nutrient'.padEnd(20)}${sources.map((s) => s.padStart(12)).join('')}`);
for (const def of NUTRIENTS) {
  const cells = sources.map((s) => {
    const of = rows.filter((r) => r.source === s);
    return pct(of.filter((r) => r.n[def.key] != null).length, of.length).padStart(12);
  });
  console.log(`${def.key.padEnd(20)}${cells.join('')}`);
}

// 3. Portions
const portions = foods().prepare('SELECT food_id, label, amount, unit, grams FROM portions').all() as unknown as PortionRow[];
const byFood = new Map<number, PortionRow[]>();
for (const p of portions) byFood.set(p.food_id, [...(byFood.get(p.food_id) ?? []), p]);
const names = new Map(rows.map((r) => [r.id, r.name]));
const CUPS: Record<string, number> = { cup: 1, tbsp: 16, tsp: 48, 'fl oz': 8 };
const dense = [...byFood].flatMap(([id, ps]) => ps
  .filter((p) => CUPS[p.unit ?? ''] && !/\byields\b/i.test(p.label))
  .map((p) => ({ id, label: p.label, perCup: (p.grams / (p.amount || 1)) * CUPS[p.unit!] }))
  .filter((p) => p.perCup > 450 || p.perCup < 8));
console.log('\n== Portions');
console.log(`foods without portions: ${rows.filter((r) => !byFood.has(r.id)).length}`);
console.log(`volume portions outside 8–450 g per cup (excluding dry-yield portions): ${dense.length}`);
for (const d of dense.slice(0, SAMPLE)) console.log(`   ${names.get(d.id)?.slice(0, 50)} | ${d.label} = ${d.perCup.toFixed(0)} g/cup`);

// 4. Everyday phrases, as the logging endpoint resolves them
const PHRASES = [
  '2 eggs', '1 banana', '1 cup rice', '1 slice bread', '1 cup milk', '1 tbsp peanut butter', '1 chicken breast',
  '1 cup coffee', '1 can soda', '1 slice pizza', 'medium fries', '100 g salmon', '1 bagel', '1 cup yogurt', '1 donut',
  '2 rotis', '1 cup dal', '1 naan', '2 idli', '1 dosa', '100 g paneer', 'a cup of chai', '1 samosa', '1 cup chole',
  '1 cup rajma', '1 cup khichdi', '1 plate poha', '1 cup curd', '1 gulab jamun', '1 glass lassi', '1 cup butter chicken',
  'a plate of pav bhaji', '2 aloo parathas', '1 masala dosa',
];
console.log('\n== Everyday phrases');
for (const phrase of PHRASES) {
  const r = logText(phrase);
  const logged = r.items.map((i) => `${i.food.name.slice(0, 50)} · ${Math.round(i.grams)} g · ${Math.round(i.nutrients.calories?.amount ?? 0)} kcal [${i.food.source}, ${i.portionMethod}]`);
  const missed = r.unmatched.map((u) => `unmatched (${u.reason})`);
  console.log(`${phrase.padEnd(24)} ${[...logged, ...missed].join(' + ')}`);
}

if (negatives) {
  console.error(`\n${negatives} foods have negative values; the catalog build should have clamped them.`);
  process.exit(1);
}
