// Starts nutrikit-mcp over stdio, exactly as Claude Desktop would, and calls a few tools against a
// running API. Needs NUTRIKIT_API_KEY (and NUTRIKIT_BASE_URL if the API is not on localhost:8787).
//
//   NUTRIKIT_API_KEY=nk_… npm run smoke -w mcp

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', new URL('../src/main.ts', import.meta.url).pathname],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const client = new Client({ name: 'nutrikit-smoke', version: '0' });
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as any;
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r.structuredContent;
};

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`);

const search = await call('search_foods', { query: 'greek yogurt', limit: 3 });
console.log('search_foods:', search.results.map((r: any) => `${r.id} ${r.name}`));

const n = await call('get_food_nutrients', { foodId: search.results[0].id, grams: 170 });
console.log(`get_food_nutrients: ${n.food.name}, 170 g → ${n.nutrients.calories?.amount} kcal, ${n.nutrients.protein?.amount} g protein`);

const log = await call('log_meal_text', { text: '2 eggs, a slice of toast and a banana' });
console.log('log_meal_text:', log.items.map((i: any) => `${i.input} → ${i.food.name} (${i.grams} g)`), `total ${log.totals.calories?.amount} kcal`);

const plan = await call('create_meal_plan', { calories: 1800, diet: 'vegetarian', days: 1 });
console.log('create_meal_plan:', plan.days[0].meals.map((m: any) => `${m.meal}: ${m.items.map((i: any) => i.food.name).join(', ')}`));

await client.close();
console.log('ok');
