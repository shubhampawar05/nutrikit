// Rebuilds a month's allowance counters (usage_periods) from the usage history.
//   npm run usage:reconcile [YYYY-MM]     default: the current UTC month
// In the Docker image: node dist/cli/reconcile-usage.js 2026-11
// In-flight reservations are dropped from the counter while it runs, so run it when traffic is quiet.
import { reconcileUsage } from '../domain/auth.ts';
import { createSql, closeAll } from '../pg.ts';

const month = process.argv[2] || new Date().toISOString().slice(0, 7);
const subjects = await reconcileUsage(createSql(), month);
await closeAll();
console.log(`usage:reconcile ${month}: rebuilt counters for ${subjects} account(s)/key(s) from the usage history`);
