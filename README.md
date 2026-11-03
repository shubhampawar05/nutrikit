# Nutrikit

[![npm](https://img.shields.io/npm/v/@nutrikit/sdk?label=%40nutrikit%2Fsdk)](https://www.npmjs.com/package/@nutrikit/sdk)
[![Live](https://img.shields.io/badge/live-nutrikit.onrender.com-e0462b)](https://nutrikit.onrender.com)

A self-hostable nutrition API, with a website, a developer portal, a JavaScript SDK and an MCP server.

**Try it:** [nutrikit.onrender.com](https://nutrikit.onrender.com) (free API key) ·
[Docs](https://nutrikit.onrender.com/docs) · [SDK on npm](https://www.npmjs.com/package/@nutrikit/sdk)

- **Search 13,000+ foods** and get 33 nutrients for any portion ("2 medium", "1.5 cups")
- **Log meals** from text, voice or a photo
- **Scan** barcodes and nutrition labels
- **Generate meal plans** for 6 diets
- **Sell access** with API keys, usage metering and Razorpay payments

Built on open data (USDA, Open Food Facts). AI features (photos, labels) use Claude or OpenAI and are optional.
This is a clean-room build. [CLEAN-ROOM.md](CLEAN-ROOM.md) records what it was and wasn't derived from.

## Quick start

Needs **Node 22.13+** and **Docker**. Run everything from the repository root.

```bash
npm install
cp .env.example .env           # local settings
docker compose up -d postgres  # database on localhost:5433
npm run migrate                # create the tables
npm run dev                    # API on http://localhost:8787
npm run dev:web                # second terminal: website on http://localhost:5173
```

Open http://localhost:5173, sign up, and create an API key in the dashboard.

## How it fits together

```
 Browser / app ──► Fastify server (one process, port 8787)
                     ├─ /            website, docs, developer portal, /admin   (React app in web/)
                     ├─ /v1/*        REST API                                   (server/src/routes)
                     └─ /webhooks/*  Razorpay
                          │
                          ├─► PostgreSQL     accounts, keys, usage, payments, sessions
                          ├─► foods.db       read-only SQLite food catalog (built in)
                          └─► Claude/OpenAI  only for photo and label features
```

| Folder | What's inside |
|---|---|
| `server/` | API server (Fastify + TypeScript), SQL migrations, tests, food catalog |
| `web/` | Website, docs, developer portal and playground (React + Vite) |
| `sdk/js/` | JavaScript SDK, published as `@nutrikit/sdk` ([README](sdk/js/README.md)) |
| `mcp/` | MCP server, so Claude and other AI clients can use the API ([README](mcp/README.md)) |
| `e2e/` | Playwright smoke test |
| `docker/`, `render.yaml` | Production image and Render deployment |
| `openspec/` | Change proposals and designs |

## Use the API

```js
import { Nutrikit } from '@nutrikit/sdk';

const nk = new Nutrikit({ apiKey: 'nk_...', baseUrl: 'https://nutrikit.onrender.com' });  // or http://localhost:8787

await nk.logText('2 eggs, a slice of toast and coffee with milk');
await nk.lookupBarcode('3017624010701');
await nk.createMealPlan({ calories: 1800, diet: 'vegetarian', days: 3 });
```

Every call costs tokens (1 for a search, up to 20 for a photo), counted against the key's monthly allowance.
The full API reference is served at `/docs/reference`.

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:web` | Run the API and the website with live reload |
| `npm run migrate` | Apply database migrations |
| `npm run create-key -- "my app"` | Create an API key from the command line |
| `npm test` | Run every test (unit, browser, multi-instance) |
| `npm run build` then `npm start` | Production build, served from one process |

## Documentation

| Guide | Read it when you want to… |
|---|---|
| [Deployment](docs/deployment.md) | Put the app online (free on Render + Supabase, or any Docker host) |
| [Configuration](docs/configuration.md) | See every environment variable |
| [API and features](docs/api.md) | Know what each endpoint does, what it costs, and its limits |
| [Developer platform](docs/platform.md) | Understand accounts, plans, the admin console and security |
| [Payments](docs/payments.md) | Set up Razorpay, in test mode or live |
| [Testing](docs/testing.md) | Run and understand the test suites |

## Data and attribution

- **USDA FoodData Central**: public domain (CC0).
- **Open Food Facts**: © Open Food Facts contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Daily values: FDA, 21 CFR 101.9.

Nutrient values are averages, not medical advice.
