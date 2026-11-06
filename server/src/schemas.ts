// Shared response schemas (registered with addSchema and referenced as { $ref: 'Name#' }) and
// helpers for describing responses. Responses are serialized with JSON.stringify, so these schemas
// document the API (openapi.json) and never strip fields.
import type { FastifyInstance } from 'fastify';
import { NUTRIENT_KEYS } from './domain/nutrients.ts';
import { COSTS } from './domain/auth.ts';

const nullable = (type: string) => ({ type: [type, 'null'] });

const SCHEMAS = {
  NutrientMap: { type: 'object', propertyNames: { enum: NUTRIENT_KEYS }, additionalProperties: { type: 'object', properties: { amount: { type: 'number' }, unit: { type: 'string' }, dailyValuePercent: nullable('integer') } } },
  SearchResult: { type: 'object', properties: { query: { type: 'string' }, relaxed: { type: 'boolean' }, match: { type: 'string', enum: ['all-words', 'prefix', 'any-word'], description: 'How the results matched; absent when nothing matched' }, total: { type: 'integer' }, results: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, source: { type: 'string' }, category: nullable('string'), score: { type: 'number' } } } } } },
  Food: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, source: { type: 'string' }, category: nullable('string'), per100g: { type: 'object' }, portions: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number' }, unit: nullable('string'), grams: { type: 'number' } } } } } },
  FoodNutrients: { type: 'object', properties: { food: { type: 'object' }, quantity: { type: 'number' }, unit: { type: 'string' }, grams: { type: 'number' }, portionBasis: nullable('string'), portionMethod: { type: 'string' }, nutrients: { $ref: 'NutrientMap#' } } },
  LogResult: { type: 'object', properties: { meal: nullable('string'), items: { type: 'array', items: { type: 'object', properties: { input: { type: 'string' }, food: { type: 'object' }, quantity: { type: 'number' }, unit: { type: 'string' }, grams: { type: 'number' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, nutrients: { $ref: 'NutrientMap#' }, alternatives: { type: 'array' } } } }, unmatched: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, reason: { type: 'string', enum: ['no matching food', 'no confident match'] }, suggestions: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } } } } }, totals: { $ref: 'NutrientMap#' }, provider: { type: 'string' }, transcript: { type: 'string' }, notes: { type: 'string' } } },
  BarcodeProduct: { type: 'object', properties: { barcode: { type: 'string' }, name: nullable('string'), brand: nullable('string'), servingSize: nullable('string'), servingGrams: nullable('number'), per100g: { type: 'object' }, perServing: { oneOf: [{ $ref: 'NutrientMap#' }, { type: 'null' }] }, source: { type: 'string' }, license: { type: 'string' }, cached: { type: 'boolean' } } },
  LabelResult: { type: 'object', properties: { source: { type: 'string', enum: ['text', 'image'] }, servingSize: nullable('string'), servingGrams: nullable('number'), servingsPerContainer: nullable('number'), perServing: { type: 'object' }, per100g: nullable('object'), warnings: { type: 'array', items: { type: 'string' } } } },
  Usage: { type: 'object', properties: { keyId: { type: 'string' }, periodStart: { type: 'string' }, tokenLimit: nullable('integer'), used: { type: 'integer' }, remaining: nullable('integer'), byEndpoint: { type: 'array' } } },
  Readiness: { type: 'object', properties: { status: { type: 'string', enum: ['ready', 'not_ready'] }, checks: { type: 'object', properties: { database: { type: 'string', enum: ['ok', 'fail'] }, catalog: { type: 'string', enum: ['ok', 'fail'] } } } } },
  Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
};

export function registerSchemas(app: FastifyInstance) {
  for (const [$id, schema] of Object.entries(SCHEMAS)) app.addSchema({ $id, title: $id, ...schema });
}

const ERRORS: Record<number, string> = {
  400: 'Invalid request', 401: 'Missing, invalid or expired credentials', 403: 'Credential not allowed for this operation',
  404: 'Not found', 413: 'Payload too large', 422: 'Input could not be processed',
  429: 'Rate limit or monthly token allowance exceeded', 501: 'AI provider not configured',
  502: 'Upstream source failed', 503: 'AI provider unavailable', 504: 'AI provider did not answer in time (ai_timeout); nothing is charged',
};

export const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [c, { description: ERRORS[c], $ref: 'Error#' }]));

const tokenHeaders = { 'X-Tokens-Charged': { type: 'integer' }, 'X-Tokens-Remaining': { type: 'integer' } };

/** 200 response of a metered call: the body schema plus the token headers. */
export const ok = (schema: object, description = 'OK') => ({ 200: { description, headers: tokenHeaders, ...schema } });

export const cost = (k: keyof typeof COSTS) => `Costs ${COSTS[k]} token(s)`;
