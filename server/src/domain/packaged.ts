// Packaged foods from an Open Food Facts export (data/packaged.db, built by scripts/build-packaged.mjs).
// The committed store is the live set (products sold in India, and US products someone has scanned); every function
// here returns nothing when no store is present, and barcode lookups then fall back to the live Open Food Facts API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { OFF_LICENSE, offFrontImage, servingNutrients, type BarcodeProduct } from './barcode.ts';
import type { Per100g } from './types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const COUNTRIES = ['in', 'us'] as const;
export type Country = (typeof COUNTRIES)[number];

interface Store { db: DatabaseSync; keys: string[] }
let store: Store | null | undefined;
function open(): Store | null {
  if (store === undefined) {
    const file = path.resolve(ROOT, process.env.NUTRIKIT_PACKAGED_DB || 'data/packaged.db');
    if (!fs.existsSync(file)) return (store = null);
    const db = new DatabaseSync(file, { readOnly: true });
    const keys = db.prepare("SELECT value FROM meta WHERE key = 'nutrient_keys'").get() as { value: string };
    store = { db, keys: JSON.parse(keys.value) };
  }
  return store;
}

/** For tests: forget the opened store so the next call reopens it. */
export function resetPackaged(): void {
  store?.db.close();
  store = undefined;
}

interface Row {
  code: string; name: string; brand: string | null; package: string | null; serving: string | null;
  serving_qty: number | null; serving_unit: 'g' | 'ml' | null; per_ml: number; image: string | null;
  updated: number | null; nutrients: string;
}

function toProduct(r: Row, keys: string[]): BarcodeProduct {
  const per100g: Per100g = {};
  (JSON.parse(r.nutrients) as (number | null)[]).forEach((v, i) => { if (v != null) per100g[keys[i]] = v; });
  const product: BarcodeProduct = {
    barcode: r.code,
    name: r.name,
    brand: r.brand,
    packageSize: r.package,
    servingSize: r.serving,
    servingGrams: r.serving_unit === 'g' ? r.serving_qty : null,
    servingMl: r.serving_unit === 'ml' ? r.serving_qty : null,
    imageUrl: r.image ? offFrontImage(r.code, r.image) : null,
    basis: r.per_ml ? '100ml' : '100g',
    per100g,
    perServing: null,
    issues: [], // only products that passed the label checks are stored
    updatedAt: r.updated ? new Date(r.updated * 1000).toISOString().slice(0, 10) : null,
    source: 'openfoodfacts',
    license: OFF_LICENSE,
  };
  product.perServing = servingNutrients(product);
  return product;
}

// OFF keeps UPC-A codes as 13-digit EAN with a leading 0, so a 12-digit scan matches either form.
const codeForms = (code: string) => (code.length === 12 ? [code, `0${code}`] : code.length === 13 && code.startsWith('0') ? [code, code.slice(1)] : [code]);

export function packagedByBarcode(code: string): BarcodeProduct | null {
  const s = open();
  if (!s) return null;
  const stmt = s.db.prepare('SELECT * FROM products WHERE code = ?');
  for (const form of codeForms(code)) {
    const row = stmt.get(form) as Row | undefined;
    if (row) return toProduct(row, s.keys);
  }
  return null;
}

export type PackagedHit = BarcodeProduct & { barcodes: string[] };
export interface PackagedSearch {
  query: string;
  total: number;
  results: PackagedHit[];
}

/**
 * Packaged products whose name or brand contain every word of the query (word prefixes), best match first. One
 * product sold under several barcodes (same name, brand and label values) is one result listing all its barcodes.
 * @returns null when no store is present
 */
export function searchPackaged(q: string, { limit = 10, offset = 0, country }: { limit?: number; offset?: number; country?: Country } = {}): PackagedSearch | null {
  const s = open();
  if (!s) return null;
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return { query: q, total: 0, results: [] };
  const match = words.map((w) => `"${w}"*`).join(' ');
  const hits = `hits AS (
    SELECT p.*, bm25(products_fts, 10, 3) AS rank,
      lower(p.name) || char(9) || lower(coalesce(p.brand, '')) || char(9) || p.per_ml || p.nutrients AS product
    FROM products_fts JOIN products p ON p.rowid = products_fts.rowid
    WHERE products_fts MATCH ? AND p.searchable = 1${country ? ` AND p.country_${country} = 1` : ''})`;
  const { n } = s.db.prepare(`WITH ${hits} SELECT count(DISTINCT product) n FROM hits`).get(match) as { n: number };
  // Name hits outweigh brand hits; among equals, products more people have scanned come first. Each product is
  // shown by its most-scanned barcode.
  const rows = s.db.prepare(`WITH ${hits}, grouped AS (
      SELECT *, row_number() OVER (PARTITION BY product ORDER BY scans DESC, code) AS nth,
        min(rank) OVER (PARTITION BY product) AS best, max(scans) OVER (PARTITION BY product) AS most,
        group_concat(code, ' ') OVER (PARTITION BY product) AS codes
      FROM hits)
    SELECT * FROM grouped WHERE nth = 1 ORDER BY best, most DESC, code LIMIT ? OFFSET ?`).all(match, limit, offset) as unknown as (Row & { codes: string })[];
  return {
    query: q,
    total: n,
    results: rows.map((r) => ({ ...toProduct(r, s.keys), barcodes: [r.code, ...r.codes.split(' ').filter((c) => c !== r.code).sort()] })),
  };
}

/** The export the store was built from (meta.source), or null. */
export function packagedSource(): Record<string, unknown> | null {
  const row = open()?.db.prepare("SELECT value FROM meta WHERE key = 'source'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}
