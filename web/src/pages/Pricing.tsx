// Public pricing page: plans, per-endpoint token costs and FAQ (static plan data).
import { Link } from 'react-router';

interface PlanCard {
  name: string;
  badge?: string;
  price: string;
  perMonth: boolean;
  features: string[];
  cta: string;
  featured?: boolean;
}

// Placeholder plans and prices — keep in sync with PLANS on the server before launch.
const PLANS: PlanCard[] = [
  { name: 'Free', price: '₹0', perMonth: false, features: ['2,000 tokens / month', '30 requests / minute', '2 API keys', 'All endpoints'], cta: 'Start free' },
  { name: 'Starter', badge: 'Popular', price: '₹1,499', perMonth: true, features: ['100,000 tokens / month', '120 requests / minute', '5 API keys', 'Email support'], cta: 'Get started', featured: true },
  { name: 'Growth', price: '₹11,999', perMonth: true, features: ['1,000,000 tokens / month', '600 requests / minute', '20 API keys', 'Priority support'], cta: 'Get started' },
  { name: 'Enterprise', price: 'Custom', perMonth: false, features: ['Custom token volume', '3,000 requests / minute', 'Self-hosting option', 'SLA & dedicated support'], cta: 'Request from dashboard' },
];

export function Pricing() {
  return (
    <main className="wrap">
      <section>
        <div className="page-head">
          <span className="kicker">Pricing</span>
          <h1>Pay for <em>what you log</em>.</h1>
          <p className="lead">Every API call costs a published number of tokens. Pick a monthly allowance; move up when your users do.</p>
        </div>
        <p className="notice">Placeholder plans and prices — edit <code>PLANS</code> in <code>server/src/domain/accounts.ts</code> and this page before launch.</p>

        <div className="plans">
          {PLANS.map((p) => (
            <div key={p.name} className={`plan${p.featured ? ' featured' : ''}`}>
              <h3>{p.name}{p.badge && <> <span className="badge hot">{p.badge}</span></>}</h3>
              <div className="price">{p.price}{p.perMonth && <> <small>/ 30 days</small></>}</div>
              <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <Link className={`btn ${p.featured ? 'btn-primary' : 'btn-ghost'}`} to="/signup">{p.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="block" style={{ paddingBottom: 0 }}>
        <span className="kicker">Token costs</span>
        <h2>What each call costs</h2>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Endpoint</th><th>Tokens</th><th>Notes</th></tr></thead>
            <tbody>
              <tr><td>Food search, food detail, portion nutrients</td><td>1</td><td></td></tr>
              <tr><td>Barcode lookup</td><td>5</td><td>Cached products are still 5</td></tr>
              <tr><td>Text or voice meal logging</td><td>5</td><td>+ AI usage when <code>ai: true</code></td></tr>
              <tr><td>Nutrition label from text</td><td>5</td><td></td></tr>
              <tr><td>Photo meal logging</td><td>20</td><td>+ AI usage</td></tr>
              <tr><td>Nutrition label from a photo</td><td>20</td><td>+ AI usage</td></tr>
              <tr><td>Meal plan</td><td>20</td><td>Per request, 1–7 days</td></tr>
              <tr><td>Nutrient catalog, usage, access tokens</td><td>0</td><td>Free</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>AI usage: +1 token per 1,000 model tokens the request consumed (a typical meal photo adds 2–4 tokens).</p>
      </section>

      <section className="block" style={{ paddingBottom: 0 }}>
        <span className="kicker">FAQ</span>
        <h2>Questions, answered</h2>
        <details className="faq"><summary>What happens when I run out of tokens?</summary><p>Calls return <code>429 quota_exceeded</code> until the next calendar month (UTC) or until you upgrade. Nothing is billed beyond your plan.</p></details>
        <details className="faq"><summary>How do I know what a call cost?</summary><p>Every response includes <code>X-Tokens-Charged</code> and, on metered plans, <code>X-Tokens-Remaining</code>. Your dashboard shows daily usage and a breakdown by endpoint.</p></details>
        <details className="faq"><summary>Do failed requests cost tokens?</summary><p>No. Only successful (2xx) responses are charged.</p></details>
        <details className="faq"><summary>Is the allowance per key or per account?</summary><p>Per account — all of your keys share the plan's monthly allowance and rate limit.</p></details>
        <details className="faq"><summary>Where does the data come from?</summary><p>Nutrient values come from USDA FoodData Central (public domain). Packaged products come from Open Food Facts (ODbL). AI recognition is powered by Claude.</p></details>
      </section>
    </main>
  );
}
