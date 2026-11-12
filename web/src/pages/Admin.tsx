// Operator console: sign in with the admin token, then see accounts, payments and keys, revoke keys, change plans
// and review upgrade requests. Not linked from the site navigation; open /admin directly.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fmt, fmtDate, fmtPrice, sentence } from '../api/client.ts';
import { ADMIN_UNAUTHORIZED, adminApi, adminToken, type AdminAccount, type AdminKey } from '../api/admin.ts';
import { TabList, tabIds } from '../components/Tabs.tsx';
import { useToast } from '../components/Toast.tsx';
import '../styles/admin.css';

const PLAN_OPTIONS: [string, string][] = [['free', 'Free'], ['starter', 'Starter'], ['growth', 'Growth'], ['enterprise', 'Enterprise']];
const planName = (id: string) => PLAN_OPTIONS.find(([v]) => v === id)?.[1] ?? id;
const TABS = ['Overview', 'Health', 'Payments', 'Accounts', 'Keys', 'Requests'] as const;
type Tab = (typeof TABS)[number];

const TABS_PREFIX = 'admin';
const SEARCH_DELAY_MS = 300;
const TOKEN_REFUSED = 'That admin token is no longer accepted.';

const message = (err: unknown) => (err instanceof ApiError ? sentence(err.message) : 'Could not reach the server.');

/** The value, updated only once it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay = SEARCH_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SignIn({ onSignedIn, notice = '' }: { onSignedIn: () => void; notice?: string }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState(notice);
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

function HealthTab() {
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
      <p className="muted small" style={{ marginTop: 0 }}>This server instance since it last started; refreshes every 15 seconds.</p>
      <div className="admin-stats">
        <Stat label="Up for" value={duration(m.uptimeSeconds)} sub={`since ${fmtDate(m.startedAt)} · Node ${m.process.node}`} />
        <Stat label="Requests (last 5 min)" value={fmt(r5.requests)} sub={`${fmt(r5.serverErrors)} server errors (${pct(r5.serverErrors, r5.requests)})`} />
        <Stat label="Requests (last hour)" value={fmt(r60.requests)} sub={`${fmt(r60.serverErrors)} server errors (${pct(r60.serverErrors, r60.requests)})`} />
        <Stat label="Memory" value={`${fmt(Math.round(m.process.rssMb))} MB`} sub={`heap ${fmt(Math.round(m.process.heapUsedMb))} MB`} />
        <Stat label="Event-loop delay (p99)" value={msText(m.process.eventLoopDelayMs.p99)} sub="above ~100 ms the server is overloaded" />
        <Stat label="Alerts" value={m.alerts.configured ? 'On' : 'Off'} sub={alerts} />
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ margin: '0 0 12px' }}>Routes</h2>
        <div className="table-scroll">
          <table className="data" aria-busy={q.isFetching}>
            <thead>
              <tr><th scope="col">Route</th><th scope="col">Requests</th><th scope="col">4xx</th><th scope="col">5xx</th><th scope="col">p50</th><th scope="col">p95</th><th scope="col">p99</th></tr>
            </thead>
            <tbody>
              {m.routes.map((r) => (
                <tr key={r.route}>
                  <td><code>{r.route}</code></td>
                  <td>{fmt(r.count)}</td>
                  <td>{fmt(r.byStatus['4xx'])}</td>
                  <td>{r.byStatus['5xx'] ? <span className="badge hot">{fmt(r.byStatus['5xx'])}</span> : 0}</td>
                  <td>{msText(r.p50Ms)}</td>
                  <td>{msText(r.p95Ms)}</td>
                  <td>{msText(r.p99Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!m.routes.length ? <p className="muted">No requests yet.</p> : null}
      </section>
    </>
  );
}

function Search({ value, onChange, placeholder, busy }: { value: string; onChange: (v: string) => void; placeholder: string; busy: boolean }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <span className="muted small" role="status">{busy ? 'Searching…' : ''}</span>
      <input className="input" type="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A search box's text, the debounced query sent to the server, and whether results are still catching up. */
function useSearch() {
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  return { text, setText, q, pending: q !== text.trim() };
}

function PaymentsTab() {
  const { text, setText, q, pending } = useSearch();
  const list = useQuery({ queryKey: ['admin', 'payments', q], queryFn: () => adminApi.payments(q), placeholderData: keepPreviousData });
  return (
    <section className="card">
      <div className="admin-toolbar">
        <h2 style={{ margin: 0 }}>Payments</h2>
        <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search by email or name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Paid</th><th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Amount</th><th scope="col">Paid until</th><th scope="col">Razorpay</th></tr>
          </thead>
          <tbody>
            {list.data?.payments.map((p) => (
              <tr key={p.paymentId}>
                <td>{fmtDate(p.paidAt)}</td>
                <td>{p.email ? <>{p.email}<span className="muted small admin-sub">{p.name}</span></> : <span className="muted">Deleted account</span>}</td>
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
  const { text, setText, q, pending } = useSearch();
  const list = useQuery({ queryKey: ['admin', 'accounts', q], queryFn: () => adminApi.accounts(q), placeholderData: keepPreviousData });
  return (
    <section className="card">
      <div className="admin-toolbar">
        <h2 style={{ margin: 0 }}>Accounts</h2>
        <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search by email or name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Paid until</th><th scope="col">Keys</th><th scope="col">Tokens this month</th><th scope="col">Total paid</th><th scope="col">Joined</th><th scope="col">Change plan</th></tr>
          </thead>
          <tbody>
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
  const { text, setText, q, pending } = useSearch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'keys', q], queryFn: () => adminApi.keys(q), placeholderData: keepPreviousData });
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
        <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search by email, name or key name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Key</th><th scope="col">Owner</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col">Tokens this month</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
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
                    : <button className="btn btn-danger btn-sm" type="button" disabled={revoke.isPending} aria-label={`Revoke ${k.name}`} onClick={() => onRevoke(k)}>Revoke</button>}
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
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Received</th><th scope="col">Account</th><th scope="col">Current plan</th><th scope="col">Wants</th><th scope="col">Message</th></tr>
          </thead>
          <tbody>
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
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(() => adminToken.get() !== null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [notice, setNotice] = useState('');

  const signOut = (why = '') => {
    adminToken.clear();
    queryClient.removeQueries({ queryKey: ['admin'] });
    setNotice(why);
    setSignedIn(false);
  };

  // The stored token was refused by any admin call (rotated on the server, say): back to sign-in.
  useEffect(() => {
    const onRefused = () => signOut(TOKEN_REFUSED);
    window.addEventListener(ADMIN_UNAUTHORIZED, onRefused);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED, onRefused);
  });

  if (!signedIn) return <SignIn notice={notice} onSignedIn={() => { setNotice(''); setTab('Overview'); setSignedIn(true); }} />;

  const ids = tabIds(TABS_PREFIX, tab);

  return (
    <main className="wrap dash">
      <div className="dash-head">
        <div>
          <span className="kicker">Admin</span>
          <h1>Operator console</h1>
        </div>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => signOut()}>Sign out</button>
      </div>
      <TabList
        tabs={TABS.map((t) => ({ id: t, label: t }))}
        current={tab}
        onChange={(id) => setTab(id as Tab)}
        label="Admin sections"
        prefix={TABS_PREFIX}
        className="pg-tabs"
        tabClassName="pg-tab"
      />
      <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} tabIndex={0}>
        {tab === 'Overview' && <OverviewTab />}
        {tab === 'Health' && <HealthTab />}
        {tab === 'Payments' && <PaymentsTab />}
        {tab === 'Accounts' && <AccountsTab />}
        {tab === 'Keys' && <KeysTab />}
        {tab === 'Requests' && <RequestsTab />}
      </div>
    </main>
  );
}
