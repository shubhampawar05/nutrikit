import { useQuery } from '@tanstack/react-query';
import { fmtDate } from '../../api/client.ts';
import { adminApi } from '../../api/admin.ts';
import { Empty, message, planName } from './common.tsx';

export function RequestsTab() {
  const list = useQuery({ queryKey: ['admin', 'requests'], queryFn: adminApi.requests });
  return (
    <section className="card admin-card">
      <h2>Upgrade requests</h2>
      <p className="admin-note">Enterprise, or any plan while online payment is off. Change the plan from the Accounts tab.</p>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      {list.data && !list.data.requests.length ? <Empty>No upgrade requests yet.</Empty> : <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Received</th><th scope="col">Account</th><th scope="col">Current plan</th><th scope="col">Wants</th><th scope="col">Message</th></tr>
          </thead>
          <tbody>
            {list.data?.requests.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDate(r.createdAt)}</td>
                <td>{r.email}<span className="muted small admin-sub">{r.name}</span></td>
                <td>{planName(r.currentPlan)}</td>
                <td><span className="badge hot">{planName(r.requestedPlan)}</span></td>
                <td>{r.message ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
