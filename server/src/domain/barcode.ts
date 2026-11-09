// Packaged-food barcode lookup backed by Open Food Facts (open data, ODbL), cached in Postgres.
import type { Sql } from 'postgres';
import { scaleNutrients } from './nutrients.ts';
import { packagedByBarcode } from './packaged.ts';
import type { NutrientMap, Per100g } from './types.ts';

/** The Open Food Facts product fields we request (external data: every field may be missing). */
export interface OffProduct {
  code: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  product_quantity_unit?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  /** Whether the label values were entered per 100 g or per serving (OFF then scales them to 100 g). */
  nutrition_data_per?: string;
  image_front_small_url?: string;
  last_modified_t?: number;
  nutriments?: Record<string, unknown>;
}

interface OffResponse {
  status?: number;
  product?: Omit<OffProduct, 'code'>;
}

// A type alias (not an interface) so it is assignable to postgres' JSONValue for sql.json().
export type BarcodeProduct = {
  barcode: string;
  name: string | null;
  brand: string | null;
  packageSize: string | null;
  servingSize: string | null;
  servingGrams: number | null;
  servingMl: number | null;
  imageUrl: string | null;
  /** What the nutrient values are per: OFF stores liquids per 100 ml under the same fields. */
  basis: '100g' | '100ml';
  per100g: Per100g;
  perServing: NutrientMap | null;
  /** Why the label values were withheld (they contradict each other); empty when they passed the checks. */
  issues: string[];
  /** When the Open Food Facts record was last edited (ISO date), or null. */
  updatedAt: string | null;
  source: 'openfoodfacts';
  license: string;
};

export interface BarcodeLookup {
  found: boolean;
  cached: boolean;
  /** Served from the local packaged-foods store (data/packaged.db). */
  local?: boolean;
  offline?: boolean;
  product?: BarcodeProduct;
}

export interface BarcodeLookupOptions {
  fetch?: typeof fetch;
  offline?: boolean;
}

const OFF_URL = process.env.NUTRIKIT_OFF_URL || 'https://world.openfoodfacts.org';
const USER_AGENT = 'Nutrikit/0.1 (self-hosted nutrition API)';
const CACHE_DAYS = 30;

/** GTIN-8/12/13/14 check-digit validation. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// OFF nutriment (per 100 g) -> catalog key and the multiplier from OFF's unit.
// OFF stores minerals/vitamins in grams; the catalog uses mg / mcg.
const OFF_MAP: Record<string, [string, number]> = {
  calories: ['energy-kcal', 1], protein: ['proteins', 1], fat: ['fat', 1],
  carbs: ['carbohydrates', 1], fiber: ['fiber', 1], sugar: ['sugars', 1],
  addedSugar: ['added-sugars', 1], saturatedFat: ['saturated-fat', 1], transFat: ['trans-fat', 1],
  monounsaturatedFat: ['monounsaturated-fat', 1], polyunsaturatedFat: ['polyunsaturated-fat', 1],
  cholesterol: ['cholesterol', 1000], sodium: ['sodium', 1000], potassium: ['potassium', 1000],
  calcium: ['calcium', 1000], iron: ['iron', 1000], magnesium: ['magnesium', 1000],
  zinc: ['zinc', 1000], vitaminA: ['vitamin-a', 1e6], vitaminC: ['vitamin-c', 1000],
  vitaminD: ['vitamin-d', 1e6], caffeine: ['caffeine', 1000], alcohol: ['alcohol', 1],
};
const KCAL_PER_KJ = 1 / 4.184;
const SODIUM_PER_SALT = 0.4; // EU Regulation 1169/2011 Annex I: salt = sodium x 2.5

// An OFF nutriment as a finite number, or null when it is absent, null, blank or not numeric (never 0 by accident).
const offNumber = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// A value as printed on the label, per 100 g/ml. OFF marks the values it calculated itself with the "~" modifier
// (its added-sugar estimate from the ingredients, kJ from kcal, sodium from salt), so those are not label values.
const labelValue = (n: Record<string, unknown>, field: string): number | null =>
  n[`${field}_modifier`] === '~' ? null : offNumber(n[`${field}_100g`]);

// US labels round each serving (21 CFR 101.9(c)): calories to the nearest 5 or 10, protein, carbohydrate and fat to
// the nearest 0.5 or 1 g. Scaled up from a small serving, that rounding moves the per-100 g values by up to:
const ROUNDING = { kcal: 5, grams: 0.5 };

/**
 * Checks a label's per-100 g (or ml) values against each other. A failure means at least one value was mistyped
 * (per-serving figures entered as per 100 g, kJ entered as kcal, a misplaced decimal); which one is unknowable, so
 * the caller withholds all of them. The limits allow for label rounding and general Atwater factors:
 * - no amount is negative, and energy is at most 900 kcal (100 g of pure fat at 9 kcal/g);
 * - per 100 g, protein + carbohydrate + fat + alcohol weigh at most 101 g (1 g of rounding);
 * - sugars are part of carbohydrate and saturated fat part of fat (1 g of rounding);
 * - energy is within 20% (+20 kcal) of the Atwater range: at most 4 x protein + 4 x carbohydrate + 9 x fat +
 *   7 x alcohol, at least 4 x protein + 9 x fat (all carbohydrate being fibre or polyols that give little energy).
 * @param roundedServing the serving size when the label gives values per serving: their rounding is then allowed
 *   for, scaled to 100 g (a 14 g serving rounded to 1 g of fat is up to 3.6 g of fat per 100 g off)
 * @returns the problems found, empty when the label is consistent
 */
export function labelIssues(per100g: Per100g, basis: '100g' | '100ml', roundedServing?: number | null): string[] {
  const issues: string[] = [];
  const { calories: kcal, protein = 0, carbs = 0, fat = 0, alcohol = 0, sugar, saturatedFat } = per100g;
  const scale = roundedServing && roundedServing < 100 ? 100 / roundedServing : 0;
  const kcalSlack = ROUNDING.kcal * scale, gramSlack = ROUNDING.grams * scale;
  if (Object.values(per100g).some((v) => v < 0)) issues.push('a value is negative');
  if (kcal != null && kcal > 900 + kcalSlack) issues.push(`${Math.round(kcal)} kcal per 100 ${basis.slice(3)} is more than pure fat`);
  const mass = protein + carbs + fat + alcohol;
  if (basis === '100g' && mass > 101 + 3 * gramSlack) issues.push(`protein, carbohydrate and fat add up to ${Math.round(mass)} g per 100 g`);
  if (sugar != null && per100g.carbs != null && sugar > carbs + 1 + 2 * gramSlack) issues.push('sugars exceed carbohydrate');
  if (saturatedFat != null && per100g.fat != null && saturatedFat > fat + 1 + 2 * gramSlack) issues.push('saturated fat exceeds fat');
  if (kcal != null && per100g.protein != null && per100g.carbs != null && per100g.fat != null) {
    const most = 4 * protein + 4 * carbs + 9 * fat + 7 * alcohol;
    const least = 4 * protein + 9 * fat;
    const slack = kcalSlack + 17 * gramSlack; // the calories' own rounding plus 4 + 4 + 9 kcal per gram rounded
    if (kcal > most * 1.2 + 20 + slack || kcal < least * 0.8 - 20 - slack) issues.push(`${Math.round(kcal)} kcal does not match the protein, carbohydrate and fat (${Math.round(least)}-${Math.round(most)} kcal)`);
  }
  return issues;
}

/** Nutrients for one serving, when the serving is in the unit the values are per (g and ml differ by density). */
export function servingNutrients(p: Pick<BarcodeProduct, 'basis' | 'per100g' | 'servingGrams' | 'servingMl' | 'issues'>): NutrientMap | null {
  const serving = p.basis === '100g' ? p.servingGrams : p.servingMl;
  return serving && !p.issues.length ? scaleNutrients(p.per100g, serving) : null;
}

/** OFF image folder: codes longer than 8 digits are padded to 13 and split 3/3/3/rest. */
export function offImagePath(code: string): string {
  if (code.length <= 8) return code;
  return code.padStart(13, '0').replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, '$1/$2/$3/$4');
}

/**
 * Map an Open Food Facts product to a BarcodeProduct, keeping only values printed on the label.
 * @param basisHint what the values are per when the source says so (OFF exports); otherwise inferred from the
 *   serving or package unit, as OFF stores liquids per 100 ml in its per-100 g fields
 */
export function fromOpenFoodFacts(product: OffProduct, basisHint?: '100g' | '100ml'): BarcodeProduct {
  const n = product.nutriments || {};
  const unit = (product.serving_quantity_unit || product.product_quantity_unit || '').toLowerCase();
  const basis = basisHint ?? (unit === 'ml' ? '100ml' : '100g');
  const per100g: Per100g = {};
  for (const [key, [field, mult]] of Object.entries(OFF_MAP)) {
    const v = labelValue(n, field);
    if (v != null) per100g[key] = v * mult;
  }
  const kj = labelValue(n, 'energy-kj') ?? labelValue(n, 'energy');
  if (per100g.calories == null && kj != null) per100g.calories = kj * KCAL_PER_KJ;
  const salt = labelValue(n, 'salt');
  if (per100g.sodium == null && salt != null) per100g.sodium = salt * SODIUM_PER_SALT * 1000;
  for (const k of Object.keys(per100g)) per100g[k] = Math.round(per100g[k] * 1000) / 1000; // drop float noise from unit conversion
  const servingAmount = Number(product.serving_quantity) || null;
  const servingUnit = (product.serving_quantity_unit || 'g').toLowerCase();
  const issues = labelIssues(per100g, basis, product.nutrition_data_per === 'serving' ? servingAmount : null);
  const out: BarcodeProduct = {
    barcode: product.code,
    name: product.product_name || product.generic_name || null,
    brand: product.brands || null,
    packageSize: product.quantity || null,
    servingSize: product.serving_size || null,
    servingGrams: servingUnit === 'g' ? servingAmount : null,
    servingMl: servingUnit === 'ml' ? servingAmount : null,
    imageUrl: product.image_front_small_url || null,
    basis,
    per100g: issues.length ? {} : per100g,
    perServing: null,
    issues,
    updatedAt: product.last_modified_t ? new Date(product.last_modified_t * 1000).toISOString().slice(0, 10) : null,
    source: 'openfoodfacts',
    license: 'ODbL (Open Food Facts contributors)',
  };
  out.perServing = servingNutrients(out);
  return out;
}

/**
 * Look up a barcode: the local packaged-foods store, then the Postgres cache, then the live Open Food Facts API.
 * Returns { found, product?, cached, local? }.
 * @param {import('postgres').Sql} sql
 * @param {string} code
 * @param {{fetch?: typeof fetch, offline?: boolean}} opts
 */
export async function lookupBarcode(sql: Sql, code: string, { fetch: doFetch = globalThis.fetch, offline = process.env.NUTRIKIT_OFFLINE === '1' }: BarcodeLookupOptions = {}): Promise<BarcodeLookup> {
  const local = packagedByBarcode(code);
  if (local) return { found: true, cached: false, local: true, product: local };
  const [cached] = await sql<{ payload: BarcodeProduct | null; fetched_at: Date }[]>`SELECT payload, fetched_at FROM barcode_cache WHERE code = ${code}`;
  // Products cached before the label checks existed have no `issues` and are fetched again.
  const checked = cached && (cached.payload === null || Array.isArray(cached.payload.issues));
  const fresh = checked && Date.now() - cached.fetched_at.getTime() < CACHE_DAYS * 864e5;
  if (cached && (fresh || offline)) {
    return cached.payload ? { found: true, cached: true, product: cached.payload } : { found: false, cached: true };
  }
  if (offline) return { found: false, cached: false, offline: true };

  const fields = 'code,product_name,generic_name,brands,quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments,image_front_small_url,last_modified_t';
  // A timeout or network failure is the same 502 as a bad response from the source.
  const unavailable = (detail: string) => Object.assign(new Error('barcode source did not respond; try again later'), { status: 502, logDetail: `open food facts ${code}: ${detail}` });
  let res: Response;
  try {
    res = await doFetch(`${OFF_URL}/api/v2/product/${code}.json?fields=${fields}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw unavailable((err as Error).name === 'TimeoutError' ? 'timed out after 8000 ms' : (err as Error).message);
  }
  if (res.status === 404) {
    await cache(sql, code, null);
    return { found: false, cached: false };
  }
  if (!res.ok) throw Object.assign(new Error(`barcode source returned ${res.status}`), { status: 502 });
  const body = (await res.json()) as OffResponse;
  const product = body.status === 1 && body.product ? fromOpenFoodFacts({ ...body.product, code }) : null;
  await cache(sql, code, product);
  return product ? { found: true, cached: false, product } : { found: false, cached: false };
}

function cache(sql: Sql, code: string, product: BarcodeProduct | null) {
  return sql`INSERT INTO barcode_cache (code, payload, fetched_at) VALUES (${code}, ${product ? sql.json(product) : null}, now())
    ON CONFLICT (code) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`;
}
