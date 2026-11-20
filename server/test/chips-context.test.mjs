// "Chips" in context (2026-11-20). After a main ("egg and chips") chips may be french fries (British and Indian usage)
// or potato crisps (American), so they are asked about; "fish and chips" is a dish the catalog lacks, asked about whole.
// Alone, or with salsa or dip, chips keep their reviewed default. Only catalog foods are ever offered or logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logText, splitMealText } from '../src/domain/textlog.ts';
import { getFood } from '../src/domain/db.ts';

const FISH_AND_CHIPS = ['Fish, cod, fried', 'Fish, haddock, fried', 'Fish, NS as to type, fried', 'Potato, french fries, NFS'];
const CHIPS = ['Potato, french fries, NFS', 'Potato chips, NFS'];
const names = (r) => r.items.map((i) => i.food.name);

// Every suggestion is a real catalog food, by its own id.
const catalogBacked = (suggestions) => suggestions.forEach((s) => assert.equal(getFood(s.id)?.name, s.name, `${s.name} is in the catalog`));

test('fish and chips, in any spelling, is asked about whole: nothing logged, the phrase kept as written', () => {
  for (const text of ['fish and chips', 'fish & chips', 'fish n chips', 'Fish And Chips', 'fish  and  chips', '2 fish and chips', '1 plate fish and chips']) {
    const r = logText(text);
    assert.deepEqual(r.items, [], `${text}: no Fish, NFS, no crisps, no plate weight`);
    assert.equal(r.unmatched.length, 1, `${text}: one question, nothing dropped`);
    const [u] = r.unmatched;
    assert.equal(u.text, text, `${text}: the phrase and its quantity kept as written`);
    assert.equal(u.askOnly, true, 'never covered by an estimate');
    assert.deepEqual(u.suggestions.map((s) => s.name), FISH_AND_CHIPS);
    catalogBacked(u.suggestions);
  }
});

test('fish and chips with another food: the other food logs, the dish is asked about', () => {
  const r = logText('fish and chips with peas');
  assert.deepEqual(names(r), ['Peas, green, raw']);
  assert.deepEqual(r.unmatched.map((u) => u.text), ['fish and chips']);
});

test('chips after a main: the main logs as usual, the chips are asked about with fries and crisps offered', () => {
  for (const [text, main] of [
    ['egg and chips', 'Egg, whole, raw'], ['eggs and chips', 'Egg, whole, raw'], ['egg & chips', 'Egg, whole, raw'], ['egg with chips', 'Egg, whole, raw'],
    ['steak and chips', 'Beef, steak, NFS'], ['burger and chips', 'Hamburger, NFS'], ['burger, chips', 'Hamburger, NFS'], ['burger + chips', 'Hamburger, NFS'],
    ['cod and chips', 'Fish, cod, NFS'],
  ]) {
    const r = logText(text);
    assert.deepEqual(names(r), [main], `${text}: the main once, no crisps`);
    assert.equal(r.unmatched.length, 1, `${text}: the chips are not dropped`);
    assert.equal(r.unmatched[0].text, 'chips');
    assert.deepEqual(r.unmatched[0].suggestions.map((s) => s.name), CHIPS);
    catalogBacked(r.unmatched[0].suggestions);
  }
  // The chips' own amount is kept; the plate rule never weighs them.
  const plate = logText('2 eggs and 1 plate chips');
  assert.deepEqual(names(plate), ['Egg, whole, raw']);
  assert.deepEqual(plate.unmatched.map((u) => u.text), ['1 plate chips']);
  // An ambiguous main keeps its own question.
  assert.deepEqual(logText('chicken and chips').unmatched.map((u) => u.text), ['chicken', 'chips']);
});

test('chips alone or with a snack keep their reviewed default; explicit names are unchanged', () => {
  for (const [text, foods] of [
    ['chips', ['Potato chips, NFS']], ['chips and salsa', ['Potato chips, NFS', 'Salsa, NFS']], ['chips and dip', ['Potato chips, NFS', 'Dip, NFS']],
    ['salsa and chips', ['Salsa, NFS', 'Potato chips, NFS']], ['french fries', ['Potato, french fries, NFS']], ['potato chips', ['Potato chips, NFS']],
    ['mac and cheese', ['Macaroni or noodles with cheese']], ['rice and beans', ['Rice, cooked, NFS', 'Beans, NFS']], ['bread and butter', ['Bread, white', 'Butter, NFS']],
  ]) {
    const r = logText(text);
    assert.deepEqual(names(r), foods, text);
    assert.deepEqual(r.unmatched, [], text);
  }
  // Fried cod and haddock are asked about today (USDA names them "Fish, cod, fried"): never logged as another food.
  for (const text of ['fried cod', 'fried haddock']) {
    const r = logText(text);
    assert.deepEqual(r.items, []);
    assert.match(r.unmatched[0].suggestions[0].name, /^Fish, (cod|haddock), fried$/);
  }
});

test('the splitter keeps a joined phrase as written and records what each food came after', () => {
  assert.deepEqual(splitMealText('Mac And Cheese').items.map((i) => i.text), ['Mac And Cheese']);
  assert.deepEqual(splitMealText('egg and chips').items.map((i) => [i.food, i.after ?? null]), [['egg', null], ['chips', 'egg']]);
  assert.deepEqual(splitMealText('egg; chips').items.map((i) => i.after ?? null), [null, null], 'a semicolon starts a new thought');
});
