// MCP tools over the Nutrikit SDK. Each tool is a thin wrapper around one SDK call; results are
// returned as JSON text (and as structuredContent) so any MCP client can read them.

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Nutrikit, NutrikitError } from '@nutrikit/sdk';
import { z } from 'zod';

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};

// Reads a local image for photo logging / label scanning. MCP clients pass paths, not bytes.
async function readImage(path: string) {
  const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`unsupported image type: ${path} (use jpg, png, webp or gif)`);
  return { image: new Uint8Array(await readFile(path)), mediaType };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
}

function fail(err: unknown): CallToolResult {
  const e = err as Partial<NutrikitError> & Error;
  const code = e.code ? ` (${e.code})` : '';
  const hint = e.code === 'quota_exceeded' ? ' The monthly token allowance is used up.'
    : e.status === 401 ? ' Check NUTRIKIT_API_KEY.'
    : e.code === 'ai_provider_unavailable' ? ' This needs ANTHROPIC_API_KEY or OPENAI_API_KEY set on the Nutrikit server.'
    : '';
  return { isError: true, content: [{ type: 'text', text: `Nutrikit error${code}: ${e.message}.${hint}` }] };
}

async function call(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try { return ok(await fn()); } catch (err) { return fail(err); }
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const diets = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'dairy-free', 'gluten-free'] as const;
const meals = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export function createServer(nk: Nutrikit): McpServer {
  const server = new McpServer({ name: 'nutrikit', version: '0.1.0' });

  server.registerTool('search_foods', {
    title: 'Search foods',
    description: 'Search the USDA-based food catalog by name. Returns food ids to use with get_food_nutrients.',
    inputSchema: {
      query: z.string().min(1).describe('Food name, e.g. "greek yogurt" or "brown rice cooked"'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
      source: z.enum(['survey', 'foundation', 'sr_legacy']).optional().describe('Restrict to one USDA dataset'),
    },
    annotations: { title: 'Search foods', ...readOnly },
  }, ({ query, limit, source }) => call(() => nk.searchFoods(query, { limit: limit ?? 10, source })));

  server.registerTool('get_food_nutrients', {
    title: 'Get food nutrients',
    description: 'Full nutrient breakdown (macros, vitamins, minerals, % daily value) for a food id and portion. ' +
      'Give grams, or quantity with a unit such as "cup", "slice", "large".',
    inputSchema: {
      foodId: z.number().int().positive().describe('Id from search_foods'),
      grams: z.number().positive().optional(),
      quantity: z.number().positive().optional(),
      unit: z.string().optional().describe('Portion unit, e.g. "cup", "tbsp", "medium"'),
    },
    annotations: { title: 'Get food nutrients', ...readOnly },
  }, ({ foodId, grams, quantity, unit }) => call(() => nk.getNutrients(foodId, { grams, quantity, unit })));

  server.registerTool('log_meal_text', {
    title: 'Log a meal from text',
    description: 'Turn a free-text meal description ("2 eggs, a slice of toast and black coffee") into matched foods, ' +
      'portions and nutrient totals. Set ai=true for messy or conversational input (needs AI on the server).',
    inputSchema: {
      text: z.string().min(1).describe('What was eaten, in plain language'),
      ai: z.boolean().optional().describe('Use the AI parser instead of the rule-based one'),
    },
    annotations: { title: 'Log a meal from text', ...readOnly },
  }, ({ text, ai }) => call(() => nk.logText(text, { ai })));

  server.registerTool('log_meal_photo', {
    title: 'Log a meal from a photo',
    description: 'Recognise the foods in a local photo of a meal and estimate portions and nutrients. Needs AI on the server.',
    inputSchema: {
      imagePath: z.string().min(1).describe('Absolute path to a jpg, png, webp or gif file'),
      hint: z.string().optional().describe('Optional context, e.g. "restaurant portion" or "this is dal makhani"'),
    },
    annotations: { title: 'Log a meal from a photo', ...readOnly },
  }, ({ imagePath, hint }) => call(async () => {
    const { image, mediaType } = await readImage(imagePath);
    return nk.logPhoto(image, { mediaType, hint });
  }));

  server.registerTool('lookup_barcode', {
    title: 'Look up a barcode',
    description: 'Packaged-food details and nutrients for an EAN/UPC barcode, from Open Food Facts.',
    inputSchema: { barcode: z.string().regex(/^\d{6,14}$/).describe('EAN-8, EAN-13, UPC-A or UPC-E digits') },
    annotations: { title: 'Look up a barcode', readOnlyHint: true, openWorldHint: true },
  }, ({ barcode }) => call(() => nk.lookupBarcode(barcode)));

  server.registerTool('parse_nutrition_label', {
    title: 'Parse a nutrition label',
    description: 'Extract serving size and per-serving nutrients from a Nutrition Facts label, given either its text ' +
      'or a local photo of it (photos need AI on the server).',
    inputSchema: {
      text: z.string().optional().describe('The label text'),
      imagePath: z.string().optional().describe('Absolute path to a photo of the label'),
    },
    annotations: { title: 'Parse a nutrition label', ...readOnly },
  }, ({ text, imagePath }) => call(async () => {
    if (text) return nk.parseLabel({ text });
    if (imagePath) return nk.parseLabel(await readImage(imagePath));
    throw new Error('give either text or imagePath');
  }));

  server.registerTool('create_meal_plan', {
    title: 'Create a meal plan',
    description: 'Generate a multi-day meal plan that hits calorie and protein targets for a diet, with per-meal nutrients.',
    inputSchema: {
      calories: z.number().int().min(1000).max(5000).optional().describe('Daily calories (default 2000)'),
      proteinGrams: z.number().int().min(20).max(400).optional(),
      diet: z.enum(diets).optional(),
      meals: z.array(z.enum(meals)).optional().describe('Meals per day (default breakfast, lunch, dinner)'),
      days: z.number().int().min(1).max(14).optional(),
      exclude: z.array(z.string()).optional().describe('Foods or ingredients to avoid, e.g. ["peanut", "mushroom"]'),
      seed: z.number().int().optional().describe('Reuse a seed to get the same plan again'),
    },
    annotations: { title: 'Create a meal plan', ...readOnly },
  }, (opts) => call(() => nk.createMealPlan(opts)));

  server.registerTool('get_usage', {
    title: 'Get API usage',
    description: 'Tokens used and remaining this month for the configured Nutrikit API key.',
    inputSchema: {},
    annotations: { title: 'Get API usage', ...readOnly },
  }, () => call(() => nk.getUsage()));

  server.registerResource('nutrients', 'nutrikit://nutrients', {
    title: 'Nutrient reference',
    description: 'Every nutrient Nutrikit reports, with its unit and FDA daily value.',
    mimeType: 'application/json',
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await nk.listNutrients(), null, 2) }],
  }));

  return server;
}
