# Testing

Everything needs only Node and Docker.

| Command | What it runs |
|---|---|
| `npm test` | Everything below. Starts the local Postgres, and the app image for the browser test |
| `npm run test:unit` | The server suite (Node test runner, against the local Postgres), the web app (Vitest) and the MCP server |
| `npm run test:e2e` | Builds the image, then a Playwright run: sign up → dashboard → create key → search |
| `npm run multi-instance -w e2e` | Two app containers on one database: shared rate limits, login throttling, sessions |
| `npm run benchmark` | The food-logging accuracy benchmark: scores, and every case that isn't right |
| `npm run eval:everyday -w server` | The everyday regression gate (set D): correct, safely uncertain or incorrect for 217 phrases |

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

## Everyday regression gate (set D)

[`server/data/eval/sets/D.source.json`](../server/data/eval/sets/D.source.json) holds 217 everyday phrases. Each says
what *should* happen:

- **log:** the foods, and a gram range where a cited portion or measure gives one
- **suggest:** no single right food, so a suggestion is offered
- **flag:** the right food, but its amount needs confirming

Each case carries a rationale and a source. Expected foods are exact, reviewed catalog names, anchored at both ends. `npm run eval:sets -w
server` builds the hashed `D.json` and refuses any "log" expectation that names no catalog food. Measures, plates and
sweets follow the adopted definitions in
[serving-reference.md §D](../openspec/changes/portion-logging-v2/serving-reference.md): grams come from a food's own
density, never 1 ml = 1 g, and an assumed amount (provisional bowl or glass, a NIN plate serving) must be labelled.

`npm run eval:everyday -w server` judges every phrase with rules-based logging (no AI):

- **correct:** the right foods, each amount inside its range, and any assumed amount labelled as one
- **safely uncertain:** nothing wrong logged; a food is listed unmatched instead. A case marked `uncertain` ("tea and
  biscuits": which biscuits?) scores this even when the app does exactly what it should, because asking is the best
  outcome it allows
- **incorrect:** a wrong food, an amount out of range, an unlabelled assumed amount, a food logged that should have
  been asked about, a user amount lost ("100 g chicken" must keep its 100 g), or a food silently dropped

`test/everyday-gate.test.mjs` runs it in `npm test` and fails on:

- any incorrect case not in [`D.known-incorrect.json`](../server/data/eval/sets/D.known-incorrect.json) (each listed
  case names its audit finding or the pending rule)
- any PR #43 regression case becoming incorrect
- a known case that has been fixed but is still listed

Every matching or portion change must pass this gate. Passing it does not mean every case is correct: the report
prints correct, safely uncertain, known incorrect and unexpected incorrect separately, and only an unexpected one
fails.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and every push to `main`:

- **test** (Node 22.16 and 24): `npm run typecheck`, a check that `server/docs/openapi.json` matches the routes
  (regenerate it with `npm run openapi`), the MCP server build, and `npm run test:unit` against a Postgres 16 service.
- **e2e** (pushes to `main` only): builds the compose stack, then the Playwright smoke test and the
  multi-instance check.

Render deploys every push to `main`, so protect `main` and require both `test` checks before merging
(see [Deployment](deployment.md#ci-and-branch-protection)).

## Good to know

- Server tests create a throwaway database per file on `TEST_DATABASE_URL` and drop it afterwards.
- AI providers are faked or stubbed, so tests need no network or API keys.
- Playwright installs its browser inside `node_modules`.
- Run the smoke test against a deployment with `E2E_BASE_URL=https://… npm test -w e2e`.
