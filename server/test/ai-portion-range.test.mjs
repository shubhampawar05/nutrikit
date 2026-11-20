// AI servings outside a food's believable range (tasks M3.2, M3.3). Inputs come from fake estimates; the expected
// outcomes are range checks, never hard-coded nutrient values. No AI call is made.
import { sql } from './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESTIMATE_PROMPT_VERSION } from '../src/domain/providers/prompts.ts';
import { ESTIMATE_CALC_VERSION, coverUnknowns, estimateItem } from '../src/domain/foodrequests.ts';
import { unsupportedAmount } from '../src/domain/units.ts';

const PER100 = { calories: 300, protein: 6, fat: 12, carbs: 42, fiber: 2, sugar: 10, saturatedFat: 4, sodium: 200 };
const est = (name, serving) => ({
  name, per100g: PER100, serving, confidence: 'medium', provider: 'fake', model: 'fake-1', at: new Date().toISOString(), sameAs: null,
  promptVersion: ESTIMATE_PROMPT_VERSION, calcVersion: ESTIMATE_CALC_VERSION,
});
const piece = (grams, quantity = 1) => ({ label: `${quantity} piece${quantity > 1 ? 's' : ''}`, unit: 'piece', quantity, grams });

// [phrase, estimate name, AI serving, quantity asked, believable grams for that amount]
const PLAUSIBLE = [
  ['poori', 'Poori (deep-fried wheat bread)', piece(50, 2), 2, [30, 320]],
  ['samosa', 'Samosa, potato filling', piece(70), 2, [40, 320]],
  ['masala vada', 'Masala vada (chana dal fritter)', piece(35), 3, [24, 360]],
  ['vegetable cutlet', 'Vegetable cutlet', piece(60), 2, [60, 300]],
  ['gulab jamun', 'Gulab jamun (in syrup)', piece(40), 2, [30, 160]],
  ['rasgulla', 'Rasgulla', piece(50), 1, [15, 80]],
  ['bhatura', 'Bhatura', piece(80), 1, [15, 160]],
  ['malai kofta', 'Malai kofta curry', { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 200 }, 1, [100, 400]],
  ['chole', 'Chole (chickpea curry)', { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 200 }, 1, [100, 400]],
  ['dal', 'Dal tadka', { label: '1 bowl', unit: 'bowl', quantity: 1, grams: 200 }, 1, [100, 400]],
  ['roti', 'Roti, whole wheat', piece(40), 3, [60, 300]],
  ['kulcha', 'Kulcha', piece(90), 1, [40, 160]],
];

for (const [phrase, name, serving, quantity, [low, high]] of PLAUSIBLE) {
  test(`${quantity} ${phrase}: a believable AI serving logs within ${low}-${high} g`, () => {
    const item = estimateItem(`${quantity} ${phrase}`, est(name, serving), { quantity, unit: null });
    assert.ok(!unsupportedAmount(item.portionMethod), item.portionBasis);
    assert.ok(item.grams >= low && item.grams <= high, `${item.grams} g`);
    assert.equal(item.food.source, 'ai-estimate');
  });
}

for (const [phrase, name, grams] of [
  ['gulab jamun', 'Gulab jamun (in syrup)', 250],
  ['rasgulla', 'Rasgulla', 342],
  ['besan ladoo', 'Besan ladoo', 5],
  ['kaju barfi', 'Kaju barfi', 200],
]) {
  test(`2 ${phrase}: an AI piece of ${grams} g is not believable, so the amount is asked about`, () => {
    const item = estimateItem(`2 ${phrase}`, est(name, piece(grams)), { quantity: 2, unit: null });
    assert.ok(unsupportedAmount(item.portionMethod));
    assert.match(item.portionBasis, /not believable for one piece/);
  });
}

test('a gram amount is never questioned: "300 g gulab jamun" logs 300 g from any serving', () => {
  const item = estimateItem('300 g gulab jamun', est('Gulab jamun', piece(250)), { quantity: 300, unit: 'g' });
  assert.ok(!unsupportedAmount(item.portionMethod));
  assert.equal(item.grams, 300);
});

test('through coverUnknowns, an implausible stored piece leaves the phrase unmatched with the reason', async () => {
  await sql`INSERT INTO food_requests (phrase, example, reason, estimate, estimate_status)
    VALUES ('glorp jamun', '2 glorp jamun', 'no matching food', ${sql.json(est('Glorp jamun', piece(300)))}, 'approved')`;
  const unmatched = { text: '2 glorp jamun', reason: 'no matching food' };
  const { items } = await coverUnknowns(sql, [{ unmatched, food: 'glorp jamun', amount: { quantity: 2, unit: null } }], null, { store: true, pending: false });
  assert.equal(items[0], null);
  assert.match(unmatched.note, /300 g a piece, not believable/);
});
