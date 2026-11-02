# @nutrikit/mcp

An [MCP](https://modelcontextprotocol.io) server for the Nutrikit API. It lets Claude (Desktop, Code) and
other MCP clients look up foods, log meals from text and photos, scan barcodes and nutrition labels, and
build meal plans, all backed by USDA FoodData Central and Open Food Facts.

> "I had 2 eggs, toast and a banana for breakfast. How much protein is that?"
> "Plan me 3 vegetarian days at 1800 kcal, no peanuts."
> "What's in this?" *(with a photo path)*

## Tools

| Tool | What it does |
|---|---|
| `search_foods` | Search the food catalog by name; returns food ids |
| `get_food_nutrients` | Full nutrient breakdown for a food id and portion (grams, or quantity + unit) |
| `log_meal_text` | Free-text meal → matched foods, portions and totals (`ai: true` for messy input) |
| `log_meal_photo` | Local meal photo → recognised foods and nutrients (needs AI on the server) |
| `lookup_barcode` | EAN/UPC barcode → packaged food from Open Food Facts |
| `parse_nutrition_label` | Label text or a local label photo → per-serving nutrients |
| `create_meal_plan` | Multi-day plan for calorie/protein targets, diet and exclusions |
| `get_usage` | Tokens used and remaining for the API key |

Resource: `nutrikit://nutrients`, the nutrient reference (units and FDA daily values).

None of the tools change data, so all of them are marked read-only. Errors from the API (unknown barcode, quota used up,
AI not configured) come back as tool errors that the model can read.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NUTRIKIT_API_KEY` | – | An `nk_…` key (`npm run create-key -- "mcp"` or the developer portal). Required |
| `NUTRIKIT_BASE_URL` | `http://localhost:8787` | The Nutrikit API |

## Use with Claude

Build it once from the repository root with `npm run build -w mcp`. Then:

**Claude Code**

```bash
claude mcp add nutrikit -e NUTRIKIT_API_KEY=nk_… -- node /absolute/path/to/nutrition-platform/mcp/dist/main.js
```

**Claude Desktop**: add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nutrikit": {
      "command": "node",
      "args": ["/absolute/path/to/nutrition-platform/mcp/dist/main.js"],
      "env": { "NUTRIKIT_API_KEY": "nk_…", "NUTRIKIT_BASE_URL": "http://localhost:8787" }
    }
  }
}
```

Once the package is published to npm, `npx -y @nutrikit/mcp` can replace the `node …/main.js` command.

## Development

```bash
npm test -w mcp                               # MCP client ↔ server over an in-memory transport, fake API
NUTRIKIT_API_KEY=nk_… npm run smoke -w mcp    # spawns the server over stdio and calls tools on a running API
npm run dev -w mcp                            # run the stdio server from source
```
