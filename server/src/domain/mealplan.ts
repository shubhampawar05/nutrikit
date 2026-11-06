// Meal plan generation from the food catalog: picks a main and sides per meal from WWEIA
// categories, filters by diet, then scales portions toward a calorie target and protein floor.
// Deterministic for a given seed.
import { foods, getFood } from './db.ts';
import { resolvePortion } from './units.ts';
import { scaleNutrients, sumNutrients } from './nutrients.ts';
import type { Food, NutrientMap, Per100g } from './types.ts';
import { lookup } from './lookup.ts';

interface Slot {
  share: number;
  main: string[];
  sides: string[];
}

interface PoolRow {
  id: number;
  name: string;
  nutrients: string; // JSON per-100 g map
}

interface PoolEntry {
  id: number;
  name: string;
}

// A food in a meal before final scaling; `scale` is set on sides only.
interface PlanPart {
  food: Food;
  grams: number;
  portion: string | null;
  scale?: number;
}

export interface MealPlanRequest {
  calories?: number;
  proteinGrams?: number;
  diet?: string;
  meals?: string[];
  days?: number;
  exclude?: string[];
  seed?: number;
}

export interface MealPlanItem {
  food: { id: number; name: string };
  grams: number;
  serving: string;
  nutrients: NutrientMap;
}

export interface PlannedMeal {
  meal: string;
  targetCalories: number;
  items: MealPlanItem[];
  totals: NutrientMap;
}

// A meal while it is being built: parts/mult are replaced by items/totals before output.
interface MealDraft {
  meal: string;
  targetCalories: number;
  parts: PlanPart[];
  mult: number;
  items?: MealPlanItem[];
  totals?: NutrientMap;
}

export interface MealPlanDay {
  day: number;
  meals: PlannedMeal[];
  totals: NutrientMap;
}

export interface MealPlan {
  seed: number;
  diet: string;
  targets: { calories: number; proteinGrams: number };
  days: MealPlanDay[];
  notes: string[];
}

const SLOTS: Record<string, Slot> = lookup({
  breakfast: {
    share: 0.25,
    // Shares are renormalised over the meals requested.
    main: ['Eggs and omelets', 'Oatmeal', 'Pancakes, waffles, French toast', 'Egg/breakfast sandwiches', 'Yogurt, Greek', 'Ready-to-eat cereal, lower sugar (=<21.2g/100g)', 'Bagels and English muffins', 'Grits and other cooked cereals'],
    sides: ['Bananas', 'Blueberries and other berries', 'Apples', 'Citrus fruits', 'Strawberries', 'Milk, lowfat'],
  },
  lunch: {
    share: 0.325,
    main: ['Burritos and tacos', 'Deli and cured meat sandwiches', 'Chicken fillet sandwiches', 'Lettuce and lettuce salads', 'Soups, broth-based', 'Rice mixed dishes', 'Pasta mixed dishes, excludes macaroni and cheese', 'Bean, pea, legume dishes', 'Vegetable sandwiches/burgers', 'Seafood sandwiches', 'Cheese sandwiches'],
    sides: ['Apples', 'Carrots', 'Other fruits and fruit salads', 'Tomatoes', 'Lettuce and lettuce salads', 'Grapes'],
  },
  dinner: {
    share: 0.325,
    main: ['Chicken, whole pieces', 'Fish', 'Beef, excludes ground', 'Poultry mixed dishes', 'Meat mixed dishes', 'Seafood mixed dishes', 'Pasta mixed dishes, excludes macaroni and cheese', 'Stir-fry and soy-based sauce mixtures', 'Bean, pea, legume dishes', 'Soy and meat-alternative products', 'Pork', 'Shellfish'],
    sides: ['Broccoli', 'Rice', 'White potatoes, baked or boiled', 'String beans', 'Other dark green vegetables', 'Carrots', 'Pasta, noodles, cooked grains', 'Corn', 'Spinach', 'Vegetable dishes'],
  },
  snack: {
    share: 0.1,
    main: ['Nuts and seeds', 'Yogurt, regular', 'Apples', 'Bananas', 'Cottage/ricotta cheese', 'Other fruits and fruit salads', 'Nutrition bars', 'Popcorn'],
    sides: [],
  },
});

const MEAT = /\b(beef|pork|chicken|turkey|duck|lamb|veal|goat|venison|bacon|ham|sausage|pepperoni|salami|bologna|frankfurter|hot dog|meat(?!less)|meatball|liver|ribs?|steak|brisket|chorizo|gelatin|prosciutto|jerky)\b/i;
const SEAFOOD = /\b(fish|salmon|tuna|cod|tilapia|shrimp|crab|lobster|clam|oyster|scallop|anchov|sardine|seafood|catfish|trout|mussel|squid|octopus|halibut|flounder|haddock|pollock|mackerel|perch)\b/i;
const DAIRY = /\b(milk|cheese|yogurt|butter|cream|whey|custard|ice cream|pudding|alfredo|ranch|latte|mocha|cappuccino|macchiato|frappuccino)\b/i;
const ANIMAL = new RegExp(`${DAIRY.source}|\\b(egg|honey|mayonnaise|omelet|quiche)\\b`, 'i');
const GLUTEN = /\b(wheat|bread|pasta|noodle|spaghetti|macaroni|barley|rye|flour|cracker|bagel|biscuit|cake|cookie|pizza|bun|roll|tortilla, flour|waffle|pancake|french toast|muffin|sandwich|pretzel|couscous|breaded|coated|croissant|cereal)\b/i;
const NOT_PLANNABLE = /\b(baby|infant|toddler|formula|nfs|ns as to|frozen meal|from fast food|fast food|school)\b/i;

export const DIETS = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'dairy-free', 'gluten-free'];

function allowed(name: string, diet: string, exclude: string[]) {
  if (NOT_PLANNABLE.test(name)) return false;
  if (exclude.some((x) => x && name.toLowerCase().includes(x))) return false;
  const plant = /\b(meatless|vegetarian|vegan|plant-based|veggie|soy)\b/i.test(name);
  switch (diet) {
    case 'vegetarian': return plant || (!MEAT.test(name) && !SEAFOOD.test(name));
    case 'pescatarian': return plant || !MEAT.test(name);
    case 'vegan': return plant ? !ANIMAL.test(name.replace(/meatless|vegan|plant-based/gi, '')) : !MEAT.test(name) && !SEAFOOD.test(name) && !ANIMAL.test(name);
    case 'dairy-free': return !DAIRY.test(name) || /\b(dairy-free|non-dairy|plant-based)\b/i.test(name);
    case 'gluten-free': return !GLUTEN.test(name) || /\bgluten-free\b/i.test(name);
    default: return true;
  }
}

// Mulberry32 PRNG so a seed reproduces a plan.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const poolCache = new Map<string, PoolEntry[]>();
function pool(categories: string[], diet: string, exclude: string[]): PoolEntry[] {
  const key = JSON.stringify([categories, diet, exclude]);
  if (!poolCache.has(key)) {
    const rows = (foods()
      .prepare(`SELECT id, name, nutrients FROM foods WHERE source = 'survey' AND category IN (${categories.map(() => '?').join(',')})`)
      .all(...categories) as unknown as PoolRow[])
      .filter((r) => allowed(r.name, diet, exclude))
      // Survey names don't always reveal animal ingredients ("Chili, white"); plant foods carry no
      // cholesterol, so vegan picks must have essentially none.
      .filter((r) => diet !== 'vegan' || ((JSON.parse(r.nutrients) as Per100g).cholesterol ?? 0) <= 1)
      .map(({ id, name }) => ({ id, name }));
    poolCache.set(key, rows);
  }
  return poolCache.get(key)!;
}

// A realistic single serving: the food's default portion when it is 30-450 g, else the closest
// listed portion in that range, else 100 g.
function serving(food: Food): { grams: number; portion: string | null } {
  const p = resolvePortion(food, 1, null);
  if (p.grams >= 30 && p.grams <= 450) return { grams: p.grams, portion: p.portion };
  const fits = food.portions.filter((x) => x.grams / x.amount >= 30 && x.grams / x.amount <= 450);
  const pick = fits.sort((a, b) => Math.abs(a.grams / a.amount - 150) - Math.abs(b.grams / b.amount - 150))[0];
  return pick ? { grams: pick.grams / pick.amount, portion: pick.label } : { grams: 100, portion: null };
}

function item(food: Food, grams: number, portionLabel: string | null, multiplier: number): MealPlanItem {
  const g = Math.round(grams);
  return {
    food: { id: food.id, name: food.name },
    grams: g,
    serving: portionLabel ? `${Math.round(multiplier * 4) / 4} × ${portionLabel}` : `${g} g`,
    nutrients: scaleNutrients(food.per100g, g),
  };
}

/**
 * @param {{calories?: number, proteinGrams?: number, diet?: string, meals?: string[], days?: number,
 *          exclude?: string[], seed?: number}} req
 */
export function generateMealPlan(req: MealPlanRequest = {}): MealPlan {
  const calories = Math.min(Math.max(Number(req.calories) || 2000, 1000), 5000);
  const diet = DIETS.includes(req.diet as string) ? req.diet as string : 'omnivore';
  const meals = (req.meals?.length ? req.meals : ['breakfast', 'lunch', 'dinner', 'snack']).filter((m) => SLOTS[m]);
  const days = Math.min(Math.max(Number(req.days) || 1, 1), 7);
  const exclude = (req.exclude || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  const seed = Number.isInteger(req.seed) ? req.seed as number : Math.floor(Math.random() * 2 ** 31);
  const proteinGrams = Number(req.proteinGrams) || Math.round((calories * 0.2) / 4);
  const random = rng(seed);
  const shareTotal = meals.reduce((s, m) => s + SLOTS[m].share, 0);

  const plan: MealPlanDay[] = [];
  const used = new Set<number>();
  for (let d = 0; d < days; d++) {
    const dayMeals: MealDraft[] = [];
    for (const m of meals) {
      const slot = SLOTS[m];
      const target = (calories * slot.share) / shareTotal;
      const mains = pool(slot.main, diet, exclude).filter((r) => !used.has(r.id));
      if (!mains.length) continue;
      const main = getFood(mains[Math.floor(random() * mains.length)].id)!;
      used.add(main.id);
      const parts: PlanPart[] = [{ food: main, ...serving(main) }];
      const sides = pool(slot.sides, diet, exclude);
      if (sides.length) {
        const side = getFood(sides[Math.floor(random() * sides.length)].id)!;
        const sv = serving(side);
        // A side is at most 30% of the meal's calories (shrunk, never below a quarter serving).
        const sideKcal = ((side.per100g.calories || 0) * sv.grams) / 100;
        const shrink = sideKcal > target * 0.3 ? Math.max((target * 0.3) / sideKcal, 0.25) : 1;
        parts.push({ food: side, grams: sv.grams * shrink, portion: sv.portion, scale: shrink });
      }
      // Sides stay at one serving; the main absorbs the rest of the meal's calorie budget
      // (bounded so portions stay plausible).
      const kcalOf = (p: PlanPart) => ((p.food.per100g.calories || 0) * p.grams) / 100;
      const sideKcal = parts.slice(1).reduce((s, p) => s + kcalOf(p), 0);
      const mult = Math.min(Math.max((target - sideKcal) / (kcalOf(parts[0]) || 1), 0.5), 2.5);
      dayMeals.push({ meal: m, targetCalories: Math.round(target), parts, mult });
    }
    // Day-level pass: move any shortfall/excess onto mains that are not yet at a bound.
    const kcalOf = (p: PlanPart, k = 1) => ((p.food.per100g.calories || 0) * p.grams * k) / 100;
    for (let pass = 0; pass < 3; pass++) {
      const total = dayMeals.reduce((s, x) => s + x.parts.reduce((a, p, i) => a + kcalOf(p, i === 0 ? x.mult : 1), 0), 0);
      const gap = calories - total;
      const free = dayMeals.filter((x) => (gap > 0 ? x.mult < 2.5 : x.mult > 0.5));
      if (Math.abs(gap) < calories * 0.02 || !free.length) break;
      const mainKcal = free.reduce((s, x) => s + kcalOf(x.parts[0]), 0) || 1;
      for (const x of free) x.mult = Math.min(Math.max(x.mult + gap / mainKcal, 0.5), 2.5);
    }
    for (const x of dayMeals) {
      x.items = x.parts.map((p, i) => item(p.food, p.grams * (i === 0 ? x.mult : 1), p.portion, i === 0 ? x.mult : p.scale ?? 1));
      x.totals = sumNutrients(x.items.map((i) => i.nutrients));
      delete (x as Partial<MealDraft>).parts;
      delete (x as Partial<MealDraft>).mult;
    }
    // Summed over the day's foods (not meal totals), so `missingFrom` counts foods.
    const totals = sumNutrients(dayMeals.flatMap((x) => x.items!.map((i) => i.nutrients)));
    plan.push({ day: d + 1, meals: dayMeals as PlannedMeal[], totals });
  }
  return {
    seed,
    diet,
    targets: { calories, proteinGrams },
    days: plan,
    notes: [
      'Sides are one standard serving (at most 30% of the meal); each main is scaled (0.5x-2.5x) to fill its meal\'s share of the calorie target.',
      'Nutrient data: USDA FoodData Central (FNDDS survey foods). Not medical advice.',
    ],
  };
}
