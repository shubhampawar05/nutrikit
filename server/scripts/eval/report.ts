// Comparison tables from recorded eval results (data/eval/results/*.json), so a report can be regenerated exactly.
//
//   node --import tsx scripts/eval/report.ts <baseline-label> <label> [<label> ...]
//
// Each label is compared with the baseline on the metrics both report: mean across runs, min-max spread, and the
// difference of means. Point-only and range-only figures are recomputed from the per-dish rows.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { median } from './metrics.ts';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const load = (label: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/eval/results', `${label}.json`), 'utf8'));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Per-run values of derived metrics that the runner doesn't summarise separately. */
function derived(r: any) {
  return r.runs.map((run: any) => {
    const pts = run.rows.filter((x: any) => x.ref?.kind === 'point' && x.calorieError != null).map((x: any) => x.calorieError);
    const rng = run.rows.filter((x: any) => x.ref?.kind === 'range' && x.calorieError != null);
    return {
      pointMedianError: median(pts),
      pointWithin20: pts.length ? pts.filter((e: number) => e <= 0.2).length / pts.length : null,
      insideRange: rng.length ? rng.filter((x: any) => x.calorieError === 0).length / rng.length : null,
      failedCalls: run.summary.calls?.failed ?? null,
    };
  });
}

function stats(values: (number | null)[]) {
  const xs = values.filter((x): x is number => x != null);
  return { mean: mean(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null };
}

const PCT = /coverage|Error|Mape|within|inside|Within/;
const fmt = (k: string, v: number | null, signed = false) => {
  if (v == null) return '-';
  const s = signed && v > 0 ? '+' : '';
  if (PCT.test(k)) return `${s}${(v * 100).toFixed(1)}${signed ? ' pts' : '%'}`;
  if (k === 'costUsd') return `${s}$${v.toFixed(4)}`;
  if (k.startsWith('latency')) return `${s}${(v / 1000).toFixed(1)} s`;
  return `${s}${Math.round(v * 10) / 10}`;
};

const [baseLabel, ...others] = process.argv.slice(2);
if (!baseLabel) throw new Error('usage: report.ts <baseline-label> [<label> ...]');
const base = load(baseLabel);
const isP = base.config.set.name === 'P';
const KEYS = isP
  ? ['coverage', 'maeGrams', 'medianRelativeError', 'within25', 'over2x', 'latencyMs.median', 'costUsd']
  : ['coverage', 'pointMedianError', 'pointWithin20', 'insideRange', 'calorieMedianError', 'within20', 'over50', 'calorieMaeKcal', 'macroMaeGrams.fat', 'failedCalls', 'latencyMs.median', 'latencyMs.p90', 'tokens.output', 'costUsd'];
const pick = (r: any, k: string) => {
  const d = derived(r);
  return r.runs.map((run: any, i: number) => (k in d[i] ? d[i][k] : k.split('.').reduce((o: any, p) => (o == null ? null : o[p]), run.summary)));
};

for (const label of [baseLabel, ...others]) {
  const r = load(label);
  const c = r.config;
  console.log(`\n### ${label}\nset ${c.set.name} v${c.set.version} (sha ${String(c.set.sha256).slice(0, 12)}), ${c.provider}/${c.model}, variant ${c.variant}, prompt ${c.promptVersion}, ${c.runs} runs, commit ${c.gitCommit}${c.gitDirty ? '+dirty' : ''}`);
  if (label !== baseLabel && (c.set.sha256 !== base.config.set.sha256)) console.log('WARNING: different benchmark set from the baseline');
  console.log(`| metric | ${label === baseLabel ? 'value' : `baseline (${baseLabel})`} | ${label === baseLabel ? 'spread' : 'new'} | ${label === baseLabel ? '' : 'difference'} |`);
  console.log('|---|---|---|---|');
  for (const k of KEYS) {
    const b = stats(pick(base, k));
    const n = stats(pick(r, k));
    if (label === baseLabel) console.log(`| ${k} | ${fmt(k, b.mean)} | ${fmt(k, b.min)} – ${fmt(k, b.max)} | |`);
    else console.log(`| ${k} | ${fmt(k, b.mean)} (${fmt(k, b.min)} – ${fmt(k, b.max)}) | ${fmt(k, n.mean)} (${fmt(k, n.min)} – ${fmt(k, n.max)}) | ${b.mean != null && n.mean != null ? fmt(k, n.mean - b.mean, true) : '-'} |`);
  }
  if (label !== baseLabel && !isP) {
    // Paired: only dishes answered in both, each scored by its mean error across that config's runs, so a run that
    // lost dishes to rate limits doesn't change which dishes are compared.
    const perDish = (x: any) => {
      const m = new Map<string, number[]>();
      for (const run of x.runs) for (const row of run.rows) if (row.calorieError != null) m.set(row.key, [...(m.get(row.key) ?? []), row.calorieError]);
      return new Map([...m].map(([k, v]) => [k, mean(v)!]));
    };
    const pb = perDish(base);
    const pn = perDish(r);
    const both = [...pb.keys()].filter((k) => pn.has(k));
    const better = both.filter((k) => pn.get(k)! < pb.get(k)! - 0.02).length;
    const worse = both.filter((k) => pn.get(k)! > pb.get(k)! + 0.02).length;
    console.log(`paired on ${both.length} dishes answered by both: median error ${fmt('Error', median(both.map((k) => pb.get(k)!)))} -> ${fmt('Error', median(both.map((k) => pn.get(k)!)))}; better on ${better}, worse on ${worse}, within 2 pts on ${both.length - better - worse}`);
  }
}
