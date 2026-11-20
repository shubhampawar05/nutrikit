// Set D, the everyday regression gate: each phrase is logged the way the app logs it (rules-based, no AI) and judged
// against what SHOULD happen. Three outcomes:
//   correct           the right foods (and, where the case says so, the other foods listed back to ask about), each amount inside its sourced range (when it has one); an amount the case
//                     marks as an assumption (provisional bowl or glass, a NIN serving for a plate) must be labelled
//                     as one on the logged item (portionMethod starting "assumed")
//   safely-uncertain  nothing wrong was logged; a food the phrase names is listed unmatched (a suggestion or a note)
//                     instead of logged: the app said it wasn't sure
//   incorrect         a wrong food, an amount outside its range, an assumed amount not labelled, a food logged that
//                     should have been asked about, a user amount lost from what is listed back, or a food silently
//                     dropped (neither logged nor listed)
//
//   node --import tsx scripts/eval/everyday.ts [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logText } from '../../src/domain/textlog.ts';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export interface EverydayCase {
  phrase: string;
  category: string;
  expect: { behavior: 'log' | 'suggest' | 'flag'; items?: { food: string; grams?: [number, number]; assumption?: boolean }[]; preserve?: string; ask?: string[]; uncertain?: boolean };
  rationale: string;
  source?: string;
  regression?: string;
}
export type Outcome = 'correct' | 'safely-uncertain' | 'incorrect';
export interface Judged { phrase: string; category: string; outcome: Outcome; why: string; logged: { food: string; grams: number }[]; unmatched: string[]; regression?: string }

export function loadSetD(): { version: string; sha256: string; cases: EverydayCase[] } {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eval/sets/D.json'), 'utf8'));
}

/** Cases known to be incorrect today, phrase → the finding or pending rule (data/eval/sets/D.known-incorrect.json). */
export function loadKnownIncorrect(): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eval/sets/D.known-incorrect.json'), 'utf8')).cases;
}

export function judge(c: EverydayCase): Judged {
  const r = logText(c.phrase);
  const logged = r.items.map((i) => ({ food: i.food.name, grams: i.grams }));
  const unmatched = r.unmatched.map((u) => u.text);
  const base = { phrase: c.phrase, category: c.category, logged, unmatched, ...(c.regression ? { regression: c.regression } : {}) };
  const done = (outcome: Outcome, why: string): Judged => ({ ...base, outcome, why });

  if (c.expect.behavior !== 'log') {
    if (logged.length) return done('incorrect', `logged ${logged.map((l) => l.food).join(' + ')} where it should ${c.expect.behavior}`);
    if (!unmatched.length) return done('incorrect', 'nothing logged and nothing listed');
    // The amount the user gave must survive into what is listed back ("100 g chicken" keeps its 100 g).
    const keep = c.expect.preserve && new RegExp(c.expect.preserve.replace(/\s+/g, '\\s*'), 'i');
    if (keep && !unmatched.some((u) => keep.test(u))) return done('incorrect', `lost the amount "${c.expect.preserve}": listed ${unmatched.join(', ')}`);
    return done('correct', c.expect.behavior === 'flag' ? 'flagged' : 'suggested');
  }

  const expected = (c.expect.items ?? []).map((it) => ({ ...it, re: new RegExp(it.food, 'i') }));
  const wrong = r.items.filter((i) => !expected.some((e) => e.re.test(i.food.name)));
  if (wrong.length) return done('incorrect', `wrong food: ${wrong.map((i) => i.food.name).join(' + ')}`);
  const missing = expected.filter((e) => !r.items.some((i) => e.re.test(i.food.name)));
  for (const e of expected) {
    const hit = r.items.find((i) => e.re.test(i.food.name));
    if (hit && e.grams && (hit.grams < e.grams[0] || hit.grams > e.grams[1])) {
      return done('incorrect', `amount: ${hit.food.name} ${hit.grams} g, expected ${e.grams[0]}-${e.grams[1]} g`);
    }
    if (hit && e.assumption && !/^assumed/.test(hit.portionMethod)) {
      return done('incorrect', `assumed amount not labelled: ${hit.food.name} ${hit.grams} g (${hit.portionMethod})`);
    }
  }
  // Foods the phrase names that must be asked about, not logged ("raita" in "2 paratha with raita"): each must be
  // listed back unmatched. A wrong log of them is already caught above, as a food no expected item names.
  const unasked = (c.expect.ask ?? []).filter((a) => !unmatched.some((u) => new RegExp(a, 'i').test(u)));
  if (unasked.length) return done('incorrect', `not asked about: ${unasked.join(', ')}`);
  if (missing.length) {
    // Every food the phrase names must be logged or listed: fewer listed than missing means one vanished.
    if (r.unmatched.length >= missing.length) return done('safely-uncertain', `not logged, listed instead: ${unmatched.join(', ')}`);
    return done('incorrect', `silently dropped: ${missing.map((m) => m.food).join(', ')}`);
  }
  // The best outcome this case allows is uncertainty (an owner decision): behaving exactly as expected is still not
  // correct automatic logging of every food, so it scores safely uncertain.
  if (c.expect.uncertain) return done('safely-uncertain', `as expected: logged what it could, asked about ${(c.expect.ask ?? []).join(', ')}`);
  return done('correct', expected.some((e) => e.assumption) ? 'right food, labelled assumed amount' : 'right food and amount');
}

export function summarize(judged: Judged[], known: Record<string, string> = {}) {
  const count = (o: Outcome, js = judged) => js.filter((j) => j.outcome === o).length;
  const knownIncorrect = judged.filter((j) => j.outcome === 'incorrect' && j.phrase in known).length;
  const byCategory = Object.fromEntries([...new Set(judged.map((j) => j.category))].map((k) => {
    const js = judged.filter((j) => j.category === k);
    return [k, { cases: js.length, correct: count('correct', js), safelyUncertain: count('safely-uncertain', js), incorrect: count('incorrect', js) }];
  }));
  return { cases: judged.length, correct: count('correct'), safelyUncertain: count('safely-uncertain'), incorrect: count('incorrect'), knownIncorrect, unexpectedIncorrect: count('incorrect') - knownIncorrect, byCategory };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const D = loadSetD();
  const known = loadKnownIncorrect();
  const judged = D.cases.map(judge);
  const s = summarize(judged, known);
  console.log(`set D v${D.version} (${D.sha256.slice(0, 12)}): ${s.cases} cases`);
  console.log(`  correct ${s.correct}  safely uncertain ${s.safelyUncertain}  incorrect ${s.incorrect} (known ${s.knownIncorrect}, UNEXPECTED ${s.unexpectedIncorrect})`);
  console.log('  The gate passes when nothing is unexpected; the known incorrect cases are still wrong today.');
  for (const [k, v] of Object.entries(s.byCategory)) console.log(`  ${k.padEnd(14)} ${v.correct}/${v.cases} correct, ${v.safelyUncertain} uncertain, ${v.incorrect} incorrect`);
  const label = (j: Judged) => (j.outcome !== 'incorrect' ? j.outcome : j.phrase in known ? 'known incorrect' : 'UNEXPECTED');
  for (const j of judged) if (j.outcome !== 'correct') {
    console.log(`  ${label(j).padEnd(16)} ${JSON.stringify(j.phrase).padEnd(30)} ${j.why}${j.phrase in known ? `  [${known[j.phrase]}]` : ''}`);
  }
  const out = process.argv.indexOf('--json');
  if (out > 0) fs.writeFileSync(process.argv[out + 1], `${JSON.stringify({ set: { version: D.version, sha256: D.sha256 }, summary: s, knownIncorrect: known, judged }, null, 2)}\n`);
}
