// Documentation: guides with an in-page contents nav that tracks the section in view, this
// server's base URL in the examples, and the nutrient table from the public /v1/nutrients catalog.
import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CodeBlock } from '../components/CodeBlock.tsx';

interface NutrientInfo { key: string; name: string; unit: string; dailyValue: number | null }

const NAV: [string, [string, string][]][] = [
  ['Getting started', [['introduction', 'Introduction'], ['quick-start', 'Quick start'], ['authentication', 'Authentication'], ['access-tokens', 'Access tokens for apps']]],
  ['Guides', [['food-search', 'Food search & nutrients'], ['text-logging', 'Text & voice logging'], ['photo-logging', 'Photo logging'], ['barcodes', 'Barcodes'], ['labels', 'Nutrition labels'], ['meal-plans', 'Meal plans'], ['advisor', 'Nutrition advisor']]],
  ['SDK', [['sdk', 'JavaScript SDK'], ['sdk-browser', 'On-device capture']]],
  ['Platform', [['tokens', 'Tokens & usage'], ['rate-limits', 'Rate limits'], ['errors', 'Errors'], ['nutrients', 'Nutrient keys'], ['data', 'Data sources'], ['changelog', 'Changelog']]],
];

async function fetchNutrients(): Promise<NutrientInfo[]> {
  const res = await fetch('/v1/nutrients');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { nutrients: NutrientInfo[] };
  return data.nutrients;
}

function DocsNav() {
  const [collapsed, setCollapsed] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  // Highlight the section in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
    }, { rootMargin: '-70px 0px -70% 0px' });
    for (const [, links] of NAV) {
      for (const [id] of links) {
        const section = document.getElementById(id);
        if (section) observer.observe(section);
      }
    }
    return () => observer.disconnect();
  }, []);

  // On small screens, following a link closes the contents.
  const onNavClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a') && window.matchMedia?.('(max-width: 900px)').matches) setCollapsed(true);
  };

  return (
    <nav className={`docs-nav${collapsed ? ' collapsed' : ''}`} aria-label="Documentation" onClick={onNavClick}>
      <button className="btn btn-ghost btn-sm docs-toggle" type="button" aria-expanded={!collapsed} onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}>Contents ▾</button>
      {NAV.map(([group, links]) => [
        <p key={group} className="docs-nav-group">{group}</p>,
        ...links.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? 'active' : undefined}>{label}</a>),
      ])}
      <p className="docs-nav-group">Reference</p>
      <Link to="/docs/reference">API reference →</Link>
    </nav>
  );
}

function NutrientTable() {
  const { data, isError } = useQuery({ queryKey: ['nutrients'], queryFn: fetchNutrients, staleTime: Infinity });
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th scope="col">Key</th><th scope="col">Nutrient</th><th scope="col">Unit</th><th scope="col">Daily value</th></tr></thead>
        <tbody>
          {data?.map((n) => (
            <tr key={n.key}><td><code>{n.key}</code></td><td>{n.name}</td><td>{n.unit}</td><td>{n.dailyValue == null ? '—' : `${n.dailyValue} ${n.unit}`}</td></tr>
          ))}
        </tbody>
      </table>
      {isError && <p className="muted">Could not load the nutrient list.</p>}
    </div>
  );
}

export function Docs() {
  const base = window.location.origin;
  return (
    <main className="wrap docs-layout">
      <DocsNav />

      <article className="docs-content">
        <section id="introduction">
          <h1>Nutrikit documentation</h1>
          <p className="lead">Nutrikit is a REST API for nutrition data and food logging. You send foods as text, speech transcripts, photos, barcodes or label text; you get back matched foods, portions in grams and up to 33 nutrients.</p>
          <p>Base URL for this server:</p>
          <CodeBlock><code>{base}</code></CodeBlock>
          <p>All endpoints are under <code>/v1</code>, accept and return JSON, and authenticate with a bearer credential. The full contract is in the <Link to="/docs/reference">API reference</Link> and as an <a href="/openapi.json">OpenAPI 3.1 file</a>.</p>
        </section>

        <section id="quick-start">
          <h2>Quick start</h2>
          <ol>
            <li><Link to="/signup">Create a free account</Link>. Your first API key is shown once — copy it.</li>
            <li>Export it in your terminal: <code>export NUTRIKIT_KEY=nk_...</code></li>
            <li>Make a request:</li>
          </ol>
          <CodeBlock><code>{`curl "${base}/v1/foods/search?q=banana&limit=3" \\
  -H "Authorization: Bearer $NUTRIKIT_KEY"`}</code></CodeBlock>
          <p>Then log a whole meal in one call:</p>
          <CodeBlock><code>{`curl ${base}/v1/log/text \\
  -H "Authorization: Bearer $NUTRIKIT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "2 eggs, a slice of whole wheat toast and a cup of coffee with milk"}'`}</code></CodeBlock>
          <p>Prefer clicking? Try every endpoint in the <Link to="/playground">playground</Link>.</p>
        </section>

        <section id="authentication">
          <h2>Authentication</h2>
          <p>Send your API key in the <code>Authorization</code> header:</p>
          <CodeBlock><code>Authorization: Bearer nk_your_secret_key</code></CodeBlock>
          <p><code>X-Api-Key: nk_...</code> is also accepted. Keys are created and revoked in your <Link to="/dashboard">dashboard</Link>; Nutrikit stores only a hash, so a lost key cannot be recovered — create a new one and revoke the old.</p>
          <div className="callout warn"><b>Keep <code>nk_</code> keys on your server.</b> Anyone with the key can spend your allowance. For browsers and mobile apps, use <a href="#access-tokens">access tokens</a>.</div>
          <p>Missing or wrong credentials return <code>401 unauthorized</code>.</p>
        </section>

        <section id="access-tokens">
          <h2>Access tokens for apps</h2>
          <p>Your backend exchanges the secret key for an access token that expires after one hour, and hands that token to the client. Access tokens work on every endpoint, are charged to the same account, and cannot mint further tokens.</p>
          <CodeBlock><code>{`curl -X POST ${base}/v1/auth/token \\
  -H "Authorization: Bearer $NUTRIKIT_KEY"`}</code></CodeBlock>
          <pre><code>{`{
  "access_token": "nkat_eyJraWQiOiJrZXlfMWE...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "expires_at": "2026-10-29T12:00:00.000Z"
}`}</code></pre>
          <p>The client uses it exactly like a key: <code>Authorization: Bearer nkat_...</code>. When it expires, calls return <code>401 token_expired</code> — fetch a new one from your backend. Revoking the key also invalidates its tokens.</p>
        </section>

        <section id="food-search">
          <h2>Food search &amp; nutrients</h2>
          <h3>Search</h3>
          <CodeBlock><code>GET /v1/foods/search?q=greek%20yogurt&amp;limit=5</code></CodeBlock>
          <p>Results are ranked for logging: the generic, as-eaten food comes first. Optional <code>source</code> filters to <code>survey</code> (dishes as eaten), <code>foundation</code> or <code>sr_legacy</code>. Page with <code>offset</code>.</p>
          <h3>Food detail</h3>
          <CodeBlock><code>GET /v1/foods/2709224</code></CodeBlock>
          <p>Returns <code>per100g</code> nutrient values and the food's household <code>portions</code> (e.g. <code>{'{"label": "1 banana", "grams": 126}'}</code>).</p>
          <h3>Nutrients for a portion</h3>
          <CodeBlock><code>{`GET /v1/foods/2709224/nutrients?quantity=2&unit=medium
GET /v1/foods/2709224/nutrients?grams=150`}</code></CodeBlock>
          <p>Units can be mass (<code>g</code>, <code>oz</code>, <code>lb</code>), volume (<code>cup</code>, <code>tbsp</code>, <code>tsp</code>, <code>fl oz</code>, <code>ml</code>) or household words (<code>slice</code>, <code>piece</code>, <code>small</code>, <code>medium</code>, <code>large</code>…). The response says how the grams were worked out in <code>portionMethod</code>, and every nutrient includes <code>dailyValuePercent</code>.</p>
        </section>

        <section id="text-logging">
          <h2>Text &amp; voice logging</h2>
          <CodeBlock><code>{`POST /v1/log/text
{ "text": "For lunch I had a cheeseburger and medium fries" }`}</code></CodeBlock>
          <p>The sentence is split into foods, each with a quantity, unit, grams, nutrients, a <code>confidence</code> and up to three <code>alternatives</code> you can offer as corrections. <code>totals</code> sums the meal, and <code>meal</code> is set when the text names one.</p>
          <p>A phrase the catalog has no food for is listed in <code>unmatched</code> instead of being logged as something else. When only a partial match exists (no food has all of its words, and the best one shares no more than half of them), its <code>reason</code> is <code>no confident match</code> and <code>suggestions</code> lists foods you can offer instead.</p>
          <p>Set <code>"ai": true</code> to parse with the server's AI provider — better for long or unusual descriptions (adds AI usage to the cost).</p>
          <h3>Voice</h3>
          <CodeBlock><code>{`POST /v1/log/voice
{ "transcript": "um so I had like a bowl of oatmeal and a banana" }`}</code></CodeBlock>
          <p>Speech is turned into text on the device (see <a href="#sdk-browser">on-device capture</a>); the API removes filler words and returns the cleaned <code>transcript</code> with the same result shape as text logging.</p>
        </section>

        <section id="photo-logging">
          <h2>Photo logging</h2>
          <CodeBlock><code>{`POST /v1/log/photo
{ "image": "data:image/jpeg;base64,/9j/4AAQ...", "hint": "restaurant portion" }`}</code></CodeBlock>
          <p>Send a JPEG, PNG, WebP or GIF up to 5 MB, as base64 / data URL in JSON or as a raw <code>image/*</code> body. Each recognised food comes back with its estimated grams, matched database entry and a <code>recognition</code> confidence. Photo logging needs the server's AI provider; without it the endpoint returns <code>501</code>.</p>
        </section>

        <section id="barcodes">
          <h2>Barcodes</h2>
          <CodeBlock><code>GET /v1/barcodes/3017624010701</code></CodeBlock>
          <p>Accepts EAN-8, UPC-A, EAN-13 and GTIN-14 with a valid check digit (otherwise <code>400 invalid_barcode</code>). Returns the product name, brand, serving size, <code>per100g</code> values and <code>perServing</code> nutrients when the serving weight is known. Unknown products return <code>404</code>.</p>
        </section>

        <section id="labels">
          <h2>Nutrition labels</h2>
          <CodeBlock><code>{`POST /v1/labels/parse
{ "text": "Serving size 2/3 cup (55g)\\nCalories 230\\nTotal Fat 8g ..." }`}</code></CodeBlock>
          <p>Parses US Nutrition Facts text (current and pre-2016 formats) into <code>perServing</code> and <code>per100g</code> values. Send <code>{'{"image": "..."}'}</code> instead to read a label photo with the server's AI provider. <code>warnings</code> lists anything that could not be found.</p>
          <p>Every call first reserves the photo cost (20 tokens) against your allowance; a text label then settles to 5 tokens.</p>
        </section>

        <section id="meal-plans">
          <h2>Meal plans</h2>
          <CodeBlock><code>{`POST /v1/meal-plans
{ "calories": 1800, "diet": "vegetarian", "days": 3, "exclude": ["mushroom"], "seed": 42 }`}</code></CodeBlock>
          <p>Diets: <code>omnivore</code>, <code>vegetarian</code>, <code>vegan</code>, <code>pescatarian</code>, <code>dairy-free</code>, <code>gluten-free</code>. Choose <code>meals</code> from breakfast, lunch, dinner and snack. The same <code>seed</code> and inputs always return the same plan — store it to reproduce a plan later.</p>
        </section>

        <section id="advisor">
          <h2>Nutrition advisor</h2>
          <p>Answers a food or nutrition question in short markdown. Pass optional <code>context</code> — the user's goals, preferences and what they logged today — to make the answer specific; it is treated as data, never as instructions. Needs an AI provider on the server; 5 tokens + AI usage.</p>
          <CodeBlock><code>{`POST /v1/advisor
{ "question": "What's a high-protein vegetarian breakfast?",
  "context": "Goal: build muscle. Avoids: peanuts. Logged today: 2 eggs, toast" }

→ { "answer": "- **Greek yogurt bowl** …", "declined": false, "provider": "openai" }`}</code></CodeBlock>
          <p>General guidance, not medical advice: questions about medication, diagnosis, treatment, pregnancy or very low calorie intakes come back with <code>declined: true</code> and an <code>answer</code> that explains why and suggests a doctor or registered dietitian. Show that answer to the user as it is.</p>
        </section>

        <section id="sdk">
          <h2>JavaScript SDK</h2>
          <p>Published on npm as <a href="https://www.npmjs.com/package/@nutrikit/sdk" target="_blank" rel="noopener"><code>@nutrikit/sdk</code></a>: no dependencies, TypeScript types included, works in browsers and Node 18+. Source on <a href="https://github.com/shubhampawar05/nutrikit/tree/main/sdk/js" target="_blank" rel="noopener">GitHub</a>.</p>
          <CodeBlock><code>npm install @nutrikit/sdk</code></CodeBlock>
          <CodeBlock><code>{`import { Nutrikit, NutrikitError } from '@nutrikit/sdk';

const nk = new Nutrikit({ apiKey: process.env.NUTRIKIT_KEY, baseUrl: '${base}' });

const results = await nk.searchFoods('oatmeal', { limit: 5 });
const portion = await nk.getNutrients(results.results[0].id, { quantity: 1, unit: 'cup' });
const meal    = await nk.logText('2 eggs and toast');
const photo   = await nk.logPhoto(fileInput.files[0]);
const product = await nk.lookupBarcode('3017624010701');
const label   = await nk.parseLabel({ text: labelText });
const plan    = await nk.createMealPlan({ calories: 2000, diet: 'vegan' });
const advice  = await nk.askAdvisor('Is oatmeal a good breakfast?', { context: 'Goal: steady energy' });
const usage   = await nk.getUsage();
const token   = await nk.createAccessToken();   // server-side only

console.log(nk.lastUsage); // { charged: 5, remaining: 1984 }`}</code></CodeBlock>
          <p>No build step? Load it straight from this server: <code>{`import { Nutrikit } from '${base}/sdk/nutrikit.mjs'`}</code> (types: <a href="/sdk/nutrikit.d.ts">nutrikit.d.ts</a>).</p>
          <p>In the browser, construct the client with an access token from your backend: <code>new Nutrikit({'{ apiKey: accessToken }'})</code>.</p>
          <h3>Errors and retries</h3>
          <CodeBlock><code>{`try {
  await nk.lookupBarcode(code);
} catch (err) {
  if (err instanceof NutrikitError && err.status === 404) showNotFound();
  else throw err;
}`}</code></CodeBlock>
          <p>The SDK retries <code>429</code>, <code>502</code> and <code>503</code> responses up to twice, honouring <code>Retry-After</code>. It does not retry <code>quota_exceeded</code>.</p>
        </section>

        <section id="sdk-browser">
          <h2>On-device capture</h2>
          <p>Two browser helpers capture input locally and send only the result:</p>
          <CodeBlock><code>{`// Microphone → speech recognition in the browser → /v1/log/voice
const meal = await nk.voiceLog({ lang: 'en-US' });

// Camera → BarcodeDetector → /v1/barcodes/{code}
const code = await Nutrikit.scanBarcode(videoElement);
const product = await nk.lookupBarcode(code);`}</code></CodeBlock>
          <p>Both reject with <code>code: "unsupported"</code> in browsers without the Web Speech or BarcodeDetector APIs — fall back to a text box.</p>
        </section>

        <section id="tokens">
          <h2>Tokens &amp; usage</h2>
          <p>Each successful call is charged tokens from your account's monthly allowance. Failed calls are free, except AI usage the server's AI provider had already consumed before the call failed; that amount is shown in <code>X-Tokens-Charged</code>. See the <Link to="/pricing">cost table</Link>. Every metered response carries:</p>
          <div className="table-scroll"><table className="data">
            <thead><tr><th scope="col">Header</th><th scope="col">Meaning</th></tr></thead><tbody>
            <tr><td><code>X-Tokens-Charged</code></td><td>Tokens this call cost</td></tr>
            <tr><td><code>X-Tokens-Remaining</code></td><td>Allowance left this month (metered plans)</td></tr>
          </tbody></table></div>
          <p style={{ marginTop: 12 }}><code>GET /v1/usage</code> returns this month's total and a per-endpoint breakdown; the dashboard shows the last 30 days. Allowances reset on the 1st of each month (UTC) and are shared by all keys on the account.</p>
        </section>

        <section id="rate-limits">
          <h2>Rate limits</h2>
          <p>Requests per minute depend on your plan (Free 30, Starter 120, Growth 600). Over the limit you get <code>429 rate_limited</code> with a <code>Retry-After</code> header in seconds.</p>
        </section>

        <section id="errors">
          <h2>Errors</h2>
          <p>Errors use HTTP status codes and a consistent body:</p>
          <pre><code>{'{ "error": { "code": "invalid_barcode", "message": "not a valid EAN/UPC barcode ..." } }'}</code></pre>
          <div className="table-scroll"><table className="data">
            <thead><tr><th scope="col">Status</th><th scope="col">Codes</th><th scope="col">What to do</th></tr></thead><tbody>
            <tr><td>400</td><td><code>invalid_request</code>, <code>invalid_barcode</code></td><td>Fix the request; <code>message</code> says what is wrong</td></tr>
            <tr><td>401</td><td><code>unauthorized</code>, <code>token_expired</code></td><td>Check the key, or get a new access token</td></tr>
            <tr><td>403</td><td><code>forbidden</code></td><td>The credential cannot do this (e.g. a token minting a token)</td></tr>
            <tr><td>404</td><td><code>not_found</code></td><td>Unknown food, product or route</td></tr>
            <tr><td>413</td><td><code>payload_too_large</code></td><td>Images must be 5 MB or less</td></tr>
            <tr><td>422</td><td><code>not_a_label</code>, …</td><td>Input understood but not usable</td></tr>
            <tr><td>429</td><td><code>rate_limited</code>, <code>quota_exceeded</code></td><td>Wait <code>Retry-After</code>, or upgrade</td></tr>
            <tr><td>501</td><td><code>ai_provider_unavailable</code></td><td>This server has no AI provider configured</td></tr>
            <tr><td>502 / 503</td><td>upstream errors</td><td>Retry with back-off</td></tr>
            <tr><td>504</td><td><code>ai_timeout</code></td><td>The AI provider did not answer in time; nothing is charged. Retry, ideally with a smaller image or shorter text</td></tr>
          </tbody></table></div>
        </section>

        <section id="nutrients">
          <h2>Nutrient keys</h2>
          <p>Nutrient maps use these keys. Each value is <code>{'{ "amount", "unit", "dailyValuePercent" }'}</code>; keys a food has no data for are omitted, never sent as 0. In <code>totals</code>, a nutrient that some of the foods lack carries <code>missingFrom</code> (how many lacked it), so you can show the amount as a lower bound. Coverage depends on the source: USDA survey foods have every key except trans fat and added sugars, while SR Legacy and Foundation foods often lack vitamins. <code>GET /v1/nutrients</code> returns the same list with daily values.</p>
          <NutrientTable />
        </section>

        <section id="data">
          <h2>Data sources</h2>
          <ul>
            <li><b>USDA FoodData Central</b> — SR Legacy, FNDDS survey foods and Foundation Foods. Public domain.</li>
            <li><b>Open Food Facts</b> — packaged products by barcode, © Open Food Facts contributors, ODbL. Responses include this attribution; keep it visible in your app.</li>
            <li><b>FDA</b> — daily values for <code>dailyValuePercent</code> (21 CFR 101.9).</li>
          </ul>
          <p className="muted">Nutrition values are estimates and not medical advice.</p>
        </section>

        <section id="changelog">
          <h2>Changelog</h2>
          <ul>
            <li><b>v1.4</b> — Data accuracy. Search matches whole words before prefixes and reports how in <code>match</code>; a weak partial match is listed in <code>unmatched</code> with <code>suggestions</code> instead of being logged as a different food. Totals carry <code>missingFrom</code> when some foods lack a nutrient. Category-led names ("Fish, salmon", "Cheese, paneer") match their food, "curd" and "dahi" mean yogurt, "chai" is tea with milk, and bare counts use the regular size. Open Food Facts nulls stay missing instead of 0.</li>
            <li><b>v1.3</b> — Every response carries a request id (<code>X-Request-Id</code>; send your own to trace a call). <code>GET /v1/health/ready</code> reports readiness. Allowances are reserved atomically, so parallel calls cannot overspend. Failed calls are charged only for AI usage already consumed. Slow AI calls end with <code>504 ai_timeout</code>. Food logging: add-on portions (sugar, milk, butter…) are capped to a realistic amount, bare "tea", "chai" and "salad" get sensible defaults, fries come in small, medium and large, and near-duplicate search results are collapsed.</li>
            <li><b>v1.2</b> — Nutrition advisor (<code>POST /v1/advisor</code>, SDK <code>askAdvisor</code>).</li>
            <li><b>v1.1</b> — Developer portal, self-serve accounts and plans, access tokens (<code>POST /v1/auth/token</code>).</li>
            <li><b>v1.0</b> — Food search and nutrients, text/voice/photo logging, barcodes, labels, meal plans, usage metering.</li>
          </ul>
        </section>
      </article>
    </main>
  );
}
