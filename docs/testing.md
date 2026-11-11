# Testing

Everything needs only Node and Docker.

| Command | What it runs |
|---|---|
| `npm test` | Everything below. Starts the local Postgres, and the app image for the browser test |
| `npm run test:unit` | Server (71 tests), web (45 Vitest tests), MCP (5 tests) |
| `npm run test:e2e` | Builds the image, then a Playwright run: sign up → dashboard → create key → search |
| `npm run multi-instance -w e2e` | Two app containers on one database: shared rate limits, login throttling, sessions |
| `npm run benchmark` | The food-logging accuracy benchmark: scores, and every case that isn't right |

## Food-logging accuracy benchmark

[`server/test/benchmark-cases.mjs`](../server/test/benchmark-cases.mjs) lists phrases with what they *should* log:
the food (and a weight range), "unmatched" (nothing in the catalog is right, or a misspelling to suggest), or a gap (a
dish the catalog lacks, which must never be logged as a different food). `known` marks Nutrikit's open bugs.

`npm run benchmark` prints the headline score, **correctly handled** (the right food, or rightly not logged: a
rejected uncertain phrase counts as success, not as a miss), then top-1 and top-3 match accuracy, the wrong-food rate,
the unmatched rate, portion accuracy, **provenance** (logged items that name their data source and how their weight was
found) and **estimated portions** (weights resting on an assumption such as water density or a 100 g serving), plus
every case that isn't right. The same cases run in `npm test`: each must hold except `known` bugs
(reported as todo), and no case may log a wrong food. Add a case for every bug fixed and every food added, and when a
`known` bug is fixed, remove its `known` so the test guards it.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and every push to `main`:

- **test** (Node 22.16 and 24): `npm run typecheck` and `npm run test:unit` against a Postgres 16 service.
- **e2e** (pushes to `main` only): builds the compose stack, then the Playwright smoke test and the
  multi-instance check.

Render deploys every push to `main`, so protect `main` and require both `test` checks before merging
(see [Deployment](deployment.md#ci-and-branch-protection)).

## Good to know

- Server tests create a throwaway database per file on `TEST_DATABASE_URL` and drop it afterwards.
- AI providers are faked or stubbed, so tests need no network or API keys.
- Playwright installs its browser inside `node_modules`.
- Run the smoke test against a deployment with `E2E_BASE_URL=https://… npm test -w e2e`.
