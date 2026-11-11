// The food-logging accuracy benchmark as tests: every case must hold except `known` bugs (todo until fixed), and
// no case may log a wrong food. Cases live in benchmark-cases.mjs; `npm run benchmark -w server` prints the scores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase, score } from '../scripts/benchmark.ts';
import { CASES } from './benchmark-cases.mjs';

const outcomes = [];

for (const c of CASES) {
  test(`benchmark: ${c.input}`, c.known ? { todo: c.known } : {}, () => {
    const o = runCase(c);
    outcomes.push(o);
    assert.notEqual(o.status, 'wrong', o.why);
    assert.notEqual(o.status, 'missed', o.why);
    assert.notEqual(o.gramsOk, false, o.why);
  });
}

test('benchmark scores: no wrong food outside known bugs, every sized portion in range, full provenance', (t) => {
  const s = score(CASES.map(runCase));
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  t.diagnostic(`correctly handled ${pct(s.correctlyHandled)} · top-1 ${pct(s.top1)} · wrong ${pct(s.wrongRate)} · unmatched ${pct(s.unmatchedRate)} · portions ${pct(s.portionAccuracy)} · estimated ${pct(s.estimatedPortions)}`);
  assert.equal(s.counts.wrong, CASES.filter((c) => c.known).length, 'only known bugs log a wrong food');
  assert.equal(s.counts.missed, 0, 'every food the catalog has is found');
  assert.equal(s.portionAccuracy, 1);
  assert.equal(s.provenance, 1, 'every logged item names its data source and how its weight was found');
});
