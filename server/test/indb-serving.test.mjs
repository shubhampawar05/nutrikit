// INDB serving names: a dish's own serving ("1 tall glass", "1 idli") becomes its portion only when the weight is
// believable for the name. A typed cup or glass stays the standard 236.6 ml; spoons, bowls and plates use INDB's weight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indbServing } from '../scripts/indb-totals.mjs';
import { foods } from '../src/domain/db.ts';
import { logText } from '../src/domain/textlog.ts';

test('INDB serving names map to portion units, and unnamed servings stay "1 serving"', () => {
  assert.deepEqual(indbServing('tall glass', 268), { label: '1 tall glass', unit: 'serving', flagged: null });
  assert.deepEqual(indbServing('tea cup', 211), { label: '1 tea cup', unit: 'serving', flagged: null });
  assert.deepEqual(indbServing('Small  Bowl', 226), { label: '1 small bowl', unit: 'bowl', flagged: null });
  assert.deepEqual(indbServing('tablespoon', 20), { label: '1 tablespoon', unit: 'tbsp', flagged: null });
  assert.deepEqual(indbServing('idli', 30), { label: '1 idli', unit: 'idli', flagged: null });
  assert.deepEqual(indbServing('large slice', 134), { label: '1 large slice', unit: 'slice', flagged: null });
  assert.deepEqual(indbServing('cookies', 18), { label: '1 cookies', unit: 'cookie', flagged: null });
  for (const unnamed of ['', null, 'ml', 'gm', 'small', 'portion']) {
    assert.deepEqual(indbServing(unnamed, 200), { label: '1 serving', unit: 'serving', flagged: null }, String(unnamed));
  }
});

test('an unbelievable weight for its name is flagged and kept as "1 serving"', () => {
  for (const [name, grams] of [['tea cup', 450], ['cup', 910], ['bowl', 55], ['glass', 629], ['tablespoon', 43], ['teaspoon', 18], ['plate', 858], ['piece', 3]]) {
    const s = indbServing(name, grams);
    assert.equal(s.label, '1 serving', name);
    assert.equal(s.unit, 'serving', name);
    assert.match(s.flagged, new RegExp(`^1 ${name} = ${grams} g`));
  }
});

test('the catalog carries INDB serving names, and text logging uses them', async () => {
  const named = foods().prepare("SELECT count(*) c FROM portions p JOIN foods f ON f.id = p.food_id WHERE f.source = 'indb' AND p.label <> '1 serving'").get().c;
  assert.ok(named >= 800, `${named} INDB dishes with a named serving`);
  // The dish's own serving is its default; a typed glass stays the standard 236.6 ml.
  const [plain] = (await logText('aam panna')).items;
  assert.equal(plain.food.source, 'indb');
  assert.equal(plain.portionBasis, '1 tall glass');
  assert.equal(Math.round(plain.grams), 268);
  const [glass] = (await logText('1 glass aam panna')).items;
  assert.ok(glass.grams > 230 && glass.grams < 245, `${glass.grams} g`);
  const [spoon] = (await logText('1 tbsp mint chutney')).items;
  assert.equal(spoon.portionBasis, '1 tablespoon');
});
