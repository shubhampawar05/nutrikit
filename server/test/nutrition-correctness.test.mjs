// Phase 1 nutrition correctness (audit P0-3 to P0-5): staples resolve to the food people eat, in a believable amount,
// and an amount the catalog can't support is flagged rather than invented. Rules-based logging: no AI provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';
import { searchFoods } from '../src/domain/search.ts';
import { getFood } from '../src/domain/db.ts';

const only = (text) => {
  const r = logText(text);
  assert.equal(r.items.length, 1, `${text}: one item (got ${r.items.map((i) => i.food.name)})`);
  return r.items[0];
};
const kcal = (i) => i.nutrients.calories.amount;

test('P0-3: roti and chapati are the home roti (INDB / CoFID, 202 kcal per 100 g, 36 g each)', () => {
  const home = getFood(878591004);
  assert.equal(home.name, 'Chapati/Roti');
  assert.ok(Math.abs(home.per100g.calories - 202) < 1);
  for (const [text, grams] of [['roti', 36], ['1 roti', 36], ['2 roti', 72], ['1.5 roti', 54], ['1 1/2 roti', 54], ['3 rotis', 108], ['2 chapati', 72], ['1 phulka', 36], ['chapathi', 36]]) {
    const i = only(text);
    assert.equal(i.food.name, 'Chapati/Roti', text);
    assert.equal(i.grams, grams, text);
    assert.ok(Math.abs(kcal(i) - grams * 2.023) < 1.5, `${text}: ${kcal(i)} kcal`);
  }
  assert.ok(kcal(only('2 roti')) < 160, '2 roti is about 146 kcal, not 404');
});

test('P0-3: the commercial chapati stays searchable and loggable by name', () => {
  assert.ok(searchFoods('chapati').results.some((r) => /commercially prepared/.test(r.name)));
  assert.match(only('chapati commercially prepared').food.name, /^Bread, chapati or roti, plain, commercially prepared/);
});

test('P0-4: bare chicken is asked about, never logged as raw ground chicken', () => {
  for (const text of ['chicken', '1 piece chicken', '2 pieces chicken', '100 g chicken']) {
    const r = logText(text);
    assert.equal(r.items.length, 0, `${text}: not logged`);
    assert.equal(r.unmatched[0].reason, 'no confident match');
    assert.ok(r.unmatched[0].suggestions.length >= 3, `${text}: cooked chicken suggestions`);
    assert.ok(r.unmatched[0].suggestions.every((s) => !/ground, raw/.test(s.name)));
  }
  const mixed = logText('chicken and rice');
  assert.ok(!mixed.items.some((i) => /^Chicken, ground/.test(i.food.name)));
  assert.ok(mixed.items.some((i) => /^Rice/.test(i.food.name)), 'the rice is still logged');
  assert.equal(mixed.unmatched.length, 1, 'the chicken is listed, not dropped');
  for (const [text, food] of [['chicken breast', /^Chicken breast/], ['grilled chicken', /grilled/i], ['chicken curry', /^Chicken curry/], ['butter chicken', /^Butter chicken/]]) {
    assert.match(only(text).food.name, food, `${text}: specific phrases still match`);
  }
});

test('P0-5: a count of a sweet is never logged at a recipe-yield serving weight; the amount is flagged', async () => {
  for (const text of ['rasgulla', '1 rasgulla', '2 rasgulla', '2 pieces rasgulla', '1 rasmalai', 'kulfi', '1 kulfi']) {
    const r = logText(text);
    assert.equal(r.items.length, 0, `${text}: not logged at the serving weight`);
    assert.equal(r.unmatched[0].reason, 'no confident match');
    assert.match(r.unmatched[0].note, /not believable for one piece/);
    assert.equal(r.unmatched[0].suggestions.length, 1, `${text}: the food is offered`);
  }
  assert.equal(only('60 g rasgulla').grams, 60, 'a weight given in grams is used as given');
});

test('P0-5: valid piece portions are unchanged', () => {
  for (const [text, grams] of [['idli', 38], ['3 idli', 114], ['1 samosa', 100], ['4 samosas', 400], ['2 roti', 72], ['2 besan ladoo', 70], ['1 burfi', 44], ['1 jalebi', 50]]) {
    assert.equal(only(text).grams, grams, text);
  }
});

test('P0-5: the runtime piece ranges match the build\'s table in scripts/indb-totals.mjs', async () => {
  const { PIECE_RANGES, RUNTIME_PIECE_RANGES } = await import('../src/domain/portions.ts');
  const fs = await import('node:fs');
  const build = fs.readFileSync(new URL('../scripts/indb-totals.mjs', import.meta.url), 'utf8');
  for (const [pattern, low, high] of [...PIECE_RANGES, ...RUNTIME_PIECE_RANGES]) {
    assert.ok(build.includes(`[${pattern}, ${low}, ${high}]`), `${pattern} ${low}-${high} is in the build's PIECES`);
  }
});
