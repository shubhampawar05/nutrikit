// Applies pending migrations, then starts the server, in one process. For platforms whose start command
// can't chain two commands through a shell (Render's Docker Command passes quotes to sh literally).
// Only for a single instance: with several, migrate once per release instead (see docs/deployment.md).
// In the Docker image: node dist/cli/start.js
await import('./migrate.ts');
await import('../main.ts');
