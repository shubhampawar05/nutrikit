// Applies (or reverts) schema migrations against DATABASE_URL.
//   npm run migrate              apply all pending migrations
//   npm run migrate -- down [n]  revert the last n migrations (default 1)
// In the Docker image: node dist/cli/migrate.js
import { migrate } from '../pg.ts';

const [direction = 'up', n] = process.argv.slice(2);
if (direction !== 'up' && direction !== 'down') throw new Error('usage: migrate [up|down] [count]');
// pg waits forever on an unreachable host, which on a platform looks like a silent hang until the deploy
// times out. Name the host (never the password) and give up after 30 s.
const url = process.env.DATABASE_URL;
const host = url ? new URL(url).host : '(DATABASE_URL is not set)';
console.log(`migrate ${direction}: connecting to ${host}`);
const timer = setTimeout(() => {
  console.error(`migrate: no answer from ${host} after 30 s; check DATABASE_URL (host, port, network access)`);
  process.exit(1);
}, 30_000);
timer.unref();
const done = await migrate(url, direction, direction === 'down' ? Number(n || 1) : undefined);
clearTimeout(timer);
console.log(done.length ? `${direction}: ${done.map((m) => m.name).join(', ')}` : `${direction}: nothing to do`);
