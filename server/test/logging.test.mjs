// Food-logging accuracy for everyday phrases (food-logging spec).
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText } from '../src/domain/textlog.ts';
import { searchFoods } from '../src/domain/search.ts';

const items = (text) => logText(text).items;
const item = (text, i = 0) => items(text)[i];
const between = (g, lo, hi, what) => assert.ok(g >= lo && g <= hi, `${what}: ${g} g, expected ${lo}–${hi} g`);

test('an unquantified sweetener or fat is a spoonful, not a cup', () => {
  between(item('a cup of tea with sugar', 1).grams, 3, 15, 'sugar in tea');
  between(item('coffee with sugar', 1).grams, 3, 15, 'sugar in coffee');
  between(item('oatmeal with honey', 1).grams, 3, 15, 'honey');
  between(item('rice with ghee', 1).grams, 3, 15, 'ghee');
  assert.ok(item('a cup of tea with sugar', 1).nutrients.calories.amount < 60, 'a teaspoon of sugar is well under 60 kcal');
});

test('other unquantified add-ons are capped at 60 g', () => {
  between(item('coffee with milk', 1).grams, 15, 60, 'milk in coffee');
  between(item('a bowl of oatmeal with blueberries', 1).grams, 3, 60, 'blueberries');
});

test('a stated amount beats the add-on cap', () => {
  const sugar = item('tea with 2 tbsp sugar', 1);
  assert.equal(sugar.quantity, 2);
  assert.equal(sugar.unit, 'tbsp');
  between(sugar.grams, 20, 30, 'two tablespoons of sugar');
});

test('bare everyday words match the everyday food', () => {
  assert.equal(item('tea').food.name, 'Tea, hot, leaf, black');
  assert.equal(item('a cup of chai').food.name, 'Tea, hot, with milk', 'chai is milk tea, as drunk in India');
  assert.match(item('a salad').food.name, /^Lettuce/);
  assert.match(item('green tea').food.name, /^Tea, hot, leaf, green/);
});

test('search matches whole words before prefixes', () => {
  assert.ok(searchFoods('chole').results.every((r) => !/cholesterol/i.test(r.name)), 'never a "cholesterol-free" food');
  const partial = searchFoods('chicke');
  assert.equal(partial.match, 'prefix', 'partial typing still works');
  assert.match(partial.results[0].name, /^Chicken/);
  assert.equal(searchFoods('egg').match, 'all-words');
});

test('category-led names match their food', () => {
  assert.match(item('100 g salmon').food.name, /^Fish, salmon, (raw|NFS|baked)/);
  assert.equal(item('100 g paneer').food.name, 'Cheese, paneer');
  assert.equal(item('1 naan').grams, 177, 'a whole naan, not a quarter piece');
});

test('regional and spelling variants match the right food', () => {
  assert.match(item('100 g bean curd').food.name, /^Tofu/);
  assert.match(item('1 donut').food.name, /^Doughnut/);
});

test('curd and dahi are plain, unsweetened yogurt and keep a stated fat level', () => {
  for (const t of ['1 cup curd', '1 cup dahi', '200 g full fat curd']) {
    const name = item(t).food.name;
    assert.match(name, /whole milk/i, t);
    assert.match(name, /plain/i, t);
    assert.doesNotMatch(name, /greek|NFS|fruit|sweet/i, `${t}: not Greek, sweetened or the all-yogurt average`);
  }
  assert.match(item('200 g low fat curd').food.name, /low fat.*plain|plain.*low fat/i);
  assert.match(item('skim dahi').food.name, /nonfat.*plain|plain.*nonfat/i);
  assert.ok(item('1 cup curd').nutrients.calories.amount < 200, 'plain curd, not the 230 kcal sweetened average');
});

test('a word found only in another name in parentheses does not match', () => {
  assert.match(searchFoods('poha').results[0]?.name ?? '', /Poha \(flattened rice/, 'cooked poha, not groundcherries');
  assert.match(logText('1 plate poha').unmatched[0].suggestions[0].name, /^Poha \(flattened rice/, 'cooked poha is offered for a plate (a plate of it is asked about)');
  for (const q of ['poha fruit', 'poha berries', 'cape gooseberries', 'groundcherries']) {
    assert.match(searchFoods(q).results[0].name, /^Groundcherries/, q);
  }
  assert.match(searchFoods('skim milk').results.map((r) => r.name).join('|'), /Milk, fat free \(skim\)/, 'a word in the name itself still matches');
});

test('a plate or bowl is a cooked dish, never a dry, uncooked staple', () => {
  const oats = item('1 bowl oats');
  assert.match(oats.food.name, /prepared|cooked/i, 'cooked oats, not a bowl of raw oats');
  assert.ok(oats.nutrients.calories.amount < 250);
  for (const t of ['1 plate flour', '1 bowl dry lentils']) assert.equal(logText(t).items.length, 0, t);
  const r = logText('1 bowl wheat flour');
  assert.equal(r.items.length, 0, 'no cooked form: offered back, not logged');
  assert.match(r.unmatched[0].note, /dry, uncooked/);
  assert.ok(r.unmatched[0].suggestions.length > 0);
  assert.equal(item('100 g oats').food.name, 'Oats, raw', 'a stated weight logs the dry food');
  assert.match(item('1 bowl rice').food.name, /cooked/i, 'a cooked food is still logged');
  assert.match(item('1 bowl oatmeal').food.name, /^Oatmeal/);
});

test('plain foods are preferred over prepared forms', () => {
  assert.doesNotMatch(item('1 chicken breast').food.name, /coated|breaded|battered/i);
  assert.match(item('1 cup brown rice').food.name, /no added fat/);
});

test('a weak partial match is unmatched with suggestions, not logged', () => {
  const r = logText('1 cup butter chickpea');
  assert.equal(r.items.length, 0, 'not logged as a cup of butter');
  assert.equal(r.unmatched[0].reason, 'no confident match');
  assert.ok(r.unmatched[0].suggestions.length > 0);
  assert.deepEqual(r.totals, {});
  assert.match(item('homemade veggie burger').food.name, /^Veggie burger/, 'a word counts in its typed form too');
});

test('a misspelled search returns the respelled foods with didYouMean', () => {
  const r = searchFoods('panner', { limit: 3 });
  assert.equal(r.didYouMean, 'paneer');
  assert.match(r.results[0].name, /paneer/i);
  assert.equal(searchFoods('chiken curry').didYouMean, 'chicken curry');
  // Repeated letters and long vowels are one spelling (M7.3): matched as an equivalent form, not a guess.
  assert.equal(searchFoods('bananna').matchedAs, 'banana');
  assert.equal(searchFoods('samosaa').matchedAs, 'samosa');
});

test('correct spellings, partial typing and nonsense are not respelled', () => {
  for (const q of ['paneer', 'chicken curry', 'chick', 'tomatoe']) assert.equal(searchFoods(q).didYouMean, undefined, q);
  const nonsense = searchFoods('asdfgh');
  assert.equal(nonsense.didYouMean, undefined);
  assert.equal(nonsense.results.length, 0);
});

test('logging suggests a respelling instead of logging it', () => {
  const r = logText('2 rotis and 1 cup panner');
  assert.equal(r.items.length, 1, 'the roti is logged, the misspelled phrase is not');
  assert.equal(r.unmatched[0].text, '1 cup panner');
  assert.equal(r.unmatched[0].didYouMean, '1 cup paneer', 'the amount is kept in the respelled phrase');
  assert.match(r.unmatched[0].suggestions[0].name, /paneer/i);
  assert.equal(logText('asdfgh').unmatched[0].didYouMean, undefined);
});

test('words that ask for a variant still get it', () => {
  assert.match(item('iced tea').food.name, /iced/i);
  assert.match(item('chicken salad').food.name, /chicken/i);
});

test('searching a bare word lists the default first and still the rest', () => {
  const tea = searchFoods('tea', { limit: 10 }).results.map((r) => r.name);
  assert.equal(tea[0], 'Tea, hot, leaf, black');
  assert.ok(tea.length >= 5, 'other teas are still listed');
});

test('hot drinks without a size are one cup', () => {
  between(item('tea').grams, 230, 250, 'tea');
  between(item('coffee').grams, 230, 250, 'coffee');
  between(item('hot chocolate').grams, 230, 260, 'hot chocolate');
});

test('size words get realistic, ordered servings', () => {
  const [small, medium, large] = ['small', 'medium', 'large'].map((s) => item(`${s} fries`).grams);
  between(medium, 100, 140, 'medium fries');
  assert.ok(small < medium && medium < large, `${small} < ${medium} < ${large}`);
  assert.equal(item('2 medium fries').grams, 2 * medium);
});

test('search does not repeat the same food from another source', () => {
  const names = searchFoods('greek yogurt', { limit: 10 }).results.map((r) => r.name.toLowerCase());
  const wholePlain = names.filter((n) => /whole milk/.test(n) && /plain/.test(n));
  assert.equal(wholePlain.length, 1, names.join(' | '));
  const banana = searchFoods('banana', { limit: 10 }).results.map((r) => r.name);
  assert.ok(!(banana.includes('Banana, raw') && banana.includes('Bananas, raw')), 'singular and plural are one food');
  assert.equal(searchFoods('banana', { limit: 5 }).results.length, 5, 'a page stays full');
});

test('nonsense is unmatched, not guessed', () => {
  const r = logText('asdfgh qwerty');
  assert.equal(r.items.length, 0);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.totals.calories?.amount ?? 0, 0);
});

test('dishes the catalog lacks are unmatched, never logged as another food', () => {
  for (const phrase of ['1 cup butter tofu']) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, `${phrase} is not logged`);
    assert.equal(r.unmatched.length, 1, `${phrase} is listed as unmatched`);
  }
  for (const phrase of ['1 jalebi', 'lassi', 'butter chicken', 'poha', 'pav bhaji']) {
    assert.equal(logText(phrase).items.length, 1, `${phrase} logs a recipe dish`);
  }
  // A volume of the same dishes can't be weighed (no cited density), but the dish is still found and offered.
  for (const [phrase, food] of [['1 glass lassi', /^Lassi, sweet$/], ['1 cup butter chicken', /^Butter chicken$/], ['1 cup poha', /^Poha \(/]]) {
    assert.match(logText(phrase).unmatched[0].suggestions[0].name, food, `${phrase} offers the recipe dish`);
  }
});

test('common phrasings reach the USDA food that exists', () => {
  assert.equal(item('dal tadka').food.name, 'Dal');
  assert.equal(item('1 cup dal fry').food.name, 'Dal');
  assert.equal(item('masala chai').food.name, 'Tea, hot, with milk');
});

test('CoFID dishes are logged by English name or cited alias, without invented portions', () => {
  const rajma = item('rajma');
  assert.equal(rajma.food.name, 'Curry, red kidney bean, Punjabi, homemade');
  assert.equal(rajma.food.source, 'cofid');
  // CoFID has no household portions, so a volume of it has no cited density: offered, not weighed.
  const cup = logText('1 cup rajma');
  assert.equal(cup.items.length, 0);
  assert.equal(cup.unmatched[0].suggestions[0].name, 'Curry, red kidney bean, Punjabi, homemade');
  for (const [phrase, name] of [
    ['chana masala', /^Curry, chick pea, whole and tomato, Punjabi/], ['masoor dal', /red\/masoor dahl/],
    ['toor dal', /pigeon pea dahl/], ['khichdi', /^Khichadi/], ['aloo gobi', /^Curry, cauliflower and potato/],
    ['red kidney bean curry', /^Curry, red kidney bean/], ['chicken korma', /^Curry, chicken korma/i],
    ['bhindi masala', /^Curry, bhindi subji/], ['rogan josh', /lamb rogan josh/], ['tandoori chicken curry', /chicken tandoori/],
    ['1 masala dosa', /^Dosa, with filling/],
  ]) assert.match(item(phrase).food.name, name, phrase);
  assert.equal(item('100 g rajma').grams, 100);
});

test('a USDA food named exactly what was searched comes before CoFID dishes', () => {
  assert.equal(item('1 cup sambar').food.source, 'survey');
  assert.equal(item('1 samosa').food.name, 'Samosa');
  assert.equal(item('1 cup dal').food.name, 'Dal');
  assert.equal(searchFoods('sambar').results[0].source, 'survey');
});

test('a katori is 200 ml (ICMR-NIN 2024) and weighed through the food\'s own density', () => {
  const dal = item('1 katori dal');
  assert.equal(dal.unit, 'katori');
  assert.equal(dal.portionMethod, 'volume-conversion', 'USDA dal: 240 g per 236.6 ml cup');
  assert.equal(Math.round(dal.grams), 203, '200 ml of dal, not a 236.6 ml cup');
  assert.match(dal.portionBasis, /^katori, 200 ml \(ICMR-NIN 2024\)/);
  assert.equal(Math.round(item('2 katoris dal').grams), Math.round(2 * dal.grams));
  assert.equal(Math.round(item('half katori dal').grams), Math.round(dal.grams / 2));
  const rice = item('1 katori rice');
  assert.match(rice.food.name, /cooked/i);
  assert.equal(Math.round(rice.grams), 134, 'cooked rice is lighter than dal per ml');
  assert.equal(item('1 cup dal').grams, 240, 'a cup is still the USDA cup');
});

test('a small or large katori has no supported size: the food is offered and the amount asked for, never guessed', () => {
  for (const phrase of ['1 small katori dal', '1 large katori rice', '2 big katoris dal']) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, phrase);
    assert.equal(r.unmatched.length, 1, phrase);
    assert.ok(r.unmatched[0].suggestions?.length, `${phrase}: the food is offered`);
    assert.match(r.unmatched[0].note, /katori has no/, phrase);
  }
});

test('a volume of a food with no cited density is not weighed: no grams, the food offered, the amount kept', () => {
  // CoFID rajma (no portions), INDB kadai paneer (a "1 bowl" serving weight) and the kheer recipe (a default
  // "1 cup = 240 g") give no density, so water density, a recipe yield or a serving weight is never used.
  for (const [phrase, food] of [['1 katori kheer', /^Kheer/], ['1 katori rajma', /red kidney bean/i], ['1 katori kadai paneer', /^Kadhai Paneer$/], ['1 cup kheer', /^Kheer/], ['2 glasses lassi', /^Lassi, sweet$/]]) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, `${phrase}: nothing logged`);
    assert.equal(r.unmatched.length, 1, phrase);
    assert.equal(r.unmatched[0].text, phrase, `${phrase}: the phrase is kept as given`);
    assert.match(r.unmatched[0].suggestions[0].name, food, `${phrase}: the right food is offered`);
    assert.match(r.unmatched[0].note, /^no cited density for .+, so \d+(\.\d+)? (katori|cup|glass)\w* can't be weighed; give the amount in grams$/, phrase);
  }
  assert.match(logText('2 katori kheer').unmatched[0].note, /so 2 katori can't/, 'the quantity and unit are kept in the note');
  assert.equal(item('100 g kheer').grams, 100, 'grams are still taken as given');
});

test('a volume of a food with a cited USDA density is unchanged', () => {
  for (const [phrase, grams] of [['1 katori dal', 202.9], ['2 katori rice', 267.1], ['2 katori cooked rice', 267.1], ['1 katori curd', 207.1], ['1 katori sambar', 209.6], ['1 katori milk', 206.3], ['1 cup dal', 240]]) {
    const it = item(phrase);
    assert.equal(it.grams, grams, phrase);
    assert.match(it.portionMethod, /^(volume-conversion|portion)$/, phrase);
    assert.ok(['survey', 'sr_legacy', 'foundation'].includes(it.food.source), `${phrase}: ${it.food.source}`);
  }
});

test('a bowl is a provisional 200 ml through the food\'s USDA density, labelled as an assumption', () => {
  for (const [phrase, grams] of [['1 bowl dal', 202.9], ['1 bowl rice', 133.6], ['1 bowl curd', 207.1], ['1 bowl sambar', 209.6], ['2 bowls dal', 405.8]]) {
    const it = item(phrase);
    assert.equal(it.grams, grams, phrase);
    assert.equal(it.portionMethod, 'assumed-bowl', `${phrase}: the amount is an assumption and says so`);
    assert.match(it.portionBasis, /^bowl, provisionally 200 ml \(a Nutrikit assumption, not a measured bowl\)/, phrase);
  }
  const chips = item('1 bowl chips');
  assert.ok(chips.grams > 10, `a bowl of chips is not one chip (${chips.grams} g)`);
  const meal = logText('2 roti and 1 bowl dal').items;
  assert.deepEqual(meal.map((i) => [i.food.name, i.grams, i.portionMethod]), [['Chapati/Roti', 72, 'default-portion'], ['Dal', 202.9, 'assumed-bowl']]);
  assert.equal(item('1 cup dal').grams, 240, 'a cup is still the USDA cup');
});

test('a plate of plain cooked rice is an assumed 200 ml (from NIN\'s 1-cup rice serving), labelled; NIN defines no plate', () => {
  for (const [phrase, grams] of [['1 plate rice', 133.6], ['1 plate cooked rice', 133.6], ['2 plates rice', 267.1], ['half plate rice', 66.8]]) {
    const it = item(phrase);
    assert.equal(it.food.name, 'Rice, cooked, NFS', phrase);
    assert.equal(it.grams, grams, phrase);
    assert.equal(it.portionMethod, 'assumed-plate', phrase);
    assert.match(it.portionBasis, /^plate of rice, taken as 200 ml \(a Nutrikit assumption from NIN's 1-cup serving of rice, NIN 2011; NIN does not define a plate\)/, phrase);
  }
});

test('every other plate is asked about, never its serving weight; explicit piece counts are unchanged', () => {
  // Idli and upma: NIN's quantities disagree with USDA's weight or energy for the same food. Poha, biryani, pav bhaji
  // and pulao: no source gives a plate. A recipe's own "1 plate = 200 g" is a serving weight.
  for (const [phrase, food] of [['1 plate idli', /^Idli$/], ['1 plate upma', /^Upma$/], ['1 plate poha', /^Poha \(/], ['1 plate biryani', /biryani/i], ['half plate biryani', /biryani/i], ['1 plate pav bhaji', /^Pav bhaji/], ['2 plates jeera rice', /^Cumin pulao/]]) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, `${phrase}: nothing logged`);
    assert.equal(r.unmatched[0].text, phrase, `${phrase}: kept as given`);
    assert.match(r.unmatched[0].suggestions[0].name, food, phrase);
    assert.match(r.unmatched[0].note, /^a plate has no standard size, so [\d.]+ plate of .+ can't be weighed; give the amount in grams or pieces$/, phrase);
  }
  assert.match(logText('half plate biryani').unmatched[0].note, /so 0\.5 plate of/, 'the quantity is kept');
  assert.match(logText('2 plates jeera rice').unmatched[0].note, /so 2 plate of/);
  assert.equal(item('2 idli').grams, 76, 'an explicit count is unchanged (its NIN discrepancy is a separate finding)');
  assert.equal(item('1 bowl dal').portionMethod, 'assumed-bowl');
  assert.equal(item('1 glass milk').portionMethod, 'assumed-glass');
  assert.equal(item('1 katori dal').grams, 202.9);
});

test('a glass and a mug are a provisional 250 ml through the food\'s USDA density, labelled as assumptions', () => {
  for (const [phrase, grams, method] of [['1 glass milk', 257.8, 'assumed-glass'], ['2 glasses milk', 515.7, 'assumed-glass'], ['1 mug milk', 257.8, 'assumed-mug'], ['1 mug tea', 253.6, 'assumed-mug']]) {
    const it = item(phrase);
    assert.equal(it.grams, grams, phrase);
    assert.equal(it.portionMethod, method, `${phrase}: the amount is an assumption and says so`);
    const word = method.slice('assumed-'.length);
    assert.match(it.portionBasis, new RegExp(`^${word}, provisionally 250 ml \\(a Nutrikit assumption, not a measured ${word}\\)`), phrase);
    assert.match(it.food.source, /^(survey|sr_legacy|foundation)$/, phrase);
  }
  assert.equal(item('1 cup milk').grams, 244, 'a cup is still the USDA cup, never a glass');
  assert.equal(item('1 katori dal').grams, 202.9, 'katori unchanged');
  assert.equal(item('1 bowl dal').portionMethod, 'assumed-bowl', 'bowl unchanged');
});

test('a glass or mug of a food with no USDA density is asked about; its own glass serving is never the measure', () => {
  // Lassi's recipe "1 glass = 250 g" and aam panna's INDB "1 tall glass = 268 g" are serving weights.
  for (const [phrase, food] of [['1 glass lassi', /^Lassi, sweet$/], ['1 glass aam panna', /Aam panna/], ['2 mugs kheer', /^Kheer/], ['1 glass nimbu pani', /^Lemonade$/]]) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, `${phrase}: nothing logged`);
    assert.equal(r.unmatched[0].text, phrase, `${phrase}: kept as given`);
    assert.match(r.unmatched[0].suggestions[0].name, food, phrase);
    assert.match(r.unmatched[0].note, /^no cited density for .+, so \d+ (glass|mug) can't be weighed; give the amount in grams$/, phrase);
  }
  assert.match(logText('2 mugs kheer').unmatched[0].note, /so 2 mug can't/, 'the quantity is kept');
});

test('a bowl of a food with no cited density is asked about; a food\'s own bowl serving is never a bowl size', () => {
  // Kheer and kadai paneer have bowl servings (recipe 150 g, INDB 318 g), sweet corn soup an INDB 392 g serving:
  // serving weights, not bowl measures. Rajma (CoFID) has no portions at all.
  for (const [phrase, food] of [['1 bowl kheer', /^Kheer/], ['1 bowl rajma', /red kidney bean/i], ['1 bowl kadai paneer', /^Kadhai Paneer$/], ['1 bowl sweet corn soup', /^Sweet corn soup$/], ['2 bowls kheer', /^Kheer/]]) {
    const r = logText(phrase);
    assert.equal(r.items.length, 0, `${phrase}: nothing logged`);
    assert.equal(r.unmatched[0].text, phrase, `${phrase}: kept as given`);
    assert.match(r.unmatched[0].suggestions[0].name, food, phrase);
    assert.match(r.unmatched[0].note, /^no cited density for .+, so \d+ bowls? can't be weighed; give the amount in grams$/, phrase);
  }
  assert.match(logText('2 bowls kheer').unmatched[0].note, /so 2 bowl can't/, 'the quantity is kept');
});
