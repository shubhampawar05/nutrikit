// Type declarations for nutrikit.mjs

export type NutrientKey =
  | 'calories' | 'protein' | 'fat' | 'carbs' | 'fiber' | 'sugar' | 'addedSugar' | 'saturatedFat' | 'transFat'
  | 'monounsaturatedFat' | 'polyunsaturatedFat' | 'cholesterol' | 'sodium' | 'potassium' | 'calcium' | 'iron'
  | 'magnesium' | 'phosphorus' | 'zinc' | 'vitaminA' | 'vitaminC' | 'vitaminD' | 'vitaminE' | 'vitaminK'
  | 'thiamin' | 'riboflavin' | 'niacin' | 'vitaminB6' | 'folate' | 'vitaminB12' | 'caffeine' | 'alcohol' | 'water';

export interface NutrientAmount {
  amount: number;
  unit: string;
  dailyValuePercent: number | null;
  /** Totals only: how many of the summed foods had no value for this nutrient (the amount is a lower bound). */
  missingFrom?: number;
}
export type NutrientMap = Partial<Record<NutrientKey, NutrientAmount>>;
/** USDA dataset, `cofid` (UK CoFID 2021, OGL), `indb` (INDB.xlsx dish totals), or `recipe` (cited compose). */
export type FoodSource = 'survey' | 'foundation' | 'sr_legacy' | 'cofid' | 'indb' | 'recipe';

export interface SearchResult {
  query: string;
  relaxed: boolean;
  /** How the results matched: every word whole, every word as a prefix, or any one word. Absent when nothing matched. */
  match?: 'all-words' | 'prefix' | 'any-word';
  /** Set when the query as typed matched no food well: the respelled query these results are for ("panner" -> "paneer"). */
  didYouMean?: string;
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
  /** `source` "ai-estimate" (id 0): a food the catalog lacks, logged from an AI estimate with low confidence. */
  food: { id: number; name: string; source: FoodSource | 'ai-estimate' };
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
  /**
   * Phrases not logged. A weak partial match is listed here with suggestions instead of being counted; a likely
   * misspelling carries `didYouMean`, the phrase respelled ("1 cup panner" -> "1 cup paneer"), to log after the user confirms.
   * `note` says why a phrase that matched a food was still held back (a plate or bowl of a dry, uncooked staple).
   */
  unmatched: { text: string; reason: 'no matching food' | 'no confident match'; suggestions?: { id: number; name: string }[]; didYouMean?: string; note?: string }[];
  totals: NutrientMap;
  provider: string;
  notes?: string;
}

export interface VoiceLogResult extends LogResult { transcript: string }

/** A packaged food from Open Food Facts. */
export interface PackagedProduct {
  barcode: string;
  name: string | null;
  brand: string | null;
  packageSize: string | null;
  servingSize: string | null;
  servingGrams: number | null;
  servingMl: number | null;
  imageUrl: string | null;
  /** What `per100g` is per: liquids are labelled per 100 ml. */
  basis: '100g' | '100ml';
  per100g: Partial<Record<NutrientKey, number>>;
  perServing: NutrientMap | null;
  /** Why the label values were withheld (they contradict each other); empty when they passed the checks. */
  issues: string[];
  /** When the Open Food Facts record was last edited (ISO date), or null. */
  updatedAt: string | null;
  source: 'openfoodfacts';
  license: string;
}

/** lookupBarcode() result. */
export interface BarcodeProduct extends PackagedProduct {
  cached: boolean;
  /** Served from the server's local Open Food Facts export rather than the live API. */
  local: boolean;
}

export interface PackagedSearchResult {
  query: string;
  total: number;
  /** `barcodes`: every barcode the product is sold under (same name, brand and label values), the shown one first. */
  results: (PackagedProduct & { barcodes: string[] })[];
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

export interface AdvisorAnswer {
  /** Markdown. */
  answer: string;
  /** True for medical, medication and other out-of-scope questions; `answer` then explains why. */
  declined: boolean;
  provider: string;
}

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
  /** 'test' for nk_test_ keys: they count against the team's separate test allowance. */
  mode: 'live' | 'test';
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
  /** HTTP status, or 0 when no response arrived (`code` 'network_error' or 'timeout'; the original error is `cause`). */
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
  /** Needs a server with a local packaged-foods export; otherwise rejects with 503 `packaged_foods_unavailable`. */
  searchBarcodes(q: string, opts?: { limit?: number; offset?: number; country?: 'in' | 'us' }): Promise<PackagedSearchResult>;
  parseLabel(input: { text: string } | { image: ImageInput; mediaType?: string }): Promise<LabelResult>;
  createMealPlan(opts?: { calories?: number; proteinGrams?: number; diet?: Diet; meals?: MealName[]; days?: number; exclude?: string[]; seed?: number }): Promise<MealPlan>;
  askAdvisor(question: string, opts?: { context?: string }): Promise<AdvisorAnswer>;
  getUsage(): Promise<Usage>;
  createAccessToken(): Promise<AccessToken>;
  voiceLog(opts?: { lang?: string; timeoutMs?: number; ai?: boolean }): Promise<VoiceLogResult>;
  static listen(opts?: { lang?: string; timeoutMs?: number }): Promise<string>;
  static scanBarcode(video: HTMLVideoElement, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<string>;
}

export default Nutrikit;
