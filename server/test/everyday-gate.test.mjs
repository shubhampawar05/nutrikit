// The everyday regression gate (set D): every matching or portion change must keep each phrase correct or safely
// uncertain. A case that becomes incorrect fails the build. A known-incorrect case (data/eval/sets/D.known-incorrect.json,
// each with its finding) stays listed until it is fixed and must be removed once it is, so the list never hides a fix
// or a regression. Passing this gate does NOT mean every case is correct: the known cases are reported as incorrect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, loadKnownIncorrect, loadSetD, summarize } from '../scripts/eval/everyday.ts';

const D = loadSetD();
const KNOWN_INCORRECT = loadKnownIncorrect();
const judged = D.cases.map(judge);

test('set D: every case is kept', () => {
  assert.equal(D.cases.length, 217);
});

test('set D: no phrase is logged incorrectly beyond the tracked known cases', () => {
  const incorrect = judged.filter((j) => j.outcome === 'incorrect');
  const unexpected = incorrect.filter((j) => !(j.phrase in KNOWN_INCORRECT));
  assert.deepEqual(unexpected.map((j) => `${j.phrase}: ${j.why}`), [], 'new incorrect cases');
  const fixed = Object.keys(KNOWN_INCORRECT).filter((p) => !incorrect.some((j) => j.phrase === p));
  assert.deepEqual(fixed, [], 'fixed (or no longer in set D): remove these from D.known-incorrect.json');
});

test('set D: every regression case from PR #43 stays correct or safely uncertain, never incorrect', () => {
  const regressions = judged.filter((j) => j.regression);
  assert.ok(regressions.length >= 25);
  assert.deepEqual(regressions.filter((j) => j.outcome === 'incorrect').map((j) => `${j.phrase} (${j.regression}): ${j.why}`), []);
});

test('set D: categories with no known issues stay fully correct', () => {
  const s = summarize(judged, KNOWN_INCORRECT);
  for (const k of ['pieces', 'hinglish', 'typos', 'no-right-food']) {
    assert.equal(s.byCategory[k].incorrect, 0, `${k}: incorrect`);
  }
  // Known incorrect cases are counted as incorrect, never folded into correct.
  assert.equal(s.incorrect, s.knownIncorrect + s.unexpectedIncorrect);
  assert.equal(s.correct + s.safelyUncertain + s.incorrect, D.cases.length);
});
