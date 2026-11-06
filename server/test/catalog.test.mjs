// The built food catalog (data/foods.db): invariants the build guarantees, and pinned collision outcomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foods } from '../src/domain/db.ts';

const meta = (key) => foods().prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
const byName = (name) => foods().prepare('SELECT id, source FROM foods WHERE name = ?').all(name);

test('no nutrient amount is negative', () => {
  const negatives = foods().prepare("SELECT f.name, j.key, j.value FROM foods f, json_each(f.nutrients) j WHERE j.value < 0").all();
  assert.deepEqual(negatives, []);
  assert.ok(Number(meta('clamped')) > 0, 'the build records how many source values it clamped');
});

test('every food has calories and a single record per name', () => {
  assert.equal(foods().prepare("SELECT count(*) n FROM foods WHERE json_extract(nutrients, '$.calories') IS NULL").get().n, 0);
  assert.equal(foods().prepare('SELECT count(*) n FROM (SELECT lower(name) FROM foods GROUP BY 1 HAVING count(*) > 1)').get().n, 0);
  assert.ok(Number(meta('collisions')) > 0, 'the build records how many same-name collisions it resolved');
});

test('same-name collisions keep the record with more label nutrients, newest data on a tie', () => {
  // Equal label coverage: Foundation over SR Legacy.
  assert.deepEqual(byName("Pears, raw, bartlett (Includes foods for USDA's Food Distribution Program)").map((r) => r.source), ['foundation']);
  // Foundation lacks label values the SR Legacy record has.
  assert.deepEqual(byName('Kiwifruit, green, raw').map((r) => r.source), ['sr_legacy']);
  // FNDDS survey keeps its record against Foundation and SR Legacy.
  assert.deepEqual(byName('Broccoli, raw').map((r) => r.source), ['survey']);
});


test('the catalog holds only USDA foods', () => {
  const sources = foods().prepare('SELECT DISTINCT source FROM foods ORDER BY 1').all().map((r) => r.source);
  assert.deepEqual(sources, ['foundation', 'sr_legacy', 'survey']);
});
