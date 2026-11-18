import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt, fmtDate, fmtPrice } from '../../api/client.ts';
import { adminApi, type AdminAccount } from '../../api/admin.ts';
import { useToast } from '../../components/Toast.tsx';
import { Select } from '../../components/Select.tsx';
import { message, PLAN_OPTIONS, planName, Search, useSearch } from './common.tsx';

function PlanChanger({ account }: { account: AdminAccount }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [plan, setPlan] = useState(account.plan);
  const change = useMutation({
    mutationFn: () => adminApi.setPlan(account.id, plan),
    onSuccess: () => {
      toast(`${account.name} is now on ${planName(plan)}`);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast(message(err)),
  });
  const apply = () => {
    const ending = account.planExpiresAt ? ` Their paid period (until ${fmtDate(account.planExpiresAt)}) is replaced by a plan with no end date.` : '';
    if (window.confirm(`Set ${account.name} to the ${planName(plan)} plan?${ending}`)) change.mutate();
  };
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <Select aria-label={`Plan for ${account.name}`} value={plan} onChange={setPlan} options={PLAN_OPTIONS.map(([value, label]) => ({ value, label }))} />
      <button className="btn btn-ghost btn-sm" type="button" disabled={plan === account.plan || change.isPending} onClick={apply}>Set</button>
    </div>
  );
}

export function AccountsTab() {
  const { text, setText, q, pending } = useSearch();
  const list = useQuery({ queryKey: ['admin', 'accounts', q], queryFn: () => adminApi.accounts(q), placeholderData: keepPreviousData });
  return (
    <section className="card">
      <div className="admin-toolbar">
        <h2 style={{ margin: 0 }}>Teams</h2>
        <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search by a member's email or team name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Team (owner)</th><th scope="col">Plan</th><th scope="col">Paid until</th><th scope="col">Members</th><th scope="col">Live keys</th><th scope="col">Tokens this month</th><th scope="col">Total paid</th><th scope="col">Joined</th><th scope="col">Change plan</th></tr>
          </thead>
          <tbody>
            {list.data?.accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}<span className="muted small admin-sub">{a.email ?? 'no owner'} · {a.id}</span></td>
                <td><span className={`badge${a.plan !== 'free' ? ' ok' : ''}`}>{planName(a.plan)}</span></td>
                <td>{a.planExpiresAt ? fmtDate(a.planExpiresAt) : <span className="muted">—</span>}</td>
                <td>{fmt(a.members)}</td>
                <td>{fmt(a.activeKeys)}</td>
                <td>{fmt(a.usedThisMonth)}</td>
                <td>{a.totalPaid ? fmtPrice(a.totalPaid) : <span className="muted">—</span>}</td>
                <td>{fmtDate(a.createdAt)}</td>
                <td><PlanChanger key={`${a.id}:${a.plan}`} account={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && !list.data.accounts.length ? <p className="muted">No accounts{q ? ' match this search' : ' yet'}.</p> : null}
    </section>
  );
}
