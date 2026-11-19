import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt, fmtDate } from '../../api/client.ts';
import { adminApi, type FoodRequest, type FoodRequestStatus } from '../../api/admin.ts';
import { useToast } from '../../components/Toast.tsx';
import { Select } from '../../components/Select.tsx';
import { Empty, message, Search, useSearch } from './common.tsx';

const REQUEST_FILTERS: { value: FoodRequestStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'ignored', label: 'Ignored' }, { value: 'all', label: 'All' },
];
const ESTIMATE_BADGE = { pending: ['warn', 'to review'], approved: ['ok', 'approved'], rejected: ['', 'rejected'] } as const;

/** An AI estimate in one line: its name, energy and macros per 100 g, and its serving. */
function EstimateSummary({ r }: { r: FoodRequest }) {
  const e = r.estimate;
  if (!e) return <span className="muted">none yet</span>;
  const [cls, label] = ESTIMATE_BADGE[r.estimateStatus as keyof typeof ESTIMATE_BADGE] ?? ['', r.estimateStatus];
  const n = e.per100g;
  if (e.sameAs) {
    return (
      <>
        <span className={`badge ${cls}`}>{label}</span> Same as <b>{e.sameAs.name}</b>
        <span className="muted small admin-sub">Logged with this catalog food's own values. Consider adding “{r.phrase}” as its alias.</span>
        <span className="muted small admin-sub">Used {fmt(r.estimateUses)} {r.estimateUses === 1 ? 'time' : 'times'} · {e.provider}{e.model ? ` ${e.model}` : ''}</span>
      </>
    );
  }
  return (
    <>
      <span className={`badge ${cls}`}>{label}</span> {e.name}
      <span className="muted small admin-sub">
        {fmt(Math.round(n.calories))} kcal · P {n.protein} g · C {n.carbs} g · F {n.fat} g per 100 g · {e.serving.label} = {fmt(Math.round(e.serving.grams))} g · {e.confidence} confidence
      </span>
      <span className="muted small admin-sub">Used {fmt(r.estimateUses)} {r.estimateUses === 1 ? 'time' : 'times'} · {e.provider}{e.model ? ` ${e.model}` : ''}</span>
    </>
  );
}

export function MissingFoodsTab() {
  const { text, setText, q, pending } = useSearch();
  const [status, setStatus] = useState<FoodRequestStatus | 'all'>('open');
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'food-requests', status, q], queryFn: () => adminApi.foodRequests(status, q), placeholderData: keepPreviousData });
  const update = useMutation({
    mutationFn: ({ r, change }: { r: FoodRequest; change: Parameters<typeof adminApi.updateFoodRequest>[1]; done: string }) => adminApi.updateFoodRequest(r.id, change),
    onSuccess: (_row, { done }) => {
      toast(done);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'food-requests'] });
    },
    onError: (err) => toast(message(err)),
  });
  const act = (r: FoodRequest, change: Parameters<typeof adminApi.updateFoodRequest>[1], done: string) => update.mutate({ r, change, done });
  const approve = (r: FoodRequest) => {
    if (window.confirm(`Approve the estimate for “${r.phrase}”? Every caller logging it will get these values, without an AI call, until you reject it.`)) {
      act(r, { estimateStatus: 'approved' }, `Estimate for “${r.phrase}” approved`);
    }
  };
  const counts = list.data?.counts;
  return (
    <section className="card admin-card">
      <div className="admin-toolbar">
        <h2>Missing foods</h2>
        <div className="row" style={{ gap: 8 }}>
          <Select aria-label="Show requests" value={status} onChange={setStatus} options={REQUEST_FILTERS} />
          <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search foods" />
        </div>
      </div>
      <p className="admin-note">
        Foods people tried to log that the catalog has no match for, most asked first. Only the food words are kept.
        Add an alias or a recipe for real foods, then mark them resolved. Approving an AI estimate makes it answer that
        food for every caller until the catalog has it.
        {counts ? <> <b>{fmt(counts.open)}</b> open · <b>{fmt(counts.pendingEstimates)}</b> estimates to review · <b>{fmt(counts.approvedEstimates)}</b> approved.</> : null}
      </p>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      {list.data && !list.data.requests.length ? <Empty>{q ? 'No foods match this search.' : status === 'open' ? 'Nothing missing right now. Foods people fail to log will appear here.' : 'None.'}</Empty> : <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Food</th><th scope="col">Asked</th><th scope="col">Last seen</th><th scope="col">AI estimate</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.data?.requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.phrase}</b>{r.status !== 'open' ? <> <span className="badge">{r.status}</span></> : null}
                  <span className="muted small admin-sub">“{r.example}” · {r.reason}</span>
                  {r.note ? <span className="muted small admin-sub">Note: {r.note}</span> : null}
                </td>
                <td className="num">{fmt(r.count)}</td>
                <td className="nowrap">{fmtDate(r.lastSeen)}</td>
                <td><EstimateSummary r={r} /></td>
                <td>
                  <div className="row admin-actions">
                    {r.estimate && r.estimateStatus !== 'approved' ? <button className="btn btn-primary btn-sm" type="button" disabled={update.isPending} aria-label={`Approve estimate for ${r.phrase}`} onClick={() => approve(r)}>Approve</button> : null}
                    {r.estimate && r.estimateStatus !== 'rejected' ? <button className="btn btn-ghost btn-sm" type="button" disabled={update.isPending} aria-label={`Reject estimate for ${r.phrase}`} onClick={() => act(r, { estimateStatus: 'rejected' }, `Estimate for “${r.phrase}” rejected`)}>Reject</button> : null}
                    {r.status === 'open' ? (
                      <>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={update.isPending} aria-label={`Mark ${r.phrase} resolved`} onClick={() => act(r, { status: 'resolved' }, `“${r.phrase}” marked resolved`)}>Resolved</button>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={update.isPending} aria-label={`Ignore ${r.phrase}`} onClick={() => act(r, { status: 'ignored' }, `“${r.phrase}” ignored`)}>Ignore</button>
                      </>
                    ) : <button className="btn btn-ghost btn-sm" type="button" disabled={update.isPending} aria-label={`Reopen ${r.phrase}`} onClick={() => act(r, { status: 'open' }, `“${r.phrase}” reopened`)}>Reopen</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
