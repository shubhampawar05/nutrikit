// The AI grams contract (audit P1-1): the AI names the food and reads the quantity and unit; the portion rules alone
// decide whether that amount can be logged and what it weighs. The AI's grams never reach a logged item, from text,
// voice or a photo. A photo's amount is the AI's own reading, so it is asked about when the AI is unsure and keeps its
// photo origin when it is logged. No AI is called: items are given as a provider would return them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAiItem, resolveAiMeal } from '../src/domain/textlog.ts';
import { FOOD_ITEMS_SCHEMA, PHOTO_SYSTEM, TEXT_SYSTEM } from '../src/domain/providers/prompts.ts';

const ai = (food, quantity, unit, grams, confidence = 'high') => ({ food, quantity, unit, grams, confidence });
const logged = (r, why) => {
  assert.ok('item' in r, `${why}: expected a logged item, got ${JSON.stringify(r.unmatched)}`);
  return r.item;
};
const asked = (r, why) => {
  assert.ok('unmatched' in r, `${why}: expected it to be asked about, got ${'item' in r ? `${r.item.grams} g` : ''}`);
  assert.equal(r.unmatched.amountUnsupported, true, `${why}: never covered by an estimate`);
  return r.unmatched;
};

test('a photo item is weighed by the portion rules, never by the AI\'s grams, and keeps its photo origin', () => {
  for (const [item, grams, method] of [
    [ai('dal', 1, 'katori', 999), 202.9, 'volume-conversion'],
    [ai('rice', 1, 'bowl', 999), 133.6, 'assumed-bowl'],
    [ai('milk', 1, 'glass', 999), 257.8, 'assumed-glass'],
    [ai('rice', 1, 'plate', 999), 133.6, 'assumed-plate'],
    [ai('dal', 100, 'g', 350), 100, 'mass'],
  ]) {
    const it = logged(resolveAiItem(item, 'photo'), `${item.quantity} ${item.unit} ${item.food}`);
    assert.equal(it.grams, grams, `${item.food}: the rules' grams, not the AI's ${item.grams}`);
    assert.equal(it.portionMethod, method);
    assert.match(it.portionBasis, /^amount read from the photo by AI \(high confidence\)/);
  }
});

test('a photo item the rules can\'t weigh is asked about, whatever grams the AI gave', () => {
  for (const [item, note] of [
    [ai('biryani', 1, 'plate', 450), /a plate has no standard size/],
    [ai('kheer', 1, 'katori', 240), /no cited density for Kheer/],
    [ai('idli', 1, 'plate', 400), /a plate has no standard size/],
    [ai('dal', 1, 'small katori', 150), /small katori has no single size/],
    [ai('rasgulla', 1, 'piece', 150), /./],
  ]) {
    const u = asked(resolveAiItem(item, 'photo'), `${item.quantity} ${item.unit} ${item.food}`);
    assert.match(u.note, note, item.food);
    assert.ok(u.suggestions?.length, `${item.food}: the food is offered`);
  }
});

test('a photo amount the AI can\'t read is asked about: low confidence or no household unit', () => {
  for (const item of [ai('dal', 1, 'katori', 200, 'low'), ai('pav bhaji', 1, 'serving', 400, 'medium'), ai('dal', 2, '', 400, 'high')]) {
    const u = asked(resolveAiItem(item, 'photo'), `${item.unit || 'no unit'} ${item.confidence}`);
    assert.match(u.note, /the photo doesn't show the amount clearly/);
  }
  // From text, "serving" is the person giving no amount: the food's own portion, as in rules logging.
  assert.ok('item' in resolveAiItem(ai('pav bhaji', 1, 'serving', 400, 'medium'), 'text'));
});

test('a photo item\'s confidence is the lower of the match and the AI\'s reading', () => {
  assert.equal(logged(resolveAiItem(ai('dal', 1, 'katori', 0, 'medium'), 'photo'), 'medium').confidence, 'medium');
  assert.equal(logged(resolveAiItem(ai('dal', 1, 'katori', 0, 'high'), 'photo'), 'high').confidence, 'high');
});

test('text and voice: the person\'s quantity and unit decide the weight; the AI\'s grams are ignored', () => {
  for (const [item, grams] of [
    [ai('dal', 2, 'katori', 480), 405.8],
    [ai('rice', 150, 'g', 180), 150],
    [ai('milk', 1, 'glass', 5000), 257.8],
    [ai('dal', 1, 'katori', -50), 202.9],
    [ai('roti', 2, 'piece', 40), 72],
  ]) {
    const it = logged(resolveAiItem(item, 'text'), `${item.quantity} ${item.unit} ${item.food}`);
    assert.equal(it.grams, grams, `${item.food}: not the AI's ${item.grams} g`);
    assert.notEqual(it.portionMethod, 'provided-grams');
    assert.doesNotMatch(it.portionBasis ?? '', /photo/, 'text items are not marked as read from a photo');
  }
  for (const item of [ai('kheer', 1, 'katori', 240), ai('biryani', 1, 'plate', 450), ai('flour', 1, 'plate', 300)]) {
    assert.ok('unmatched' in resolveAiItem(item, 'text'), `${item.unit} ${item.food}: asked, as in rules logging`);
  }
});

test('an AI quantity that isn\'t a positive, finite number up to 1000 is asked about, never logged', () => {
  for (const q of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1001, '2']) {
    for (const origin of ['text', 'photo']) {
      const u = asked(resolveAiItem(ai('dal', q, 'katori', 200), origin), `quantity ${q} (${origin})`);
      assert.match(u.note, /can't be used; give it in grams or a household unit/);
    }
  }
});

test('the AI is no longer asked for a weight, and its instructions carry no portion weights', () => {
  const props = FOOD_ITEMS_SCHEMA.properties.items.items;
  assert.equal(props.properties.grams, undefined);
  assert.ok(!props.required.includes('grams'));
  for (const prompt of [PHOTO_SYSTEM, TEXT_SYSTEM]) {
    assert.doesNotMatch(prompt, /edible weight in grams|katori is taken as 1 cup|dinner plate of one dish is often|1 glass milk 250 g/);
    assert.match(prompt, /never a weight/);
  }
});

// A weight the person stated in their own words beats the AI's reading of that amount (P1-1 follow-up).
const meal = (text, items) => resolveAiMeal(items, { kind: 'text', text });
const one = (text, item) => {
  const r = meal(text, [item]);
  assert.equal(r.results.length, 1);
  return { r: r.results[0], extra: r.extra };
};

test('a stated weight survives the AI reading it as "1 serving" or a cup: grams and kilograms, density or not', () => {
  for (const [text, item, food, grams] of [
    ['150 g rice', ai('rice', 1, 'serving', 999, 'medium'), 'Rice, cooked, NFS', 150],
    ['150g rice', ai('rice', 1, 'serving', 999, 'medium'), 'Rice, cooked, NFS', 150],
    ['0.5 kg rice', ai('rice', 1, 'serving', 999, 'medium'), 'Rice, cooked, NFS', 500],
    ['1 kg rice', ai('rice', 1, 'cup', 999), 'Rice, cooked, NFS', 1000],
    ['half kg rice', ai('rice', 1, 'serving', 999, 'medium'), 'Rice, cooked, NFS', 500],
    ['100 grams kheer', ai('kheer', 1, 'katori', 240), 'Kheer (rice pudding)', 100],
    ['rice 150 g', ai('rice', 1, 'serving', 999, 'medium'), 'Rice, cooked, NFS', 150],
    ['1500 g rice', ai('rice', 1500, 'g', 1500), 'Rice, cooked, NFS', 1500],
  ]) {
    const { r, extra } = one(text, item);
    const it = logged(r, text);
    assert.equal(it.food.name, food, text);
    assert.equal(it.grams, grams, `${text}: the stated weight, not the AI's ${item.quantity} ${item.unit} or its ${item.grams} g`);
    assert.equal(it.portionMethod, 'mass');
    assert.equal(it.portionBasis, `${grams} g, as stated ("${text}")`);
    assert.deepEqual(extra, []);
  }
});

test('several foods: each stated weight goes to its own food; the rest keep the rules', () => {
  const r = meal('2 roti and 150 g dal', [ai('roti', 2, 'piece', 80), ai('dal', 1, 'serving', 240, 'medium')]);
  assert.deepEqual(r.results.map((x) => [logged(x, 'item').food.name, x.item.grams]), [['Chapati/Roti', 72], ['Dal', 150]]);
  const two = meal('150 g rice and 150 g brown rice', [ai('rice', 1, 'serving', 1, 'medium'), ai('brown rice', 1, 'serving', 1, 'medium')]);
  assert.deepEqual(two.results.map((x) => [logged(x, 'item').food.name, x.item.grams]), [['Rice, cooked, NFS', 150], ['Rice, brown, cooked, no added fat', 150]]);
});

test('household measures are not masses: katori, bowl, glass and plate keep their own rules', () => {
  for (const [text, item, grams] of [
    ['2 katori dal', ai('dal', 2, 'katori', 480), 405.8],
    ['1 katori dal 150 g', ai('dal', 1, 'katori', 150), 202.9],
    ['1 bowl rice', ai('rice', 1, 'bowl', 300), 133.6],
    ['1 glass milk', ai('milk', 1, 'glass', 300), 257.8],
  ]) assert.equal(logged(one(text, item).r, text).grams, grams, text);
  assert.ok('unmatched' in one('1 plate biryani', ai('biryani', 1, 'plate', 450)).r, 'a plate of biryani is still asked about');
});

test('a weight that can\'t be read or placed is asked about and listed back as written, never guessed', () => {
  for (const [text, item] of [
    ['100-150 g rice', ai('rice', 1, 'serving', 150, 'medium')],
    ['a few grams of salt', ai('salt', 1, 'serving', 3, 'medium')],
    ['1,000 g rice', ai('rice', 1, 'serving', 1000, 'medium')],
    ['150 g chawal aur 2 roti', ai('rice', 1, 'serving', 150, 'medium')],
    ['150 g chawal', ai('rice, white, cooked', 1, 'serving', 150, 'medium')],
  ]) {
    const { r, extra } = one(text, item);
    asked(r, text);
    assert.equal(extra.length, 1, `${text}: the stated weight is listed back`);
    assert.equal(extra[0].amountUnsupported, true);
  }
  const both = meal('150 g dal', [ai('dal', 1, 'serving', 1, 'medium'), ai('dal tadka', 1, 'serving', 1, 'medium')]);
  both.results.forEach((x) => assert.match(asked(x, 'two dals').note, /could belong to more than one food/));
  const big = one('20 kg rice', ai('rice', 20, 'kg', 20000));
  asked(big.r, '20 kg');
  assert.deepEqual(big.extra, [], 'not listed twice');
});

test('quantity limits depend on the unit: 10 kg, 10 litres, 1000 of anything counted', () => {
  for (const [item, ok] of [
    [ai('rice', 10000, 'g', 0), true], [ai('rice', 10, 'kg', 0), true], [ai('rice', 10001, 'g', 0), false],
    [ai('milk', 1000, 'ml', 0), true], [ai('milk', 10, 'l', 0), true], [ai('milk', 11, 'l', 0), false],
    [ai('almonds', 1000, 'piece', 0), true], [ai('almonds', 1001, 'piece', 0), false],
  ]) {
    const r = resolveAiItem(item, 'text');
    const usable = !('unmatched' in r) || !/can't be used/.test(r.unmatched.note ?? '');
    assert.equal(usable, ok, `${item.quantity} ${item.unit}`);
  }
});

test('photo items take no weight from text: there are no words of the person\'s to read', () => {
  const r = resolveAiMeal([ai('rice', 1, 'bowl', 999)], { kind: 'photo' });
  assert.equal(logged(r.results[0], 'photo').grams, 133.6);
  assert.match(r.results[0].item.portionBasis, /^amount read from the photo by AI/);
});

test('two items for the same food: the stated weight goes to the one the AI read at that weight', () => {
  const r = resolveAiMeal([ai('dal', 1, 'katori', 240), ai('dal', 100, 'g', 100)], { kind: 'text', text: '1 katori dal, 100 g dal' });
  assert.deepEqual(r.results.map((x) => logged(x, 'dal').grams), [202.9, 100]);
  assert.equal(r.results[1].item.portionBasis, '100 g, as stated ("100 g dal")');
});
