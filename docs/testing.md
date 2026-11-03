# Testing

Everything needs only Node and Docker.

| Command | What it runs |
|---|---|
| `npm test` | Everything below. Starts the local Postgres, and the app image for the browser test |
| `npm run test:unit` | Server (71 tests), web (45 Vitest tests), MCP (5 tests) |
| `npm run test:e2e` | Builds the image, then a Playwright run: sign up → dashboard → create key → search |
| `npm run multi-instance -w e2e` | Two app containers on one database: shared rate limits, login throttling, sessions |

## Good to know

- Server tests create a throwaway database per file on `TEST_DATABASE_URL` and drop it afterwards.
- AI providers are faked or stubbed, so tests need no network or API keys.
- Playwright installs its browser inside `node_modules`.
- Run the smoke test against a deployment with `E2E_BASE_URL=https://… npm test -w e2e`.
