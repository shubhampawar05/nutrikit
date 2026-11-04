// Response previews and JSON highlighting for the playground. Everything is rendered as text nodes.
import { Component, Fragment, type ReactNode } from 'react';
import type { NutrientKey } from '../../sdk.ts';
import { Icon } from '../../components/Icon.tsx';
import { fmtN, type Result } from './endpoints.ts';

type Amounts = Partial<Record<string, { amount: number; unit: string }>>;

const UNCOUNTED = new Set(['g', 'kg', 'mg', 'mcg', 'oz', 'lb', 'ml', 'l', 'fl oz', 'tbsp', 'tsp', 'small', 'medium', 'large', 'whole']);

/** "egg" -> "eggs" for any quantity but 1. Measures and size words ("g", "medium") stay as they are. */
export function pluralise(unit: string, quantity: number): string {
  if (quantity === 1 || !unit || UNCOUNTED.has(unit.toLowerCase())) return unit;
  if (/(ss|x|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/s$/i.test(unit)) return unit; // already plural
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}

/** What the user said, then the weight: "2 eggs · 100 g". */
export const amountText = (quantity: number, unit: string, grams: number) =>
  unit === 'g' ? `${fmtN(grams, 1)} g` : `${fmtN(quantity, 2)} ${pluralise(unit, quantity)} · ${fmtN(grams, 1)} g`;

const MACROS: [NutrientKey, string][] = [['calories', 'kcal'], ['protein', 'protein'], ['carbs', 'carbs'], ['fat', 'fat'], ['fiber', 'fiber']];

function MacroRow({ n }: { n: Amounts | null | undefined }) {
  return (
    <div className="pg-macros">
      {MACROS.map(([k, l]) => {
        const v = n?.[k];
        if (!v) return null;
        return <div key={k}><b>{fmtN(v.amount, 1)}{k === 'calories' ? '' : v.unit}</b><span>{l}</span></div>;
      })}
    </div>
  );
}

function LogPreview({ r }: { r: Extract<Result, { preview: 'log' }>['data'] }) {
  return (
    <>
      {'transcript' in r && r.transcript ? <p className="muted small">Heard: “{r.transcript}”</p> : null}
      <div className="pg-total"><span>{r.meal ? `${r.meal} · ` : ''}{r.items.length} food{r.items.length === 1 ? '' : 's'}</span><MacroRow n={r.totals} /></div>
      {r.items.length ? r.items.map((i, idx) => (
        <div className="pg-item" key={idx}>
          <div>
            <span className="said">“{i.input}”</span><b>{i.food.name}</b>
            <span className="muted small">
              {amountText(i.quantity, i.unit, i.grams)}{i.portionBasis ? ` · from ${i.portionBasis}` : ''} · <span className={`conf ${i.confidence}`}>{i.confidence} match</span>
              {i.recognition ? ` · seen as “${i.recognition.label}”` : ''}
            </span>
            {i.alternatives?.length ? <span className="alts">Also: {i.alternatives.map((a) => a.name).join(' · ')}</span> : null}
          </div>
          <span className="kcal">{fmtN(i.nutrients.calories?.amount)}<small>kcal</small></span>
        </div>
      )) : <p className="muted">No foods recognised.</p>}
      {r.unmatched?.length ? <p className="pg-warn">Not matched: {r.unmatched.map((u) => u.text).join(', ')}</p> : null}
      {r.notes ? <p className="muted small">{r.notes}</p> : null}
      <p className="muted small">Parsed by {r.provider}</p>
    </>
  );
}

function SearchPreview({ r, offset, onUseFood }: { r: Extract<Result, { preview: 'search' }>['data']; offset: number; onUseFood: (id: number, name: string) => void }) {
  if (!r.results.length) return <p className="muted">No foods found.</p>;
  return (
    <>
      <p className="muted small">{fmtN(r.total)} matches for “{r.query}”{r.relaxed ? ' (relaxed)' : ''}</p>
      <ol className="pg-results">
        {r.results.map((f, idx) => (
          <li key={f.id}>
            <span className="rank">{idx + 1 + offset}</span>
            <div><b>{f.name}</b><span className="muted small">{f.category || ''} · {f.source} · id {f.id}</span></div>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onUseFood(f.id, f.name)}>Nutrients →</button>
          </li>
        ))}
      </ol>
    </>
  );
}

function NutrientsPreview({ r }: { r: Extract<Result, { preview: 'nutrients' }>['data'] }) {
  return (
    <>
      <div className="pg-total">
        <span><b>{r.food.name}</b><br />{fmtN(r.quantity, 2)} {r.unit} = {r.grams} g <span className="muted">({r.portionBasis || r.portionMethod})</span></span>
        <MacroRow n={r.nutrients} />
      </div>
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Nutrient</th><th>Amount</th><th>% Daily Value</th></tr>
            {Object.entries(r.nutrients).map(([k, v]) => v && (
              <tr key={k}>
                <td>{k}</td>
                <td>{fmtN(v.amount, 2)} {v.unit}</td>
                <td>{v.dailyValuePercent == null ? '' : <><span className="dv"><i style={{ width: `${Math.min(v.dailyValuePercent, 100)}%` }} /></span>{v.dailyValuePercent}%</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BarcodePreview({ p }: { p: Extract<Result, { preview: 'barcode' }>['data'] }) {
  const per100: Amounts = Object.fromEntries(Object.entries(p.per100g).map(([k, v]) => [k, { amount: v ?? 0, unit: k === 'calories' ? 'kcal' : 'g' }]));
  return (
    <>
      <div className="pg-product">
        {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <div className="ph"><Icon name="barcode" /></div>}
        <div>
          <b>{p.name || 'Unnamed product'}</b><span className="muted small">{[p.brand, p.packageSize].filter(Boolean).join(' · ')}</span>
          <span className="muted small">Serving: {p.servingSize || 'not listed'} · {p.cached ? 'cached' : 'live'}</span>
        </div>
      </div>
      <h4 className="pg-sub">Per 100 g</h4><MacroRow n={per100} />
      {p.perServing ? <><h4 className="pg-sub">Per serving</h4><MacroRow n={p.perServing} /></> : null}
      <p className="muted small">{p.license}</p>
    </>
  );
}

/** A per-100 g label value with the same unit as its per-serving value ("8 g", "160 mg"). */
const per100Text = (amount: number | undefined, unit: string) => (amount == null ? '—' : `${fmtN(amount, 2)} ${unit}`);

function LabelPreview({ r }: { r: Extract<Result, { preview: 'label' }>['data'] }) {
  return (
    <>
      <div className="pg-total"><span>Serving <b>{r.servingSize || 'not found'}</b>{r.servingsPerContainer ? ` · ${r.servingsPerContainer} per container` : ''} · from {r.source}</span></div>
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Nutrient</th><th>Per serving</th><th>Per 100 g</th></tr>
            {Object.entries(r.perServing).map(([k, v]) => v && (
              <tr key={k}><td>{k}</td><td>{fmtN(v.amount, 2)} {v.unit}</td><td>{per100Text(r.per100g?.[k as NutrientKey], v.unit)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.warnings.length ? <p className="pg-warn">{r.warnings.join('; ')}</p> : null}
    </>
  );
}

function PlanPreview({ p }: { p: Extract<Result, { preview: 'plan' }>['data'] }) {
  return (
    <>
      {p.days.map((d) => (
        <Fragment key={d.day}>
          <div className="pg-total"><span><b>Day {d.day}</b> · target {fmtN(p.targets.calories)} kcal</span><MacroRow n={d.totals} /></div>
          {d.meals.map((m, idx) => (
            <div className="pg-meal" key={idx}>
              <h4>{m.meal}<span>{fmtN(m.totals.calories?.amount)} / {fmtN(m.targetCalories)} kcal</span></h4>
              <ul>{m.items.map((i, j) => <li key={j}>{i.food.name}<span className="muted small">{i.serving} · {i.grams} g</span></li>)}</ul>
            </div>
          ))}
        </Fragment>
      ))}
      <p className="muted small">Seed {p.seed} — send the same seed to get this plan again.</p>
    </>
  );
}

function UsagePreview({ u }: { u: Extract<Result, { preview: 'usage' }>['data'] }) {
  const max = Math.max(1, ...u.byEndpoint.map((r) => r.tokens));
  return (
    <>
      <div className="pg-total"><span><b className="big-number" style={{ fontSize: '2.4rem' }}>{fmtN(u.used)}</b> tokens used{u.tokenLimit ? ` of ${fmtN(u.tokenLimit)}` : ''}</span></div>
      {u.byEndpoint.length
        ? u.byEndpoint.map((r) => <div className="pg-bar" key={r.endpoint}><span>{r.endpoint}</span><i style={{ width: `${(r.tokens / max) * 100}%` }} /><b>{fmtN(r.tokens)}</b></div>)
        : <p className="muted">No calls yet this month.</p>}
    </>
  );
}

export function Preview({ result, offset, onUseFood }: { result: Result; offset: number; onUseFood: (id: number, name: string) => void }) {
  let body: ReactNode;
  switch (result.preview) {
    case 'log': body = <LogPreview r={result.data} />; break;
    case 'search': body = <SearchPreview r={result.data} offset={offset} onUseFood={onUseFood} />; break;
    case 'nutrients': body = <NutrientsPreview r={result.data} />; break;
    case 'barcode': body = <BarcodePreview p={result.data} />; break;
    case 'label': body = <LabelPreview r={result.data} />; break;
    case 'plan': body = <PlanPreview p={result.data} />; break;
    case 'usage': body = <UsagePreview u={result.data} />; break;
  }
  return <div className="pg-preview">{body}</div>;
}

/** A 2xx body that doesn't have the expected shape made the legacy renderer throw, which showed the network error. */
export class PreviewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/** Pretty JSON with the site's tok-* colours, built from text nodes (no innerHTML). */
export function JsonText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      if (m[2] !== undefined) out.push(<span key={at} className="tok-p">{m[1]}</span>, m[2]);
      else out.push(<span key={at} className="tok-s">{m[1]}</span>);
    } else if (m[3] !== undefined) out.push(<span key={at} className="tok-n">{m[3]}</span>);
    else out.push(<span key={at} className="tok-k">{m[4]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
