// Hindi and Hinglish food names (M7.3): romanised spellings, Hindi words for catalog foods and connector words match
// the same food, through equivalent forms tried only when the phrase as typed matches nothing on all its words, and
// accepted only when they name the food on all their words. Rules-based logging only: no AI provider is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';
import { equivalentQueries, searchFoods } from '../src/domain/search.ts';
import { catalogSpelling, transliterationKey } from '../src/domain/spelling.ts';

const one = (text) => {
  const r = logText(text);
  assert.equal(r.items.length, 1, `${text}: one food logged (got ${r.items.map((i) => i.food.name)}; unmatched ${JSON.stringify(r.unmatched)})`);
  return r.items[0].food.name;
};

test('the phrases M7.3 must match, each to the right food', () => {
  for (const [text, food] of [
    ['matar ki sabzi', /^Pea curry \(Matar ki sabzi\)/],
    ['matar aloo ki sabzi', /Pea potato curry|potato and pea/i],
    ['aloo gobi', /cauliflower|aloo gobhi/i],
    ['gobi aloo', /cauliflower|aloo gobhi/i],
    ['murgh korma', /chicken korma/i],
    ['gosht biryani', /lamb biryani|mutton biryani/i],
    ['kakdi raita', /cucumber raita/i],
    ['yellow moong daal', /washed moong dal/i],
    ['samose', /^Samosa/],
    ['palak panir', /palak paneer/i],
    ['chapathi', /chapati/i],
    ['masala dosai', /^Dosa, with filling/],
  ]) assert.match(one(text), food, text);
});

test('food identity is kept: no ingredient or modifier is dropped', () => {
  assert.ok(!/potato|aloo/i.test(one('matar ki sabzi')), 'matar ki sabzi is not a potato dish');
  assert.match(one('matar aloo ki sabzi'), /potato|aloo/i, 'matar aloo ki sabzi keeps the potato');
  assert.match(one('palak paneer'), /paneer/i, 'palak paneer is never plain palak');
  assert.ok(!/paneer/i.test(one('palak')), 'palak alone is spinach, not palak paneer');
  assert.match(one('palak'), /^Spinach/);
  const r = logText('aloo paneer');
  assert.equal(r.items.length, 0, 'no aloo paneer in the catalog: not logged as something else');
});

test('the M7.1 protection holds through equivalent forms', () => {
  assert.ok(!logText('veg fried rice').items.some((i) => /rissole/i.test(i.food.name)));
  assert.equal(searchFoods('veg fried rice').matchedAs, undefined, 'the equivalent form names rissoles only in their description');
  const r = logText('panner');
  assert.equal(r.items.length, 0, '"panner" is a typo for paneer, not the dish "Paaner do pyaza"');
  assert.equal(r.unmatched[0].didYouMean, 'paneer');
});

test('equivalent forms: spellings first, then without connectors, then English names', () => {
  assert.deepEqual(equivalentQueries('matar aloo ki sabzi'), ['matar aloo', 'pea potato ki sabzi', 'pea potato']);
  assert.deepEqual(equivalentQueries('murgh korma'), ['chicken korma']);
  assert.deepEqual(equivalentQueries('2 chiken'), [], 'a typo is not an equivalent form');
  assert.equal(searchFoods('murgh korma').matchedAs, 'chicken korma');
  assert.equal(searchFoods('chicken korma').matchedAs, undefined, 'as typed needs no equivalent');
});

test('transliteration: one key for spellings of one word; typos are not transliterations', () => {
  for (const [a, b] of [['paneer', 'panir'], ['daal', 'dal'], ['dhal', 'dal'], ['chapathi', 'chapati'], ['jeera', 'jira'], ['mattar', 'matar'], ['masaala', 'masala'], ['dosai', 'dosa']]) {
    assert.equal(transliterationKey(a), transliterationKey(b), `${a} ~ ${b}`);
  }
  assert.notEqual(transliterationKey('chiken'), transliterationKey('chicken'));
  assert.equal(catalogSpelling('samose'), 'samosa');
  assert.equal(catalogSpelling('chicken'), null, 'a common catalog word is kept');
});

test('exact foods, reviewed aliases, Hinglish and multi-item meals still log as before', () => {
  for (const [text, food] of [['2 eggs', /^Egg, whole/], ['rajma', /kidney bean|rajma/i], ['dal makhani', /black gram|dal makhani/i], ['kheere ka raita', /raita/i], ['anda curry', /egg curry/i], ['aloo gobhi', /gobhi|cauliflower/i], ['daal', /^Dal$/]]) {
    assert.match(one(text), food, text);
  }
  const m = logText('2 mattar paneer and 3 phulka');
  assert.equal(m.items.length, 2);
  assert.ok(m.items.some((i) => /matar paneer|pea paneer/i.test(i.food.name)));
  assert.ok(m.items.some((i) => /chapati|roti/i.test(i.food.name)));
});

test('P0-1: a standalone sabzi is a food, never dropped; only "ki/ka/ke sabzi" is a connector', () => {
  for (const text of ['roti sabzi', 'chawal sabzi']) {
    const r = logText(text);
    assert.ok(!(r.items.length === 1 && r.unmatched.length === 0), `${text}: one of its two foods must not vanish (got ${r.items.map((i) => i.food.name)})`);
  }
  assert.deepEqual(equivalentQueries('roti sabzi'), []);
  assert.match(one('matar ki sabzi'), /^Pea curry/);
  assert.match(one('aloo ki sabzi'), /potato curry|aloo ki sabzi/i);
  assert.match(one('matar aloo ki sabzi'), /pea potato|potato and pea/i);
});
