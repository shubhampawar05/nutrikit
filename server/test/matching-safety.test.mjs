// Matching safety (M7.1, M7.2): a phrase is never logged as a food it doesn't name, and a spelling correction is only
// ever a suggestion. Rules-based logging only: no AI provider is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';
import { namesHead } from '../src/domain/search.ts';
import { closestWord, consonants } from '../src/domain/spelling.ts';

const names = (r) => r.items.map((i) => i.food.name);

test('veg fried rice is never silently logged as rissoles', () => {
  for (const text of ['veg fried rice', '1 plate veg fried rice', '2 cups veg fried rice']) {
    const r = logText(text);
    assert.ok(!names(r).some((n) => /rissole/i.test(n)), `${text}: ${names(r)}`);
    assert.equal(r.items.length, 0);
    assert.equal(r.unmatched[0].reason, 'no confident match');
    assert.ok(r.unmatched[0].suggestions.length > 0, 'the near foods are offered as suggestions');
    assert.ok(namesHead('veg fried rice', r.unmatched[0].suggestions[0].name), 'a food the phrase names is suggested first');
  }
});

test('other partial matches that named a different dish are refused too', () => {
  assert.ok(!names(logText('turkey or chicken burger')).some((n) => /sausage/i.test(n)));
  assert.ok(!names(logText('vodka and soda')).some((n) => /energy drink/i.test(n)));
});

test('namesHead: the phrase must name the head, the food segment of a category name, or the bracketed name', () => {
  assert.equal(namesHead('veg fried rice', 'Rissoles, brown rice, fried in vegetable oil'), false);
  assert.equal(namesHead('salmon', 'Fish, salmon, Atlantic, raw'), true);
  assert.equal(namesHead('veg pulao', 'Vegetable pulao'), true, '3+ letter abbreviation of a head word');
  assert.equal(namesHead('poha aur dahi', 'Poha with curd (Poha aur dahi)'), true);
  assert.equal(namesHead('curd rice', 'Rice, curd'), true);
});

test('exact foods and reviewed aliases still log', () => {
  for (const [text, food] of [['2 eggs', /^Egg, whole/], ['1 banana', /^Banana, raw/], ['1 cup rice', /^Rice, cooked/], ['rajma', /kidney bean|rajma/i], ['1 masala dosa', /^Dosa, with filling/], ['poha aur dahi', /^Poha with curd/], ['kheere aur dahi ka salad', /^Cucumber and yogurt salad/]]) {
    const r = logText(text);
    assert.equal(r.items.length, 1, `${text}: logged`);
    assert.match(r.items[0].food.name, food, text);
  }
});

test('Hinglish names that matched before still match', () => {
  for (const [text, food] of [['aloo gobhi', /gobhi|cauliflower/i], ['anda curry', /egg curry/i], ['kheere ka raita', /raita/i], ['egg bhurji', /bhurji|scrambled/i], ['chicken chowmein', /chowmein|chow mein/i]]) {
    const r = logText(text);
    assert.equal(r.items.length, 1, `${text}: logged`);
    assert.match(r.items[0].food.name, food, text);
  }
});

test('typos get a didYouMean suggestion and are never logged', () => {
  // (Transliterations such as "chapathi" and "panir" are matched since M7.3: see matching-hinglish.test.mjs.)
  for (const [text, dym] of [['chiken korma', 'chicken korma'], ['1 cup panner', '1 cup paneer'], ['chicken chowmin', 'chicken chowmein'], ['plain prantha', 'plain parantha']]) {
    const r = logText(text);
    assert.equal(r.items.length, 0, `${text}: a correction is not a confirmed match`);
    assert.equal(r.unmatched[0].didYouMean, dym, text);
  }
});

test('"panir" suggests paneer, not pani; plurals and other corrections are unchanged', () => {
  assert.equal(consonants('panir'), consonants('paneer'));
  assert.equal(closestWord('panir'), 'paneer');
  assert.equal(closestWord('rotis'), 'roti');
  assert.equal(closestWord('tomatos'), 'tomato');
  assert.equal(closestWord('chiken'), 'chicken');
  assert.equal(closestWord('panner'), 'paneer');
});

test('multi-item meals still log every item', () => {
  const r = logText('2 roti and aloo gobi');
  assert.equal(r.items.length, 2);
  assert.ok(names(r).some((n) => /chapati|roti/i.test(n)));
  assert.ok(names(r).some((n) => /gobhi|gobi|cauliflower/i.test(n)));
  const m = logText('masala dosa, sambar');
  assert.equal(m.items.length, 2);
});

test('P0-2: an exact match must name the food, not only share words with its description', () => {
  for (const [text, wrong] of [
    ['vegetable fried rice', /rissole/i], ['egg fried rice', /roll with meat/i], ['plain rice', /rice cracker/i],
    ['bread butter', /peanut butter sandwich/i], ['tortilla chips', /sweet potato/i], ['corn chips', /sweet potato/i],
    ['french toast', /^Bread, French/], ['apple pie', /filling/i], ['snacks', /cornnuts/i],
  ]) {
    const r = logText(text);
    assert.ok(!r.items.some((i) => wrong.test(i.food.name)), `${text}: never ${wrong} (got ${r.items.map((i) => i.food.name)})`);
  }
  // Refused exact matches come back as suggestions, foods the phrase names first; the next result is never logged.
  const r = logText('vegetable fried rice');
  assert.equal(r.items.length, 0);
  assert.equal(r.unmatched[0].reason, 'no confident match');
  assert.ok(r.unmatched[0].suggestions.length > 0);
  assert.match(logText('apple pie').unmatched[0].suggestions[0].name, /^Pie, apple/);
});

test('P0-2: chips and toast are only rewritten as bare words', () => {
  assert.match(logText('tortilla chips').items[0].food.name, /^Tortilla chips/);
  assert.match(logText('corn chips').items[0].food.name, /^Corn chips/);
  assert.match(logText('chips').items[0].food.name, /^Potato chips/);
  assert.match(logText('french toast').items[0].food.name, /^French toast/);
  assert.match(logText('toast').items[0].food.name, /^Bread, white, toasted/);
  assert.match(logText('whole wheat toast').items[0].food.name, /^Bread, whole wheat, toasted/);
});

test('P0-2: documented exemptions keep correct exact matches', () => {
  for (const [text, food] of [
    ['green tea', /^Tea, hot, leaf, green/], ['raw rice', /^Rice, white.*raw/], ['boiled egg', /^Egg, whole, boiled/], ['2 eggs', /^Egg, whole, raw/],
    ['cookies', /^Cookie/], ['curd', /^Yogurt, whole milk, plain/], ['sweetened yogurt', /^Yogurt/], ['sweet curd', /^Yogurt, whole milk, flavors/],
    ['chai', /^Tea, hot, with milk/], ['daal', /^Dal$/], ['palak', /^Spinach/], ['plain rice', /^Rice, cooked/],
    ['masala dosa', /^Dosa, with filling/], ['chicken korma', /chicken korma/i], ['rajma', /kidney bean/i], ['mac and cheese', /macaroni/i],
    ['sprouts salad', /sprouted moong salad/i], ['besan burfi', /besan burfi/i], ['rasam masala', /rasam/i], ['pancake', /^Pancakes/],
  ]) {
    const r = logText(text);
    assert.equal(r.items.length, 1, `${text}: logged (unmatched ${JSON.stringify(r.unmatched)})`);
    assert.match(r.items[0].food.name, food, text);
  }
});
