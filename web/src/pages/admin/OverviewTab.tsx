import { useQuery } from '@tanstack/react-query';
import { fmt, fmtPrice } from '../../api/client.ts';
import { adminApi } from '../../api/admin.ts';
import { message, PLAN_OPTIONS, Stat } from './common.tsx';

export function OverviewTab() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: adminApi.overview });
  if (q.error) return <p className="form-error">{message(q.error)}</p>;
  const o = q.data;
  if (!o) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="admin-stats">
        <Stat label="Accounts" value={fmt(o.accounts)} sub={PLAN_OPTIONS.map(([id, name]) => `${name} ${fmt(o.byPlan[id] ?? 0)}`).join(' · ')} />
        <Stat label="Active paid plans" value={fmt(o.activePaidPeriods)} sub="30-day periods still running" />
        <Stat label="Revenue (all time)" value={fmtPrice(o.payments.revenue)} sub={`${fmt(o.payments.count)} payments`} />
        <Stat label="Revenue (last 30 days)" value={fmtPrice(o.payments.last30Days.revenue)} sub={`${fmt(o.payments.last30Days.count)} payments`} />
        <Stat label="Active API keys" value={fmt(o.activeKeys)} />
        <Stat label="Tokens this month" value={fmt(o.tokensThisMonth)} />
        <Stat label="Upgrade requests" value={fmt(o.upgradeRequests)} />
      </div>
    </>
  );
}
