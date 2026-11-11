// Public pricing page: the server's plans (GET /portal/api/plans), per-endpoint token costs and FAQ.
import { Link, Navigate } from 'react-router';
import { PAYMENTS_VISIBLE } from '../features.ts';
import { useQuery } from '@tanstack/react-query';
import { api, errorText, fmt, fmtPrice, type Plan } from '../api/client.ts';
import { useMe } from '../hooks.ts';

// Display-only extras per plan id; numbers (price, allowance, rate, keys) always come from the server.
const EXTRAS: Record<string, { badge?: string; featured?: boolean; features: string[] }> = {
  free: { features: ['All endpoints'] },
  starter: { badge: 'Popular', featured: true, features: ['Email support'] },
  growth: { features: ['Priority support'] },
  enterprise: { features: ['Self-hosting option', 'SLA & dedicated support'] },
};

function features(id: string, p: Plan): string[] {
  return [
    p.monthlyTokens == null ? 'Custom token volume' : `${fmt(p.monthlyTokens)} tokens / month`,
    `${fmt(p.ratePerMinute)} requests / minute`,
    `${fmt(p.maxKeys)} API keys`,
    ...(EXTRAS[id]?.features ?? []),
  ];
}

function PlanCard({ id, plan, signedIn }: { id: string; plan: Plan; signedIn: boolean }) {
  const extra = EXTRAS[id];
  const custom = plan.price == null;
  // Enterprise is arranged by request from the dashboard; visitors sign up first and land on that form.
  const cta = custom
    ? { label: 'Contact us', to: signedIn ? '/dashboard#upgrade' : '/signup?next=/dashboard%23upgrade' }
    : { label: plan.price === 0 ? 'Start free' : 'Get started', to: '/signup' };
  return (
    <div className={`plan${extra?.featured ? ' featured' : ''}`}>
      <h3>{plan.name}{extra?.badge && <> <span className="badge hot">{extra.badge}</span></>}</h3>
      <div className="price">
        {custom ? 'Custom' : fmtPrice(plan.price!, plan.currency)}
        {!custom && plan.price! > 0 && <> <small>/ 30 days</small></>}
      </div>
      <ul>{features(id, plan).map((f) => <li key={f}>{f}</li>)}</ul>
      <Link className={`btn ${extra?.featured ? 'btn-primary' : 'btn-ghost'}`} to={cta.to}>{cta.label}</Link>
    </div>
  );
}

function Plans() {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['plans'], queryFn: api.plans, staleTime: 300_000 });
  const me = useMe();
  if (isError) {
    return (
      <p className="form-error" role="alert">
        {errorText(error, 'Could not load the plans.')} <button className="btn btn-ghost btn-sm" type="button" onClick={() => void refetch()}>Retry</button>
      </p>
    );
  }
  return (
    <div className="plans" aria-busy={isPending}>
      {isPending
        ? [0, 1, 2, 3].map((n) => <div key={n} className="plan plan-skeleton" aria-hidden="true"><i /><i /><i /><i /></div>)
        : Object.entries(data.plans).map(([id, plan]) => <PlanCard key={id} id={id} plan={plan} signedIn={!!me.data} />)}
    </div>
  );
}

export function Pricing() {
  if (!PAYMENTS_VISIBLE) return <Navigate to="/" replace />;
  return (
    <main className="wrap">
      <section>
        <div className="page-head">
          <span className="kicker">Pricing</span>
          <h1>Pay for <em>what you log</em>.</h1>
          <p className="lead">Every API call costs a published number of tokens. Pick a monthly allowance; move up when your users do.</p>
        </div>
        <Plans />
      </section>

      <section className="block" style={{ paddingBottom: 0 }}>
        <span className="kicker">Token costs</span>
        <h2>What each call costs</h2>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th scope="col">Endpoint</th><th scope="col">Tokens</th><th scope="col">Notes</th></tr></thead>
            <tbody>
              <tr><td>Food search, food detail, portion nutrients</td><td>1</td><td></td></tr>
              <tr><td>Barcode lookup</td><td>5</td><td>Cached products are still 5</td></tr>
              <tr><td>Text or voice meal logging</td><td>5</td><td>+ AI usage when <code>ai: true</code></td></tr>
              <tr><td>Nutrition label from text</td><td>5</td><td></td></tr>
              <tr><td>Photo meal logging</td><td>20</td><td>+ AI usage</td></tr>
              <tr><td>Nutrition label from a photo</td><td>20</td><td>+ AI usage</td></tr>
              <tr><td>Meal plan</td><td>20</td><td>Per request, 1–7 days</td></tr>
              <tr><td>Nutrition advisor question</td><td>5</td><td>+ AI usage</td></tr>
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
        <details className="faq"><summary>How do I know what a call cost?</summary><p>Every metered response includes <code>X-Tokens-Charged</code> and, on metered plans, <code>X-Tokens-Remaining</code>. Your dashboard shows daily usage and a breakdown by endpoint.</p></details>
        <details className="faq"><summary>Do failed requests cost tokens?</summary><p>Failed calls are free, except AI usage the server's AI provider had already consumed before the call failed. That amount is shown in <code>X-Tokens-Charged</code>.</p></details>
        <details className="faq"><summary>Is the allowance per key or per account?</summary><p>Per account — all of your keys share the plan's monthly allowance and rate limit.</p></details>
        <details className="faq"><summary>Where does the data come from?</summary><p>Nutrient values come from USDA FoodData Central (public domain). Packaged products come from Open Food Facts (ODbL). Photo and AI recognition use the server's AI provider.</p></details>
      </section>
    </main>
  );
}
