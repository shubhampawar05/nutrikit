// Homepage live demo: a meal description becomes matched foods and a Nutrition Facts label.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client.ts';
import { CALORIES, ROWS, labelTexts, valueText, type DemoResult, type LabelRow, type Totals } from './demo.ts';

const DEFAULT_TEXT = '2 eggs, toast with butter and an orange juice';
const EXAMPLES = [
  'a bowl of oatmeal with blueberries',
  '2 slices of pizza and a diet coke',
  '200g chicken breast with 1 cup brown rice',
];

type ItemsView = { kind: 'message'; text: string } | { kind: 'result'; result: DemoResult };

function NfRow({ row, totals, changed }: { row: LabelRow; totals: Totals; changed: boolean }) {
  const { sub = false, thick = false, bold = true } = row;
  const dv = row.noDv ? null : (totals[row.key]?.dailyValuePercent ?? null);
  return (
    <div className={`nf-row${sub ? ' sub' : ''}${thick ? ' thick' : ''}`}>
      <span>{bold ? <b>{row.label}</b> : row.label} <span className={`tick${changed ? ' changed' : ''}`}>{valueText(totals, row)}</span></span>
      <b>{dv == null ? '' : `${dv}%`}</b>
    </div>
  );
}

function NutritionLabel({ totals, count, changed }: { totals: Totals; count: number; changed: Set<string> }) {
  return (
    <div className="nf" aria-label="Nutrition facts for this meal">
      <p className="nf-title">Nutrition Facts</p>
      <div className="nf-sub">{count} food{count === 1 ? '' : 's'} · this meal</div>
      <div className="nf-cal"><b>Calories</b><span className={`tick${changed.has('calories') ? ' changed' : ''}`}>{valueText(totals, CALORIES)}</span></div>
      <div className="nf-dv">% Daily Value*</div>
      {ROWS.map((row) => <NfRow key={row.key} row={row} totals={totals} changed={changed.has(row.key)} />)}
      <p className="nf-note">* % Daily Value is based on a 2,000 calorie diet.</p>
    </div>
  );
}

function Items({ view }: { view: ItemsView }) {
  if (view.kind === 'message') return <p className="demo-empty">{view.text}</p>;
  const { items, unmatched } = view.result;
  if (!items.length) return <p className="demo-empty">No foods recognised — try “a banana and a coffee”.</p>;
  return (
    <>
      {items.map((i, n) => (
        <div key={n} className="demo-item" style={{ animationDelay: `${n * 60}ms` }}>
          <span className="said">“{i.input}”</span><span></span>
          <span className="food">{i.food.name}</span><span className="kcal">{Math.round(i.nutrients.calories?.amount ?? 0)} kcal</span>
          <span className="said">{i.portionBasis || `${i.quantity} ${i.unit}`}</span><span className="grams">{i.grams} g</span>
        </div>
      ))}
      {unmatched.length > 0 && <p className="demo-empty">Skipped: {unmatched.map((u) => u.text).join(', ')}</p>}
    </>
  );
}

export function Demo() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [view, setView] = useState<ItemsView>({ kind: 'message', text: 'Reading your meal…' });
  const [totals, setTotals] = useState<Totals>({});
  const [count, setCount] = useState(0);
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const [meta, setMeta] = useState('POST /v1/log/text');

  const previous = useRef(labelTexts({}));
  const seq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unflash = useRef<ReturnType<typeof setTimeout>>(undefined);
  const started = useRef(false);

  const run = useCallback(async (value: string) => {
    const t = value.trim();
    if (!t) return;
    const mine = ++seq.current;
    const t0 = performance.now();
    try {
      const data = await api.demo<DemoResult>(t);
      if (mine !== seq.current) return; // a newer request superseded this one
      const texts = labelTexts(data.totals);
      setChanged(new Set(Object.keys(texts).filter((k) => previous.current[k] !== texts[k])));
      previous.current = texts;
      clearTimeout(unflash.current);
      unflash.current = setTimeout(() => setChanged(new Set()), 900);
      setView({ kind: 'result', result: data });
      setTotals(data.totals);
      setCount(data.items.length);
      setMeta(`POST /v1/log/text · ${data.items.length} item${data.items.length === 1 ? '' : 's'} · ${Math.round(performance.now() - t0)} ms`);
    } catch (err) {
      if (mine !== seq.current) return;
      // API errors (including the demo's 429 rate limit) show the server's message.
      setView({ kind: 'message', text: err instanceof ApiError ? err.message || 'Something went wrong.' : 'Could not reach the API.' });
    }
  }, []);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void run(DEFAULT_TEXT);
    }
    return () => {
      clearTimeout(debounce.current);
      clearTimeout(unflash.current);
    };
  }, [run]);

  const onInput = (value: string) => {
    setText(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(value), 650);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    clearTimeout(debounce.current);
    void run(text);
  };

  const pick = (example: string) => {
    setText(example);
    clearTimeout(debounce.current);
    void run(example);
  };

  return (
    <div className="demo" aria-labelledby="demo-title">
      <form className="demo-input" onSubmit={onSubmit}>
        <label htmlFor="demo-text" id="demo-title">Try it — what did you eat?</label>
        <div className="demo-row">
          <input id="demo-text" name="text" maxLength={200} autoComplete="off" value={text} onChange={(e) => onInput(e.target.value)} />
          <button className="btn btn-primary btn-sm" type="submit">Log it</button>
        </div>
        <div className="demo-chips" role="group" aria-label="Examples">
          {EXAMPLES.map((ex) => <button key={ex} className="chip" type="button" onClick={() => pick(ex)}>{ex}</button>)}
        </div>
      </form>
      <div className="demo-body">
        <div className="demo-items" aria-live="polite">
          <h4>Matched foods</h4>
          <div><Items view={view} /></div>
        </div>
        <NutritionLabel totals={totals} count={count} changed={changed} />
      </div>
      <div className="demo-foot"><span>{meta}</span><span>USDA FoodData Central</span></div>
    </div>
  );
}
