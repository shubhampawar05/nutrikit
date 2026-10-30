// Applies (or reverts) schema migrations against DATABASE_URL.
//   npm run migrate              apply all pending migrations
//   npm run migrate -- down [n]  revert the last n migrations (default 1)
// In the Docker image: node dist/cli/migrate.js
import { migrate } from '../pg.ts';

const [direction = 'up', n] = process.argv.slice(2);
if (direction !== 'up' && direction !== 'down') throw new Error('usage: migrate [up|down] [count]');
const done = await migrate(process.env.DATABASE_URL, direction, direction === 'down' ? Number(n || 1) : undefined);
console.log(done.length ? `${direction}: ${done.map((m) => m.name).join(', ')}` : `${direction}: nothing to do`);
