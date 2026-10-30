// Writes docs/openapi.json from the route schemas (the server also serves it live at /openapi.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// No queries run while generating the spec; the pool never connects.
const app = await buildApp({ databaseUrl: process.env.DATABASE_URL || 'postgres://localhost/unused' });
await app.ready();
const spec = app.swagger();
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/openapi.json'), JSON.stringify(spec, null, 2) + '\n');
await app.close();
console.log('wrote docs/openapi.json with', Object.keys(spec.paths ?? {}).length, 'paths');
