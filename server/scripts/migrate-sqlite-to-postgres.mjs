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

// Target table -> where its rows come from, in the order rows must be inserted. Timestamps are ISO strings in SQLite.
// The SQLite store predates teams: each of its accounts becomes a team (accounts) owned by a user with the same login
// (users + memberships), as migration 006 does in Postgres. `from`/`read` are the SQLite table and its columns;
// `map` turns a SQLite row into the target row.
const userOf = (accountId) => (accountId ? `usr_${String(accountId).replace(/^acct_/, '')}` : null);
const TABLES = {
  accounts: { from: 'accounts', read: ['id', 'name', 'plan', 'created_at'] },
  users: {
    from: 'accounts', read: ['id', 'email', 'name', 'password_hash', 'created_at'],
    map: (r) => ({ id: userOf(r.id), email: r.email, name: r.name, password_hash: r.password_hash, created_at: r.created_at }),
  },
  memberships: {
    from: 'accounts', read: ['id', 'created_at'],
    map: (r) => ({ account_id: r.id, user_id: userOf(r.id), role: 'owner', created_at: r.created_at }),
  },
  sessions: {
    from: 'sessions', read: ['id_hash', 'account_id', 'expires_at'],
    map: (r) => ({ ...r, user_id: userOf(r.account_id) }),
  },
  api_keys: {
    from: 'api_keys', read: ['id', 'key_hash', 'name', 'token_limit', 'account_id', 'created_at', 'revoked_at', 'last_used_at'],
    map: (r) => ({ ...r, created_by: userOf(r.account_id) }),
  },
  usage: { from: 'usage', read: ['id', 'key_id', 'account_id', 'endpoint', 'tokens', 'at'] },
  upgrade_requests: { from: 'upgrade_requests', read: ['id', 'account_id', 'plan', 'message', 'created_at'] },
  barcode_cache: { from: 'barcode_cache', read: ['code', 'payload', 'fetched_at'] },
  meta: { from: 'meta', read: ['key', 'value'] },
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
    for (const [table, { from, read, map }] of Object.entries(TABLES)) {
      const [{ n }] = await tx`SELECT COUNT(*) AS n FROM ${tx(table)}`;
      if (n > 0) throw new Error(`target table ${table} already has ${n} rows; copy into an empty database`);
      const rows = readRows(from, read).map(map ?? ((r) => r));
      const columns = rows.length ? Object.keys(rows[0]) : read;
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
