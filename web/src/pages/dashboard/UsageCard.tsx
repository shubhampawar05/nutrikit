// Live usage this month: the plan's allowance, a daily chart and calls per endpoint.
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtPeriodDate, type Me } from '../../api/client.ts';
import { ErrorRetry } from '../../components/ErrorRetry.tsx';
import { UsageChart } from './UsageChart.tsx';

export function UsageCard({ me }: { me: Me }) {
  const usage = useQuery({ queryKey: ['usage', me.team.id, 30], queryFn: () => api.usage(30) });
  const used = me.usage.used;
  const limit = me.plan.monthlyTokens;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const reset = new Date(me.usage.periodStart);
  reset.setUTCMonth(reset.getUTCMonth() + 1);
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '0 0 12px' }}>Live usage this month</h2>
        <span className="small muted">Resets {fmtPeriodDate(reset.toISOString())}</span>
      </div>
      <p style={{ margin: '16px 0 0' }}>
        <span className="big-number">{fmt(used)}</span>{' '}
        <span className="muted">{limit == null ? 'tokens used' : `of ${fmt(limit)} tokens · ${fmt(me.usage.remaining)} left`}</span>
      </p>
      <div className={pct >= 80 ? 'meter high' : 'meter'}><span style={{ width: `${pct}%` }} /></div>
      {usage.isError
        ? <ErrorRetry error={usage.error} onRetry={() => usage.refetch()} />
        : <UsageChart series={usage.data?.series ?? []} />}
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data">
          <thead>
            <tr><th scope="col">Endpoint</th><th scope="col">Calls</th><th scope="col">Tokens</th></tr>
          </thead>
          <tbody>
            {usage.isPending
              ? <tr><td colSpan={3} className="muted">Loading usage…</td></tr>
              : usage.data && (usage.data.month.byEndpoint.length
                ? usage.data.month.byEndpoint.map((r) => (
                  <tr key={r.endpoint}><td>{r.endpoint}</td><td>{fmt(r.calls)}</td><td>{fmt(r.tokens)}</td></tr>
                ))
                : <tr><td colSpan={3} className="muted">No calls yet this month.</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: '12px 0 0' }}>
        Live keys only. Test keys: {fmt(me.testUsage.used)} of {fmt(me.testUsage.limit)} test tokens used this month.
      </p>
    </section>
  );
}
