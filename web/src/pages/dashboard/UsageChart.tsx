// Tokens per day for the last 30 days: the legacy hand-drawn SVG bars, redrawn with recharts.
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmt, type UsageDay } from '../../api/client.ts';

export function UsageChart({ series }: { series: UsageDay[] }) {
  const max = Math.max(1, ...series.map((d) => d.tokens));
  const total = series.reduce((s, d) => s + d.tokens, 0);
  return (
    <>
      <div className="chart" role="img" aria-label="Tokens used per day, last 30 days">
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
                return <div className="chart-tip">{d.day}: {d.tokens} tokens, {d.calls} calls</div>;
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
      <p className="small muted" style={{ margin: '4px 0 0' }}>
        {series.length > 0 &&
          `Last 30 days (${series[0].day} → ${series[series.length - 1].day}) · ${fmt(total)} tokens · busiest day ${fmt(max === 1 && !total ? 0 : max)}`}
      </p>
    </>
  );
}
