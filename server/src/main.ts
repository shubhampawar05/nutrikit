// Starts the Nutrikit server: `npm start` -> http://localhost:8787
import { buildApp, configProblems } from './app.ts';
import { getProvider } from './domain/providers/index.ts';
import { billingInfo } from './domain/billing.ts';

const PORT = Number(process.env.PORT || 8787);

// Production needs settings that development defaults (see configProblems).
const problems = configProblems();
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
const app = await buildApp();
await app.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' });
app.log.info(`nutrikit API on http://localhost:${PORT}  (AI provider: ${(await getProvider()).name}, auth: ${process.env.NUTRIKIT_AUTH === 'off' ? 'off' : 'on'}, billing: ${billingInfo().mode || 'off'})`);

// A crash is logged and alerted before the process exits (as Node would without these handlers), so the
// platform restarts it.
const crash = (kind: string) => (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  app.log.fatal({ err }, kind);
  const exit = () => process.exit(1);
  setTimeout(exit, 6_000).unref();
  void app.monitor.alert('crash', `Server crashed (${kind})`, { error: `${err.name}: ${err.message}` }).finally(exit);
};
process.once('uncaughtException', crash('uncaught exception'));
process.once('unhandledRejection', crash('unhandled rejection'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
