// One-off copy of an existing SQLite application store (data/app.db) into Postgres.
//   node scripts/migrate-sqlite-to-postgres.mjs [path/to/app.db]
// Applies pending migrations, then copies every table in foreign-key order inside one transaction
// and prints source and target row counts. The target tables must be empty; the SQLite file is only read.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createSql, closeAll, migrate } from '../src/pg.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.resolve(process.argv[2] || path.join(ROOT, 'data/app.db'));

// Target table -> columns, in the order rows must be inserted. Timestamps are ISO strings in SQLite.
const TABLES = {
  accounts: ['id', 'email', 'name', 'password_hash', 'plan', 'created_at'],
  sessions: ['id_hash', 'account_id', 'expires_at'],
  api_keys: ['id', 'key_hash', 'name', 'token_limit', 'account_id', 'created_at', 'revoked_at', 'last_used_at'],
  usage: ['id', 'key_id', 'account_id', 'endpoint', 'tokens', 'at'],
  upgrade_requests: ['id', 'account_id', 'plan', 'message', 'created_at'],
  barcode_cache: ['code', 'payload', 'fetched_at'],
  meta: ['key', 'value'],
};
const SEQUENCES = { usage: 'usage_id_seq', upgrade_requests: 'upgrade_requests_id_seq' };
const BATCH = 1000;

const lite = new DatabaseSync(source, { readOnly: true });
const has = (table) => lite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const columnsOf = (table) => lite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

function readRows(table, columns) {
  if (!has(table)) return [];
  // Databases from before a column was added lack it; those rows get NULL.
  const present = new Set(columnsOf(table));
  const select = columns.map((c) => (present.has(c) ? c : `NULL AS ${c}`)).join(', ');
  return lite.prepare(`SELECT ${select} FROM ${table}`).all().map((row) => {
    const out = { ...row };
    if (table === 'barcode_cache') out.payload = row.payload == null ? null : JSON.parse(row.payload);
    return out;
  });
}

await migrate();
const sql = createSql();
const counts = [];
try {
  await sql.begin(async (tx) => {
    for (const [table, columns] of Object.entries(TABLES)) {
      const [{ n }] = await tx`SELECT COUNT(*) AS n FROM ${tx(table)}`;
      if (n > 0) throw new Error(`target table ${table} already has ${n} rows; copy into an empty database`);
      const rows = readRows(table, columns);
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        if (table === 'barcode_cache') {
          for (const r of batch) {
            await tx`INSERT INTO barcode_cache (code, payload, fetched_at) VALUES (${r.code}, ${r.payload == null ? null : tx.json(r.payload)}, ${r.fetched_at})`;
          }
        } else {
          await tx`INSERT INTO ${tx(table)} ${tx(batch, ...columns)}`;
        }
      }
      if (SEQUENCES[table]) await tx`SELECT setval(${SEQUENCES[table]}, COALESCE((SELECT MAX(id) FROM ${tx(table)}), 0) + 1, false)`;
      const [{ copied }] = await tx`SELECT COUNT(*) AS copied FROM ${tx(table)}`;
      counts.push({ table, source: rows.length, target: copied });
    }
  });
} finally {
  await closeAll();
}

console.table(counts);
const mismatched = counts.filter((c) => c.source !== c.target);
if (mismatched.length) {
  console.error(`row counts differ for: ${mismatched.map((c) => c.table).join(', ')}`);
  process.exit(1);
}
console.log(`copied ${source} into Postgres`);
