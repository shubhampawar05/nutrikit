import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fmtDate, fmtPrice } from '../../api/client.ts';
import { adminApi } from '../../api/admin.ts';
import { Empty, message, planName, Search, useSearch } from './common.tsx';

export function PaymentsTab() {
  const { text, setText, q, pending } = useSearch();
  const list = useQuery({ queryKey: ['admin', 'payments', q], queryFn: () => adminApi.payments(q), placeholderData: keepPreviousData });
  return (
    <section className="card admin-card">
      <div className="admin-toolbar">
        <h2>Payments</h2>
        <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search email or name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      {list.data && !list.data.payments.length ? <Empty>No payments{q ? ' match this search' : ' yet'}.</Empty> : <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Paid</th><th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Amount</th><th scope="col">Paid until</th><th scope="col">Razorpay</th></tr>
          </thead>
          <tbody>
            {list.data?.payments.map((p) => (
              <tr key={p.paymentId}>
                <td className="nowrap">{fmtDate(p.paidAt)}</td>
                <td>{p.email ? <>{p.email}<span className="muted small admin-sub">{p.name}</span></> : <span className="muted">Deleted account</span>}</td>
                <td>{planName(p.plan)}{p.note ? <span className="form-error small admin-sub">{p.note}</span> : null}</td>
                <td className="num">{fmtPrice(p.amount, p.currency)}</td>
                <td className="nowrap">{fmtDate(p.periodEnd)}</td>
                <td className="mono small">{p.paymentId}<span className="muted admin-sub">{p.orderId}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
