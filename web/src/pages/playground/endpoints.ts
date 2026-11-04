// Endpoint registry for the API playground.
import type {
  BarcodeProduct, Diet, FoodNutrients, LabelResult, LogResult, MealPlan, SearchResult, Usage, VoiceLogResult,
} from '../../sdk.ts';
import type { Nutrikit } from '../../sdk.ts';
import type { IconName } from '../../components/Icon.tsx';

export type FieldType = 'textarea' | 'checkbox' | 'select' | 'image' | 'text' | 'number';

export interface Field {
  name: string;
  type: FieldType;
  label: string;
  value?: string | number;
  examples?: string[];
  placeholder?: string;
  rows?: number;
  min?: number;
  max?: number;
  step?: number | string;
  inputmode?: 'numeric';
  hint?: string;
  options?: string[];
  optional?: boolean;
  mic?: boolean;
  scan?: boolean;
}

/** Raw form state: strings for inputs, booleans for checkboxes. */
export type RawValues = Record<string, string | boolean>;
/** Converted values, as the legacy values() produced them. */
export type Values = Record<string, string | number | boolean | undefined>;

export interface Built {
  pathParams?: Record<string, string | number | undefined>;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

export type Result =
  | { preview: 'log'; data: LogResult | VoiceLogResult }
  | { preview: 'search'; data: SearchResult }
  | { preview: 'nutrients'; data: FoodNutrients }
  | { preview: 'barcode'; data: BarcodeProduct }
  | { preview: 'label'; data: LabelResult }
  | { preview: 'plan'; data: MealPlan }
  | { preview: 'usage'; data: Usage };

export interface Endpoint {
  group: string;
  id: string;
  icon: IconName;
  title: string;
  method: 'GET' | 'POST';
  path: string;
  cost: string;
  desc: string;
  fields: Field[];
  /** Request shape, used for the cURL snippet. */
  build: (v: Values) => Built;
  /** The same request, sent through the SDK. */
  call: (nk: Nutrikit, v: Values) => Promise<Result>;
}

const s = (x: Values[string]): string => (typeof x === 'string' ? x : '');
const n = (x: Values[string]): number | undefined => (typeof x === 'number' ? x : undefined);
const b = (x: Values[string]): boolean => x === true;

const DIETS: Diet[] = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'dairy-free', 'gluten-free'];
const asDiet = (x: string): Diet | undefined => DIETS.find((d) => d === x);
const excludeList = (x: string) => (x ? x.split(',').map((t) => t.trim()).filter(Boolean) : undefined);

export const ENDPOINTS: Endpoint[] = [
  { group: 'Log meals', id: 'text', icon: 'text', title: 'Log from text', method: 'POST', path: '/v1/log/text', cost: '5 tokens',
    desc: 'Describe a meal in plain words. Every food is matched, sized and totalled.',
    fields: [
      { name: 'text', type: 'textarea', label: 'What did they eat?', value: '2 eggs, a slice of whole wheat toast and a coffee with milk', examples: ['a bowl of oatmeal with blueberries', 'For lunch I had a cheeseburger and medium fries', '200g salmon with 1 cup rice and broccoli'] },
      { name: 'ai', type: 'checkbox', label: 'Parse with AI (needs a server AI provider)' },
    ],
    build: (v) => ({ body: { text: v.text, ai: v.ai } }),
    call: async (nk, v) => ({ preview: 'log', data: await nk.logText(s(v.text), { ai: b(v.ai) }) }) },
  { group: 'Log meals', id: 'voice', icon: 'mic', title: 'Log from voice', method: 'POST', path: '/v1/log/voice', cost: '5 tokens',
    desc: 'Speak (or type) a transcript. Filler words are removed before logging.',
    fields: [
      { name: 'transcript', type: 'textarea', label: 'Transcript', value: 'um so I had like a banana and uh a greek yogurt', mic: true },
      { name: 'ai', type: 'checkbox', label: 'Parse with AI (needs a server AI provider)' },
    ],
    build: (v) => ({ body: { transcript: v.transcript, ai: v.ai } }),
    call: async (nk, v) => ({ preview: 'log', data: await nk.logVoice(s(v.transcript), { ai: b(v.ai) }) }) },
  { group: 'Log meals', id: 'photo', icon: 'camera', title: 'Log from a photo', method: 'POST', path: '/v1/log/photo', cost: '20 tokens + AI',
    desc: 'Upload a meal photo. Each food is recognised with an estimated weight. Needs a server AI provider.',
    fields: [
      { name: 'image', type: 'image', label: 'Meal photo' },
      { name: 'hint', type: 'text', label: 'Context (optional)', placeholder: 'e.g. restaurant portion' },
    ],
    build: (v) => ({ body: { image: v.image, hint: v.hint || undefined } }),
    // With no photo chosen the server answers "`image` ... is required", as it did for the legacy page.
    call: async (nk, v) => ({ preview: 'log', data: await nk.logPhoto(s(v.image), { hint: s(v.hint) || undefined }) }) },
  { group: 'Foods', id: 'search', icon: 'search', title: 'Search foods', method: 'GET', path: '/v1/foods/search', cost: '1 token',
    desc: 'Find foods by name. The everyday, as-eaten version ranks first.',
    fields: [
      { name: 'q', type: 'text', label: 'Query', value: 'greek yogurt', examples: ['banana', 'brown rice', 'pizza', 'almonds'] },
      { name: 'limit', type: 'number', label: 'Results', value: 8, min: 1, max: 50 },
    ],
    build: (v) => ({ query: { q: s(v.q), limit: n(v.limit) } }),
    call: async (nk, v) => ({ preview: 'search', data: await nk.searchFoods(s(v.q), { limit: n(v.limit) }) }) },
  { group: 'Foods', id: 'nutrients', icon: 'scale', title: 'Nutrients for a portion', method: 'GET', path: '/v1/foods/{id}/nutrients', cost: '1 token',
    desc: 'Nutrients for any amount of a food. Tip: pick a food from Search results.',
    fields: [
      { name: 'id', type: 'number', label: 'Food id', value: 2709224, hint: 'Banana, raw' },
      { name: 'quantity', type: 'number', label: 'Quantity', value: 2, step: 'any' },
      { name: 'unit', type: 'text', label: 'Unit', value: 'medium', examples: ['g', 'cup', 'medium', 'slice', 'oz'] },
    ],
    build: (v) => ({ pathParams: { id: n(v.id) }, query: v.unit === 'g' ? { grams: n(v.quantity) } : { quantity: n(v.quantity), unit: s(v.unit) } }),
    call: async (nk, v) => ({
      preview: 'nutrients',
      data: await nk.getNutrients(n(v.id) ?? Number.NaN, v.unit === 'g' ? { grams: n(v.quantity) } : { quantity: n(v.quantity), unit: s(v.unit) || undefined }),
    }) },
  { group: 'Packaged foods', id: 'barcode', icon: 'barcode', title: 'Barcode lookup', method: 'GET', path: '/v1/barcodes/{code}', cost: '5 tokens',
    desc: 'EAN or UPC code to product, serving size and nutrients (Open Food Facts).',
    fields: [{ name: 'code', type: 'text', label: 'Barcode', value: '3017624010701', inputmode: 'numeric', scan: true, examples: ['3017624010701', '5449000000996', '737628064502'] }],
    build: (v) => ({ pathParams: { code: s(v.code).trim() } }),
    call: async (nk, v) => ({ preview: 'barcode', data: await nk.lookupBarcode(s(v.code)) }) },
  { group: 'Packaged foods', id: 'label', icon: 'label', title: 'Read a nutrition label', method: 'POST', path: '/v1/labels/parse', cost: '5 tokens (text) · 20 + AI (photo)',
    desc: 'Paste Nutrition Facts text, or attach a label photo (photo needs a server AI provider).',
    fields: [
      { name: 'text', type: 'textarea', label: 'Label text', rows: 7, value: 'Nutrition Facts\n8 servings per container\nServing size 2/3 cup (55g)\nCalories 230\nTotal Fat 8g\nSaturated Fat 1g\nSodium 160mg\nTotal Carbohydrate 37g\nDietary Fiber 4g\nTotal Sugars 12g\nIncludes 10g Added Sugars\nProtein 3g' },
      { name: 'image', type: 'image', label: 'Or a label photo', optional: true },
    ],
    build: (v) => ({ body: v.image ? { image: v.image } : { text: v.text } }),
    call: async (nk, v) => ({ preview: 'label', data: await nk.parseLabel(v.image ? { image: s(v.image) } : { text: s(v.text) }) }) },
  { group: 'Planning', id: 'plan', icon: 'calendar', title: 'Generate a meal plan', method: 'POST', path: '/v1/meal-plans', cost: '20 tokens',
    desc: 'Plans for a calorie target and diet. The same seed reproduces the same plan.',
    fields: [
      { name: 'calories', type: 'number', label: 'Calories per day', value: 2000, min: 1000, max: 5000, step: 50 },
      { name: 'diet', type: 'select', label: 'Diet', value: 'vegetarian', options: DIETS },
      { name: 'days', type: 'number', label: 'Days', value: 1, min: 1, max: 7 },
      { name: 'exclude', type: 'text', label: 'Exclude (comma separated)', placeholder: 'mushroom, peanut' },
    ],
    build: (v) => ({ body: { calories: v.calories, diet: v.diet, days: v.days, exclude: excludeList(s(v.exclude)) } }),
    call: async (nk, v) => ({
      preview: 'plan',
      data: await nk.createMealPlan({ calories: n(v.calories), diet: asDiet(s(v.diet)), days: n(v.days), exclude: excludeList(s(v.exclude)) }),
    }) },
  { group: 'Account', id: 'usage', icon: 'chart', title: 'Usage this month', method: 'GET', path: '/v1/usage', cost: 'free',
    desc: 'Tokens used this month by your account, per endpoint.', fields: [],
    build: () => ({}),
    call: async (nk) => ({ preview: 'usage', data: await nk.getUsage() }) },
];

export const findEndpoint = (id: string): Endpoint => ENDPOINTS.find((e) => e.id === id) ?? ENDPOINTS[0];

/** Form defaults for an endpoint (the legacy form was re-rendered from these on every switch). */
export function defaults(ep: Endpoint): RawValues {
  const v: RawValues = {};
  for (const f of ep.fields) {
    if (f.type === 'image') continue;
    v[f.name] = f.type === 'checkbox' ? false : String(f.value ?? '');
  }
  return v;
}

export function defaultHints(ep: Endpoint): Record<string, string> {
  return Object.fromEntries(ep.fields.filter((f) => f.hint).map((f) => [f.name, f.hint ?? '']));
}

/** The legacy values(): trims text, turns numbers into numbers ('' → undefined), adds image data URLs. */
export function convert(ep: Endpoint, raw: RawValues, images: Record<string, string>): Values {
  const v: Values = {};
  for (const f of ep.fields) {
    const x = raw[f.name];
    if (f.type === 'image') v[f.name] = images[f.name];
    else if (f.type === 'checkbox') v[f.name] = x === true;
    else if (f.type === 'number') v[f.name] = typeof x === 'string' && x !== '' ? Number(x) : undefined;
    else v[f.name] = typeof x === 'string' ? x.trim() : '';
  }
  return v;
}

export interface Req { method: string; path: string; body?: Record<string, unknown> }

export function buildRequest(ep: Endpoint, v: Values): Req {
  const r = ep.build(v);
  let path = ep.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(r.pathParams?.[k] ?? ''));
  const qs = new URLSearchParams(
    Object.entries(r.query || {}).filter(([, x]) => x !== undefined && x !== '').map(([k, x]) => [k, String(x)]),
  ).toString();
  if (qs) path += `?${qs}`;
  return { method: ep.method, path, body: r.body };
}

export function curlFor(req: Req, origin: string): string {
  const lines = [`curl${req.method === 'GET' ? '' : ` -X ${req.method}`} "${origin}${req.path}"`, '  -H "Authorization: Bearer $NUTRIKIT_KEY"'];
  if (req.body) {
    const shown: unknown = JSON.parse(JSON.stringify(req.body, (k: string, x: unknown) => (k === 'image' && typeof x === 'string' && x.length > 60 ? `${x.slice(0, 40)}…(base64 image)` : x)));
    lines.push('  -H "Content-Type: application/json"', `  -d '${JSON.stringify(shown)}'`);
  }
  return lines.join(' \\\n');
}

export const HINTS: Record<string, string> = {
  unauthorized: 'Check the key, or log in so the playground can use your account automatically.',
  token_expired: 'Your access token expired. Paste a fresh one, or log in.',
  quota_exceeded: 'Your plan’s monthly tokens are used up. Upgrade from your dashboard.',
  rate_limited: 'Too many requests in a minute. Wait a moment and try again.',
  ai_provider_unavailable: 'AI features aren’t enabled on this server yet. Text logging, voice transcripts and label text still work.',
  invalid_barcode: 'Barcodes are 8, 12, 13 or 14 digits with a valid check digit.',
  no_key: '',
};

/** Legacy fmt(n, d): grouped number, up to d decimals, '—' for null. */
export const fmtN = (x: number | string | null | undefined, d = 0) =>
  x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d });
