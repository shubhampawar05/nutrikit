// Operator console: sign in with the admin token, then see accounts, payments and keys, revoke keys, change plans
// and review upgrade requests. Not linked from the site navigation; open /admin directly.
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fmt, fmtDate, fmtPrice } from '../api/client.ts';
import { adminApi, adminToken, type AdminAccount, type AdminKey } from '../api/admin.ts';
import { useTitle } from '../hooks.ts';
import { useToast } from '../components/Toast.tsx';
import '../styles/admin.css';

const PLAN_OPTIONS: [string, string][] = [['free', 'Free'], ['starter', 'Starter'], ['growth', 'Growth'], ['enterprise', 'Enterprise']];
const planName = (id: string) => PLAN_OPTIONS.find(([v]) => v === id)?.[1] ?? id;
const TABS = ['Overview', 'Payments', 'Accounts', 'Keys', 'Requests'] as const;
type Tab = (typeof TABS)[number];

const message = (err: unknown) => {
  const text = err instanceof ApiError ? err.message : 'Could not reach the server';
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
};

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi.signIn(token.trim());
      adminToken.set(token.trim());
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'That admin token was not accepted.' : message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="wrap">
      <form className="card admin-signin" onSubmit={submit}>
        <span className="kicker">Admin</span>
        <h1 style={{ margin: '8px 0 6px' }}>Operator console</h1>
        <p className="muted small" style={{ marginTop: 0 }}>Sign in with the server's <code>NUTRIKIT_ADMIN_TOKEN</code>. It is kept in this tab only.</p>
        <div className="field">
          <label htmlFor="admin-token">Admin token</label>
          <input id="admin-token" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !token.trim()} style={{ width: '100%' }}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <span className="muted small">{label}</span>
      <div className="big-number">{value}</div>
      {sub ? <span className="muted small">{sub}</span> : null}
    </div>
  );
}

function OverviewTab() {
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

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="input" type="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function PaymentsTab() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['admin', 'payments', q], queryFn: () => adminApi.payments(q) });
  return (
    <section className="card">
      <div className="admin-toolbar">
        <h2 style={{ margin: 0 }}>Payments</h2>
        <Search value={q} onChange={setQ} placeholder="Search by email or name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Paid</th><th>Account</th><th>Plan</th><th>Amount</th><th>Paid until</th><th>Razorpay</th></tr>
            {list.data?.payments.map((p) => (
              <tr key={p.paymentId}>
                <td>{fmtDate(p.paidAt)}</td>
                <td>{p.email}<span className="muted small admin-sub">{p.name}</span></td>
                <td>{planName(p.plan)}</td>
                <td>{fmtPrice(p.amount, p.currency)}</td>
                <td>{fmtDate(p.periodEnd)}</td>
                <td className="mono small">{p.paymentId}<span className="muted admin-sub">{p.orderId}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && !list.data.payments.length ? <p className="muted">No payments{q ? ' match this search' : ' yet'}.</p> : null}
    </section>
  );
}

function PlanChanger({ account }: { account: AdminAccount }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [plan, setPlan] = useState(account.plan);
  const change = useMutation({
    mutationFn: () => adminApi.setPlan(account.id, plan),
    onSuccess: () => {
      toast(`${account.email} is now on ${planName(plan)}`);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast(message(err)),
  });
  const apply = () => {
    const ending = account.planExpiresAt ? ` Their paid period (until ${fmtDate(account.planExpiresAt)}) is replaced by a plan with no end date.` : '';
    if (window.confirm(`Set ${account.email} to the ${planName(plan)} plan?${ending}`)) change.mutate();
  };
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <select aria-label={`Plan for ${account.email}`} value={plan} onChange={(e) => setPlan(e.target.value)}>
        {PLAN_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <button className="btn btn-ghost btn-sm" type="button" disabled={plan === account.plan || change.isPending} onClick={apply}>Set</button>
    </div>
  );
}

function AccountsTab() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['admin', 'accounts', q], queryFn: () => adminApi.accounts(q) });
  return (
    <section className="card">
      <div className="admin-toolbar">
        <h2 style={{ margin: 0 }}>Accounts</h2>
        <Search value={q} onChange={setQ} placeholder="Search by email or name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Account</th><th>Plan</th><th>Paid until</th><th>Keys</th><th>Tokens this month</th><th>Total paid</th><th>Joined</th><th>Change plan</th></tr>
            {list.data?.accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.email}<span className="muted small admin-sub">{a.name} · {a.id}</span></td>
                <td><span className={`badge${a.plan !== 'free' ? ' ok' : ''}`}>{planName(a.plan)}</span></td>
                <td>{a.planExpiresAt ? fmtDate(a.planExpiresAt) : <span className="muted">—</span>}</td>
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

function KeysTab() {
  const [q, setQ] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'keys', q], queryFn: () => adminApi.keys(q) });
  const revoke = useMutation({
    mutationFn: (key: AdminKey) => adminApi.revokeKey(key.id),
    onSuccess: (_r, key) => {
      toast(`Key “${key.name}” revoked`);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast(message(err)),
  });
  const onRevoke = (key: AdminKey) => {
    const owner = key.email ?? 'an operator key';
    if (window.confirm(`Revoke “${key.name}” (${owner})? It stops working immediately, with any access tokens made from it. This cannot be undone.`)) revoke.mutate(key);
  };
  return (
    <section className="card">
      <div className="admin-toolbar">
        <h2 style={{ margin: 0 }}>API keys</h2>
        <Search value={q} onChange={setQ} placeholder="Search by email, name or key name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Key</th><th>Owner</th><th>Created</th><th>Last used</th><th>Tokens this month</th><th></th></tr>
            {list.data?.keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}<span className="muted small admin-sub">{k.id}</span></td>
                <td>{k.email ?? <span className="muted">operator key</span>}{k.accountName ? <span className="muted small admin-sub">{k.accountName}</span> : null}</td>
                <td>{fmtDate(k.createdAt)}</td>
                <td>{k.lastUsedAt ? fmtDate(k.lastUsedAt) : <span className="muted">never</span>}</td>
                <td>{fmt(k.usedThisMonth)}</td>
                <td>
                  {k.revokedAt
                    ? <span className="badge">revoked {fmtDate(k.revokedAt)}</span>
                    : <button className="btn btn-danger btn-sm" type="button" disabled={revoke.isPending} onClick={() => onRevoke(k)}>Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && !list.data.keys.length ? <p className="muted">No keys{q ? ' match this search' : ' yet'}.</p> : null}
    </section>
  );
}

function RequestsTab() {
  const list = useQuery({ queryKey: ['admin', 'requests'], queryFn: adminApi.requests });
  return (
    <section className="card">
      <h2 style={{ margin: '0 0 12px' }}>Upgrade requests</h2>
      <p className="muted small" style={{ marginTop: 0 }}>Enterprise, or any plan while online payment is off. Change the plan from the Accounts tab.</p>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Received</th><th>Account</th><th>Current plan</th><th>Wants</th><th>Message</th></tr>
            {list.data?.requests.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.createdAt)}</td>
                <td>{r.email}<span className="muted small admin-sub">{r.name}</span></td>
                <td>{planName(r.currentPlan)}</td>
                <td><span className="badge hot">{planName(r.requestedPlan)}</span></td>
                <td>{r.message ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && !list.data.requests.length ? <p className="muted">No upgrade requests yet.</p> : null}
    </section>
  );
}

export function Admin() {
  useTitle('Admin — Nutrikit');
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(() => adminToken.get() !== null);
  const [tab, setTab] = useState<Tab>('Overview');

  const signOut = () => {
    adminToken.clear();
    queryClient.removeQueries({ queryKey: ['admin'] });
    setSignedIn(false);
  };

  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;

  return (
    <main className="wrap dash">
      <div className="dash-head">
        <div>
          <span className="kicker">Admin</span>
          <h1>Operator console</h1>
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={signOut}>Sign out</button>
      </div>
      <div className="pg-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button key={t} className="pg-tab" type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Overview' && <OverviewTab />}
      {tab === 'Payments' && <PaymentsTab />}
      {tab === 'Accounts' && <AccountsTab />}
      {tab === 'Keys' && <KeysTab />}
      {tab === 'Requests' && <RequestsTab />}
    </main>
  );
}
