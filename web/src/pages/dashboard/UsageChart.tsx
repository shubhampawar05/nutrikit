// Tokens per day for the last 30 days: the legacy hand-drawn SVG bars, redrawn with recharts.
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt, type UsageDay } from '../../api/client.ts';

/** "2026-10-30" -> "Oct 30" (days are UTC dates on the server). */
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function UsageChart({ series }: { series: UsageDay[] }) {
  const max = Math.max(1, ...series.map((d) => d.tokens));
  const total = series.reduce((s, d) => s + d.tokens, 0);
  return (
    <>
      {/* The bars are for sighted users; screen readers get the same figures as a table. */}
      <div className="chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 14, right: 0, bottom: 16, left: 18 }} barCategoryGap={2}>
            <XAxis dataKey="day" hide />
            <YAxis hide domain={[0, max]} />
            <ReferenceLine y={0} stroke="var(--rule)" />
            <Tooltip
              cursor={false}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as UsageDay | undefined;
                if (!active || !d) return null;
                return <div className="chart-tip">{shortDay(d.day)}: {fmt(d.tokens)} tokens, {fmt(d.calls)} calls</div>;
              }}
            />
            <Bar
              dataKey="tokens"
              fill="var(--ink)"
              activeBar={{ fill: 'var(--tomato)' }}
              minPointSize={(value) => (value ? 1 : 0)}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series.length > 0 ? (
        <table className="sr-only">
          <caption>Tokens used per day, last 30 days</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Tokens</th></tr></thead>
          <tbody>
            {series.map((d) => <tr key={d.day}><td>{shortDay(d.day)}</td><td>{fmt(d.tokens)}</td></tr>)}
          </tbody>
        </table>
      ) : null}
      <p className="small muted" style={{ margin: '4px 0 0' }}>
        {series.length > 0 &&
          `Last 30 days (${series[0].day} → ${series[series.length - 1].day}) · ${fmt(total)} tokens · busiest day ${fmt(max === 1 && !total ? 0 : max)}`}
      </p>
    </>
  );
}
