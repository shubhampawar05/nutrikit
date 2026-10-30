// Starts the Nutrikit server: `npm start` -> http://localhost:8787
import { buildApp } from './app.ts';
import { getProvider } from './domain/providers/index.ts';
import { billingInfo } from './domain/billing.ts';

const PORT = Number(process.env.PORT || 8787);

// In production the access-token secret must be fixed, so tokens survive a database reset and every
// instance signs with the same key (development generates one and keeps it in the database).
if (process.env.NODE_ENV === 'production' && !process.env.NUTRIKIT_TOKEN_SECRET) {
  console.error('NUTRIKIT_TOKEN_SECRET is required when NODE_ENV=production (e.g. `openssl rand -hex 32`)');
  process.exit(1);
}
const app = await buildApp();
await app.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' });
console.log(`nutrikit API on http://localhost:${PORT}  (AI provider: ${(await getProvider()).name}, auth: ${process.env.NUTRIKIT_AUTH === 'off' ? 'off' : 'on'}, billing: ${billingInfo().mode || 'off'})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
