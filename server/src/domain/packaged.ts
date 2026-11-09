// Packaged foods from an Open Food Facts export (data/packaged.db, built by scripts/build-packaged.mjs).
// Optional: the file is built locally from a multi-GB export and not committed, so every function here returns
// nothing when it is absent and barcode lookups fall back to the live Open Food Facts API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { servingNutrients, type BarcodeProduct } from './barcode.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const COUNTRIES = ['in', 'us'] as const;
export type Country = (typeof COUNTRIES)[number];

let db: DatabaseSync | null | undefined;
/** The packaged-foods store, or null when it hasn't been built. */
export function packaged(): DatabaseSync | null {
  if (db === undefined) {
    const file = path.resolve(ROOT, process.env.NUTRIKIT_PACKAGED_DB || 'data/packaged.db');
    db = fs.existsSync(file) ? new DatabaseSync(file, { readOnly: true }) : null;
  }
  return db;
}

/** For tests: forget the opened store so the next call reopens it. */
export function resetPackaged(): void {
  db?.close();
  db = undefined;
}

// OFF keeps UPC-A codes as 13-digit EAN with a leading 0, so a 12-digit scan matches either form.
// Stored without perServing (it is most of the row); computed on read.
const product = (payload: string): BarcodeProduct => {
  const p = JSON.parse(payload) as BarcodeProduct;
  return { ...p, perServing: servingNutrients(p) };
};

const codeForms = (code: string) => (code.length === 12 ? [code, `0${code}`] : code.length === 13 && code.startsWith('0') ? [code, code.slice(1)] : [code]);

export function packagedByBarcode(code: string): BarcodeProduct | null {
  const store = packaged();
  if (!store) return null;
  const stmt = store.prepare('SELECT payload FROM products WHERE code = ?');
  for (const form of codeForms(code)) {
    const row = stmt.get(form) as { payload: string } | undefined;
    if (row) return product(row.payload);
  }
  return null;
}

export interface PackagedSearch {
  query: string;
  total: number;
  results: BarcodeProduct[];
}

/**
 * Packaged products whose name or brand contain every word of the query (word prefixes), best match first.
 * @returns null when the store hasn't been built
 */
export function searchPackaged(q: string, { limit = 10, offset = 0, country }: { limit?: number; offset?: number; country?: Country } = {}): PackagedSearch | null {
  const store = packaged();
  if (!store) return null;
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return { query: q, total: 0, results: [] };
  const match = words.map((w) => `"${w}"*`).join(' ');
  const where = `products_fts MATCH ?${country ? ` AND p.country_${country} = 1` : ''}`;
  const { n } = store.prepare(`SELECT count(*) n FROM products_fts JOIN products p ON p.rowid = products_fts.rowid WHERE ${where}`).get(match) as { n: number };
  // Name hits outweigh brand hits; among equals, products more people have scanned come first.
  const rows = store.prepare(`SELECT p.payload FROM products_fts JOIN products p ON p.rowid = products_fts.rowid WHERE ${where}
    ORDER BY bm25(products_fts, 10, 3), p.scans DESC LIMIT ? OFFSET ?`).all(match, limit, offset) as { payload: string }[];
  return { query: q, total: n, results: rows.map((r) => product(r.payload)) };
}

/** The export the store was built from (meta.source), or null. */
export function packagedSource(): Record<string, unknown> | null {
  const row = packaged()?.prepare("SELECT value FROM meta WHERE key = 'source'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}
