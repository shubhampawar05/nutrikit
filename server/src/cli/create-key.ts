// Creates an API key directly in the app database (the plaintext key is printed once).
//   npm run create-key -- "my app" [monthlyTokenLimit]
// In the Docker image: node dist/cli/create-key.js "my app"
import { createKey } from '../domain/auth.ts';
import { createSql, closeAll } from '../pg.ts';

const [name = 'local development', limit] = process.argv.slice(2);
const key = await createKey(createSql(), { name, tokenLimit: limit ? Number(limit) : null });
await closeAll();
console.log(`id:    ${key.id}\nname:  ${key.name}\nlimit: ${key.tokenLimit ?? 'unlimited'} tokens/month\nkey:   ${key.key}\n\nStore the key now; only its hash is kept.`);
