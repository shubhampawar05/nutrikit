// Packaged-food barcode lookup backed by Open Food Facts (open data, ODbL), cached in Postgres.
import type { Sql } from 'postgres';
import { scaleNutrients } from './nutrients.ts';
import type { NutrientMap, Per100g } from './types.ts';

/** The Open Food Facts product fields we request (external data: every field may be missing). */
export interface OffProduct {
  code: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  image_front_small_url?: string;
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
  imageUrl: string | null;
  per100g: Per100g;
  perServing: NutrientMap | null;
  source: 'openfoodfacts';
  license: string;
};

export interface BarcodeLookup {
  found: boolean;
  cached: boolean;
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
  calories: ['energy-kcal_100g', 1], protein: ['proteins_100g', 1], fat: ['fat_100g', 1],
  carbs: ['carbohydrates_100g', 1], fiber: ['fiber_100g', 1], sugar: ['sugars_100g', 1],
  addedSugar: ['added-sugars_100g', 1], saturatedFat: ['saturated-fat_100g', 1], transFat: ['trans-fat_100g', 1],
  monounsaturatedFat: ['monounsaturated-fat_100g', 1], polyunsaturatedFat: ['polyunsaturated-fat_100g', 1],
  cholesterol: ['cholesterol_100g', 1000], sodium: ['sodium_100g', 1000], potassium: ['potassium_100g', 1000],
  calcium: ['calcium_100g', 1000], iron: ['iron_100g', 1000], magnesium: ['magnesium_100g', 1000],
  zinc: ['zinc_100g', 1000], vitaminA: ['vitamin-a_100g', 1e6], vitaminC: ['vitamin-c_100g', 1000],
  vitaminD: ['vitamin-d_100g', 1e6], caffeine: ['caffeine_100g', 1000], alcohol: ['alcohol_100g', 1],
};

export function fromOpenFoodFacts(product: OffProduct): BarcodeProduct {
  const n = product.nutriments || {};
  const per100g: Per100g = {};
  for (const [key, [field, mult]] of Object.entries(OFF_MAP)) {
    if (n[field] !== undefined && n[field] !== '' && !Number.isNaN(Number(n[field]))) per100g[key] = Number(n[field]) * mult;
  }
  if (per100g.calories == null && n['energy_100g'] != null) per100g.calories = Number(n['energy_100g']) / 4.184; // kJ
  for (const k of Object.keys(per100g)) per100g[k] = Math.round(per100g[k] * 1000) / 1000; // drop float noise from unit conversion
  const servingGrams = Number(product.serving_quantity) || null;
  return {
    barcode: product.code,
    name: product.product_name || product.generic_name || null,
    brand: product.brands || null,
    packageSize: product.quantity || null,
    servingSize: product.serving_size || null,
    servingGrams,
    imageUrl: product.image_front_small_url || null,
    per100g,
    perServing: servingGrams ? scaleNutrients(per100g, servingGrams) : null,
    source: 'openfoodfacts',
    license: 'ODbL (Open Food Facts contributors)',
  };
}

/**
 * Look up a barcode. Returns { found, product?, cached }.
 * @param {import('postgres').Sql} sql
 * @param {string} code
 * @param {{fetch?: typeof fetch, offline?: boolean}} opts
 */
export async function lookupBarcode(sql: Sql, code: string, { fetch: doFetch = globalThis.fetch, offline = process.env.NUTRIKIT_OFFLINE === '1' }: BarcodeLookupOptions = {}): Promise<BarcodeLookup> {
  const [cached] = await sql<{ payload: BarcodeProduct | null; fetched_at: Date }[]>`SELECT payload, fetched_at FROM barcode_cache WHERE code = ${code}`;
  const fresh = cached && Date.now() - cached.fetched_at.getTime() < CACHE_DAYS * 864e5;
  if (cached && (fresh || offline)) {
    return cached.payload ? { found: true, cached: true, product: cached.payload } : { found: false, cached: true };
  }
  if (offline) return { found: false, cached: false, offline: true };

  const fields = 'code,product_name,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,image_front_small_url';
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
