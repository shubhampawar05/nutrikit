// INDB serving names: a dish's own serving ("1 tall glass", "1 idli") becomes its portion only when the weight is
// believable for the name. A typed volume (cup, glass, spoon) is weighed only through a USDA density, never INDB's weight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsFryingOil, indbServing } from '../scripts/indb-totals.mjs';
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

test('a piece INDB weighs as several pieces with syrup or gravy stays "1 serving"', () => {
  for (const [name, grams] of [['gulab jamun', 157], ['piece', 342], ['cutlet', 338], ['cookie', 219], ['slice', 513], ['egg', 582], ['kulfi', 270]]) {
    const s = indbServing(name, grams);
    assert.equal(s.label, '1 serving', name);
    assert.match(s.flagged, new RegExp(`^1 ${name} = ${grams} g \\(expected`));
  }
  assert.equal(indbServing('ladoo', 35).label, '1 ladoo');
  assert.equal(indbServing('cutlet', 90).label, '1 cutlet');
});

test('a dish whose recipe deep-fries in at least 200 ml and is published at 30 g fat or more counts its frying oil', () => {
  assert.equal(countsFryingOil(485, 77.6), true); // Poori
  assert.equal(countsFryingOil(250, 17.9), false); // mango pickle: the oil stays in the food
  assert.equal(countsFryingOil(120, 84.5), false); // mayonnaise: oil is the food
  assert.equal(countsFryingOil(undefined, 50), false);
});

test('the catalog carries INDB serving names, and text logging uses them', async () => {
  const named = foods().prepare("SELECT count(*) c FROM portions p JOIN foods f ON f.id = p.food_id WHERE f.source = 'indb' AND p.label <> '1 serving'").get().c;
  assert.ok(named >= 650, `${named} INDB dishes with a named serving`);
  // The dish's own serving is its default. An INDB serving is a serving weight from a recipe yield, not a density,
  // so a typed volume (a glass, a tablespoon) is not weighed: the dish is offered and the amount asked for.
  const [plain] = (await logText('aam panna')).items;
  assert.equal(plain.food.source, 'indb');
  assert.equal(plain.portionBasis, '1 tall glass');
  assert.equal(Math.round(plain.grams), 268);
  for (const phrase of ['1 glass aam panna', '1 tbsp mint chutney']) {
    const r = await logText(phrase);
    assert.equal(r.items.length, 0, phrase);
    assert.equal(r.unmatched[0].suggestions[0].id > 0, true, phrase);
    assert.match(r.unmatched[0].note, /no cited density/, phrase);
  }
});
