// Set C food matching, measured locally: rules-based logging only, no AI and no API call.
//
//   node --import tsx scripts/eval/matching.ts [--json out.json]
//
// Each expected food in each phrase is one of:
//   matched           a logged item is the right food
//   WRONG             something was logged that is not the right food (a silent wrong match)
//   suggested         nothing logged; the first suggestion is the right food (didYouMean or a near match)
//   wrong-suggestion  nothing logged; the first suggestion is not the right food
//   missed            nothing logged, nothing suggested
//   correctly-unlogged  the catalog has no right food (`expect: null`) and nothing was logged
// The right food is the phrase's `expect` pattern when given, else its set A dish (refs or name pattern).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logText } from '../../src/domain/textlog.ts';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const A = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eval/sets/A.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eval/sets/C.json'), 'utf8'));
const dishes = new Map<string, any>(A.dishes.map((d: any) => [d.key, d]));
type Food = { id: number; name: string };
const judge = (key: string | null, expect: string | null | undefined) => (food: Food) => {
  if (expect) return new RegExp(expect, 'i').test(food.name);
  const d = dishes.get(key!);
  return d.refs.some((r: any) => r.id === food.id) || new RegExp(d.hide, 'i').test(food.name);
};

const rows = C.phrases.flatMap((p: any) => {
  const r = logText(p.text);
  const targets: { key: string | null; expect: string | null | undefined }[] = p.items
    ? p.items.filter(Boolean).map((k: string) => ({ key: k, expect: undefined }))
    : [{ key: p.dish ?? null, expect: 'expect' in p ? p.expect : undefined }];
  const base = { phrase: p.text, kind: p.kind };
  return targets.map(({ key, expect }) => {
    const label = expect === null ? '(no right food in catalog)' : key ?? expect;
    if (expect === null) {
      return r.items.length ? { ...base, dish: label, outcome: 'wrong', food: r.items.map((i: any) => i.food.name).join('; ') } : { ...base, dish: label, outcome: 'correctly-unlogged', food: null };
    }
    const right = judge(key, expect);
    const hit = r.items.find((i: any) => right(i.food));
    if (hit) return { ...base, dish: label, outcome: 'matched', food: hit.food.name };
    // A multi-item phrase logs its other foods too; only an item that is no expected food counts as wrong there.
    const others = p.items ? r.items.filter((i: any) => !p.items.filter(Boolean).some((k: string) => judge(k, undefined)(i.food))) : r.items;
    if (others.length && (!p.items || r.items.length >= p.items.length)) return { ...base, dish: label, outcome: 'wrong', food: others.map((i: any) => i.food.name).join('; ') };
    const first = r.unmatched.flatMap((u: any) => (u.suggestions ?? []).slice(0, 1))[0];
    const dym = r.unmatched.map((u: any) => u.didYouMean).filter(Boolean).join('; ') || null;
    if (first) return { ...base, dish: label, outcome: right(first) ? 'suggested' : 'wrong-suggestion', food: first.name, didYouMean: dym };
    return { ...base, dish: label, outcome: 'missed', food: null, didYouMean: dym };
  });
});

const OUTCOMES = ['matched', 'correctly-unlogged', 'wrong', 'suggested', 'wrong-suggestion', 'missed'];
const count = (o: string, rs = rows) => rs.filter((r: any) => r.outcome === o).length;
console.log(`set C v${C.version} (${C.sha256.slice(0, 12)}): ${rows.length} expected foods`);
console.log('  ' + OUTCOMES.map((o) => `${o === 'wrong' ? 'WRONG FOOD LOGGED' : o} ${count(o)}`).join('  '));
const suggestedTotal = count('suggested') + count('wrong-suggestion');
console.log(`  suggestion accuracy: ${count('suggested')}/${suggestedTotal}`);
for (const k of [...new Set(rows.map((r: any) => r.kind))] as string[]) {
  const rs = rows.filter((r: any) => r.kind === k);
  console.log(`  ${k.padEnd(9)} ${OUTCOMES.map((o) => `${o} ${count(o, rs)}`).join(', ')}`);
}
for (const r of rows) if (r.outcome !== 'matched' && r.outcome !== 'correctly-unlogged') console.log(`  ${r.outcome.padEnd(16)} ${JSON.stringify(r.phrase).padEnd(32)} -> ${r.food ?? '-'}${r.didYouMean ? `  (didYouMean: ${r.didYouMean})` : ''}`);
const out = process.argv.indexOf('--json');
if (out > 0) fs.writeFileSync(process.argv[out + 1], `${JSON.stringify({ set: { version: C.version, sha256: C.sha256 }, rows }, null, 2)}\n`);
