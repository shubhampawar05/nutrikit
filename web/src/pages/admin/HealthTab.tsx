import { useQuery } from '@tanstack/react-query';
import { fmt, fmtDate } from '../../api/client.ts';
import { adminApi } from '../../api/admin.ts';
import { Empty, message, Stat, StatGroup } from './common.tsx';

const HEALTH_REFRESH_MS = 15_000;

/** "3d 4h", "2h 5m", "40s". */
function duration(seconds: number) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m` : `${seconds}s`;
}
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '0%');
const msText = (n: number | null) => (n === null ? '—' : `${fmt(Math.round(n))} ms`);

export function HealthTab() {
  const q = useQuery({ queryKey: ['admin', 'metrics'], queryFn: adminApi.metrics, refetchInterval: HEALTH_REFRESH_MS });
  if (q.error) return <p className="form-error">{message(q.error)}</p>;
  const m = q.data;
  if (!m) return <p className="muted">Loading…</p>;
  const r5 = m.requests.last5Minutes, r60 = m.requests.last60Minutes;
  const alerts = m.alerts.configured
    ? `${fmt(m.alerts.sent)} sent · ${fmt(m.alerts.suppressed)} held back${m.alerts.failed ? ` · ${fmt(m.alerts.failed)} failed` : ''}`
    : 'Off: set NUTRIKIT_ALERT_WEBHOOK_URL';
  return (
    <>
      <p className="admin-note">This server instance since it last started; refreshes every 15 seconds.</p>
      <StatGroup columns={3}>
        <Stat label="Up for" value={duration(m.uptimeSeconds)} sub={`since ${fmtDate(m.startedAt)} · Node ${m.process.node}`} />
        <Stat label="Requests (last 5 min)" value={fmt(r5.requests)} sub={`${fmt(r5.serverErrors)} server errors (${pct(r5.serverErrors, r5.requests)})`} />
        <Stat label="Requests (last hour)" value={fmt(r60.requests)} sub={`${fmt(r60.serverErrors)} server errors (${pct(r60.serverErrors, r60.requests)})`} />
        <Stat label="Memory" value={`${fmt(Math.round(m.process.rssMb))} MB`} sub={`heap ${fmt(Math.round(m.process.heapUsedMb))} MB`} />
        <Stat label="Event-loop delay (p99)" value={msText(m.process.eventLoopDelayMs.p99)} sub="above ~100 ms the server is overloaded" />
        <Stat label="Alerts" value={m.alerts.configured ? 'On' : 'Off'} sub={alerts} />
      </StatGroup>
      <section className="card admin-card">
        <h2>Routes</h2>
        {!m.routes.length ? <Empty>No requests yet.</Empty> : <div className="table-scroll">
          <table className="data" aria-busy={q.isFetching}>
            <thead>
              <tr><th scope="col">Route</th><th scope="col">Requests</th><th scope="col">4xx</th><th scope="col">5xx</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">p99</th></tr>
            </thead>
            <tbody>
              {m.routes.map((r) => (
                <tr key={r.route}>
                  <td><code>{r.route}</code></td>
                  <td className="num">{fmt(r.count)}</td>
                  <td className="num">{fmt(r.byStatus['4xx'])}</td>
                  <td className="num">{r.byStatus['5xx'] ? <span className="badge hot">{fmt(r.byStatus['5xx'])}</span> : 0}</td>
                  <td className="num">{msText(r.p50Ms)}</td>
                  <td className="num">{msText(r.p95Ms)}</td>
                  <td className="num">{msText(r.p99Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </section>
    </>
  );
}
