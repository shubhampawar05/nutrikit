// The homepage's tabbed code card (SDK, curl, response), with the legacy token highlighting.
import { createElement, type ReactNode } from 'react';
import { Tabs } from '../../components/Tabs.tsx';

const K = (s: string) => <span className="tok-k">{s}</span>;
const S = (s: string) => <span className="tok-s">{s}</span>;
const P = (s: string) => <span className="tok-p">{s}</span>;
const N = (s: string) => <span className="tok-n">{s}</span>;
const C = (...parts: ReactNode[]) => createElement('span', { className: 'tok-c' }, ...parts);

const js = (
  <pre><code>
    {K('import')}{' { Nutrikit } '}{K('from')}{' '}{S("'./nutrikit.mjs'")}{';\n\n'}
    {K('const')}{' nk = '}{K('new')}{' '}{P('Nutrikit')}{'({ apiKey: process.env.'}{P('NUTRIKIT_KEY')}{' });\n\n'}
    {C('// text, voice transcript, photo, barcode or label')}{'\n'}
    {K('const')}{' meal = '}{K('await')}{' nk.'}{P('logText')}{'('}{S("'a bowl of oatmeal and a coffee'")}{');\n\n'}
    {'meal.items.'}{P('map')}{'(i => i.food.name);\n'}
    {C("// [ 'Oatmeal, NFS', 'Coffee, brewed' ]")}{'\n\n'}
    {'meal.totals.calories;\n'}
    {C('// { amount: ', N('184'), ", unit: 'kcal', dailyValuePercent: ", N('9'), ' }')}{'\n\n'}
    {'nk.lastUsage;\n'}
    {C('// { charged: ', N('5'), ', remaining: ', N('1995'), ' }')}
  </code></pre>
);

const curl = (
  <pre><code>
    {'curl '}{S('https://api.your-domain.com/v1/log/text')}{' \\\n'}
    {'  -H '}{S('"Authorization: Bearer $NUTRIKIT_KEY"')}{' \\\n'}
    {'  -H '}{S('"Content-Type: application/json"')}{' \\\n'}
    {'  -d '}{S('\'{"text": "a bowl of oatmeal and a coffee"}\'')}
  </code></pre>
);

const res = (
  <pre><code>
    {'{\n  '}{P('"items"')}{': [\n'}
    {'    { '}{P('"input"')}{': '}{S('"a bowl of oatmeal"')}{',\n'}
    {'      '}{P('"food"')}{': { '}{P('"id"')}{': '}{N('2708380')}{', '}{P('"name"')}{': '}{S('"Oatmeal, NFS"')}{' },\n'}
    {'      '}{P('"quantity"')}{': '}{N('1')}{', '}{P('"unit"')}{': '}{S('"bowl"')}{', '}{P('"grams"')}{': '}{N('240')}{',\n'}
    {'      '}{P('"confidence"')}{': '}{S('"high"')}{', '}{P('"nutrients"')}{': { … } },\n'}
    {'    { '}{P('"input"')}{': '}{S('"a coffee"')}{', '}{P('"grams"')}{': '}{N('240')}{', … }\n'}
    {'  ],\n  '}{P('"totals"')}{': { '}{P('"calories"')}{': { '}{P('"amount"')}{': '}{N('184')}{', '}{P('"unit"')}{': '}{S('"kcal"')}{' }, … }\n}'}
  </code></pre>
);

export function CodeSamples() {
  return (
    <Tabs
      tabs={[
        { id: 'js', label: 'nutrikit.mjs', panel: js },
        { id: 'curl', label: 'curl', panel: curl },
        { id: 'res', label: 'response', panel: res },
      ]}
    />
  );
}
