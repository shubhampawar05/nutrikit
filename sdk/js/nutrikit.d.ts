// Type declarations for nutrikit.mjs

export type NutrientKey =
  | 'calories' | 'protein' | 'fat' | 'carbs' | 'fiber' | 'sugar' | 'addedSugar' | 'saturatedFat' | 'transFat'
  | 'monounsaturatedFat' | 'polyunsaturatedFat' | 'cholesterol' | 'sodium' | 'potassium' | 'calcium' | 'iron'
  | 'magnesium' | 'phosphorus' | 'zinc' | 'vitaminA' | 'vitaminC' | 'vitaminD' | 'vitaminE' | 'vitaminK'
  | 'thiamin' | 'riboflavin' | 'niacin' | 'vitaminB6' | 'folate' | 'vitaminB12' | 'caffeine' | 'alcohol' | 'water';

export interface NutrientAmount { amount: number; unit: string; dailyValuePercent: number | null }
export type NutrientMap = Partial<Record<NutrientKey, NutrientAmount>>;
export type FoodSource = 'survey' | 'foundation' | 'sr_legacy';

export interface SearchResult {
  query: string;
  relaxed: boolean;
  total: number;
  results: { id: number; name: string; source: FoodSource; category: string | null; score: number }[];
}

export interface Portion { label: string; amount: number; unit: string | null; grams: number }

export interface Food {
  id: number;
  name: string;
  source: FoodSource;
  category: string | null;
  per100g: Partial<Record<NutrientKey, number>>;
  portions: Portion[];
}

export interface FoodNutrients {
  food: { id: number; name: string };
  quantity: number;
  unit: string;
  grams: number;
  portionBasis: string | null;
  portionMethod: string;
  nutrients: NutrientMap;
}

export interface LoggedItem {
  input: string;
  food: { id: number; name: string; source: FoodSource };
  quantity: number;
  unit: string;
  grams: number;
  portionBasis: string | null;
  portionMethod: string;
  confidence: 'high' | 'medium' | 'low';
  nutrients: NutrientMap;
  alternatives: { id: number; name: string }[];
  recognition?: { label: string; confidence: 'high' | 'medium' | 'low' };
}

export interface LogResult {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  items: LoggedItem[];
  unmatched: { text: string; reason: string }[];
  totals: NutrientMap;
  provider: string;
  notes?: string;
}

export interface VoiceLogResult extends LogResult { transcript: string }

export interface BarcodeProduct {
  barcode: string;
  name: string | null;
  brand: string | null;
  packageSize: string | null;
  servingSize: string | null;
  servingGrams: number | null;
  imageUrl: string | null;
  per100g: Partial<Record<NutrientKey, number>>;
  perServing: NutrientMap | null;
  source: 'openfoodfacts';
  license: string;
  cached: boolean;
}

export interface LabelResult {
  source: 'text' | 'image';
  provider?: string;
  servingSize: string | null;
  servingGrams: number | null;
  servingsPerContainer: number | null;
  perServing: Partial<Record<NutrientKey, { amount: number; unit: string }>>;
  per100g: Partial<Record<NutrientKey, number>> | null;
  warnings: string[];
}

export type Diet = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'dairy-free' | 'gluten-free';
export type MealName = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealPlan {
  seed: number;
  diet: Diet;
  targets: { calories: number; proteinGrams: number };
  days: {
    day: number;
    meals: { meal: MealName; targetCalories: number; items: { food: { id: number; name: string }; grams: number; serving: string; nutrients: NutrientMap }[]; totals: NutrientMap }[];
    totals: NutrientMap;
  }[];
  notes: string[];
}

export interface Usage {
  keyId: string;
  accountId: string | null;
  periodStart: string;
  tokenLimit: number | null;
  used: number;
  remaining: number | null;
  byEndpoint: { endpoint: string; calls: number; tokens: number }[];
}

export interface AccessToken { access_token: string; token_type: 'Bearer'; expires_in: number; expires_at: string }

export type ImageInput = Blob | ArrayBuffer | ArrayBufferView | string;

export class NutrikitError extends Error {
  status: number;
  code: string;
  retryAfter: number | null;
}

export class Nutrikit {
  /** `baseUrl` defaults to the page's origin in a browser, otherwise `http://localhost:8787`. */
  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch; maxRetries?: number; timeoutMs?: number });
  lastUsage: { charged: number; remaining: number | null } | null;
  searchFoods(q: string, opts?: { limit?: number; offset?: number; source?: FoodSource }): Promise<SearchResult>;
  getFood(id: number): Promise<Food>;
  getNutrients(id: number, portion?: { quantity?: number; unit?: string; grams?: number }): Promise<FoodNutrients>;
  listNutrients(): Promise<{ nutrients: { key: NutrientKey; name: string; unit: string; dailyValue: number | null; group: string }[] }>;
  logText(text: string, opts?: { ai?: boolean }): Promise<LogResult>;
  logVoice(transcript: string, opts?: { ai?: boolean }): Promise<VoiceLogResult>;
  logPhoto(image: ImageInput, opts?: { mediaType?: string; hint?: string }): Promise<LogResult>;
  lookupBarcode(code: string): Promise<BarcodeProduct>;
  parseLabel(input: { text: string } | { image: ImageInput; mediaType?: string }): Promise<LabelResult>;
  createMealPlan(opts?: { calories?: number; proteinGrams?: number; diet?: Diet; meals?: MealName[]; days?: number; exclude?: string[]; seed?: number }): Promise<MealPlan>;
  getUsage(): Promise<Usage>;
  createAccessToken(): Promise<AccessToken>;
  voiceLog(opts?: { lang?: string; timeoutMs?: number; ai?: boolean }): Promise<VoiceLogResult>;
  static listen(opts?: { lang?: string; timeoutMs?: number }): Promise<string>;
  static scanBarcode(video: HTMLVideoElement, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<string>;
}

export default Nutrikit;
