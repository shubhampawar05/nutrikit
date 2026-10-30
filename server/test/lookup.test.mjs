import { sql } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUnit, parseQuantity } from '../src/domain/units.ts';
import { searchFoods } from '../src/domain/search.ts';
import { logText } from '../src/domain/textlog.ts';
import { generateMealPlan } from '../src/domain/mealplan.ts';
import { createAccount, setPlan, requestUpgrade, PLANS } from '../src/domain/accounts.ts';

const BUILTINS = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

test('built-in object names are not units, numbers or synonyms', () => {
  for (const word of BUILTINS) {
    assert.equal(canonicalUnit(word), null, word);
    const { value } = parseQuantity(`${word} eggs`);
    assert.ok(value === null || typeof value === 'number', word);
    assert.doesNotThrow(() => searchFoods(word), word);
  }
  const log = logText('constructor eggs and a toString banana');
  for (const item of log.items) assert.ok(Number.isFinite(item.grams), `${item.input} has finite grams`);
  assert.doesNotThrow(() => generateMealPlan({ meals: ['constructor', 'lunch'], seed: 1 }));
});

test('built-in object names are not plans', async () => {
  const account = await createAccount(sql, { name: 'Proto', email: `proto-${Date.now()}@example.com`, password: 'correct horse battery' });
  for (const plan of BUILTINS) {
    await assert.rejects(setPlan(sql, account.id, plan), (e) => e.code === 'invalid_plan', plan);
    await assert.rejects(requestUpgrade(sql, account.id, plan), (e) => e.code === 'invalid_plan', plan);
  }
  assert.deepEqual(Object.keys(PLANS), ['free', 'starter', 'growth', 'enterprise']);
  assert.equal(JSON.parse(JSON.stringify(PLANS)).starter.name, 'Starter');
});
