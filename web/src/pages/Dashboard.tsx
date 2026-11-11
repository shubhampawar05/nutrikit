// Developer dashboard: account, plan and usage, API keys, upgrades (the legacy portal.js dashboard half).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorText, fmt, fmtDate, fmtPeriodDate, fmtPrice, PLAYGROUND_KEY_STORE, sentence, type Me } from '../api/client.ts';
import { payWithRazorpay } from '../api/razorpay.ts';
import { useMe } from '../hooks.ts';
import { waitText } from './Auth.tsx';
import { PAYMENTS_VISIBLE } from '../features.ts';
import { useToast } from '../components/Toast.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { UsageChart } from './dashboard/UsageChart.tsx';
import '../styles/dashboard.css';

/** sessionStorage: the newly created key, kept until the developer dismisses it (survives a refresh). */
const NEW_KEY = 'nutrikit-new-key';
const WELCOME = 'Welcome! Here is your first API key';
/** After a payment the browser couldn't confirm, reload the account this long after (the webhook applies it). */
const VERIFY_RETRY_MS = [5_000, 30_000];

interface Reveal { key: string; title: string }

function storedReveal(): Reveal | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(NEW_KEY) ?? 'null') as { key?: unknown; title?: unknown } | null;
    if (parsed && typeof parsed.key === 'string') {
      return { key: parsed.key, title: typeof parsed.title === 'string' ? parsed.title : WELCOME };
    }
  } catch { /* ignore a malformed entry */ }
  return null;
}

function ErrorRetry({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="dash-error">
      <p className="form-error" style={{ margin: 0 }}>{errorText(error)}</p>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}

// ---------------------------------------------------------------- one-time key reveal

function KeyReveal({ reveal, onDismiss }: { reveal: Reveal; onDismiss: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  // A new key is not read aloud: focus moves to the heading instead (the toast region says "New key created").
  useEffect(() => {
    setCopied(false);
    setManual(false);
    heading.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    heading.current?.focus({ preventScroll: true });
  }, [reveal.key]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.key);
      setCopied(true);
      setManual(false);
    } catch {
      input.current?.focus();
      input.current?.select();
      setManual(true);
    }
  };
  const dismiss = () => {
    if (!copied && !window.confirm("You haven't copied this key. It won't be shown again. Dismiss it anyway?")) return;
    onDismiss();
  };
  return (
    <div className="key-reveal">
      <h2 className="key-reveal-title" tabIndex={-1} ref={heading}>{reveal.title}</h2>
      <input
        ref={input}
        className="key-reveal-key"
        readOnly
        value={reveal.key}
        aria-label="New API key"
        onFocus={(e) => e.currentTarget.select()}
        onCopy={() => setCopied(true)}
      />
      <div className="row">
        <button className="btn btn-primary btn-sm" type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy key'}</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={dismiss}>I've saved it</button>
      </div>
      {manual ? <p className="small" style={{ margin: '8px 0 0' }}>Couldn't copy automatically. The key is selected: copy it manually (Ctrl+C or ⌘C).</p> : null}
      <p className="small" style={{ margin: '8px 0 0' }}>This is the only time the full key is shown. Store it somewhere safe, like your server's environment variables.</p>
    </div>
  );
}

// ---------------------------------------------------------------- usage this month

function UsageCard({ me }: { me: Me }) {
  const usage = useQuery({ queryKey: ['usage', 30], queryFn: () => api.usage(30) });
  const used = me.usage.used;
  const limit = me.plan.monthlyTokens;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const reset = new Date(me.usage.periodStart);
  reset.setUTCMonth(reset.getUTCMonth() + 1);
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '0 0 12px' }}>Usage this month</h2>
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
    </section>
  );
}

// ---------------------------------------------------------------- plan and upgrades

const UPGRADE_OPTIONS: [string, string][] = [
  ['starter', 'Starter — 100k tokens'],
  ['growth', 'Growth — 1M tokens'],
  ['enterprise', 'Enterprise — custom'],
];

function PlanCard({ me, status, setStatus }: { me: Me; status: string; setStatus: (s: string) => void }) {
  const queryClient = useQueryClient();
  const price = (p: string) => me.plans[p]?.price ?? null;
  // Paid plans are bought online (Razorpay, 30 days per payment) when the server has billing set up; the rest are requests.
  const payable = (p: string) => Boolean(me.billing.enabled && (price(p) ?? 0) > 0);
  const paidUntil = me.plan.expiresAt;
  // The same rank the server uses: the current plan can be extended (if it can be paid for) and a higher one chosen;
  // a cheaper one is never offered, whether or not the current plan has an end date.
  const selectable = (p: string) =>
    p === me.plan.id ? payable(p) : (me.plans[p]?.rank ?? Infinity) > me.plan.rank;
  const firstOpen = UPGRADE_OPTIONS.find(([v]) => v !== me.plan.id && selectable(v))?.[0]
    ?? UPGRADE_OPTIONS.find(([v]) => selectable(v))?.[0];
  const { register, handleSubmit, watch, resetField } = useForm<{ plan: string; message: string }>({
    defaultValues: { plan: firstOpen ?? 'starter', message: '' },
  });
  const plan = watch('plan');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  // Upgrade requests sent during this visit, by plan: the form for that plan is replaced by "Request sent".
  const [sent, setSent] = useState<Record<string, { plan: string; sentAt: string }>>({});
  // A payment Checkout reported but the portal couldn't confirm: a notice that stays until the next attempt.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const request = useMutation({ mutationFn: (v: { plan: string; message: string }) => api.requestUpgrade(v.plan, v.message) });

  const buy = async (p: string) => {
    setUnconfirmed(null);
    const order = await api.createOrder(p);
    setStatus('Complete the payment in the Razorpay window…');
    const response = await payWithRazorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'Nutrikit',
      description: `${me.plans[p]?.name ?? p} plan — 30 days`,
      prefill: { name: me.account.name, email: me.account.email },
      theme: { color: '#e0462b' },
    }, (message) => setStatus(`${sentence(message)} You can try again in the Razorpay window.`));
    if (!response) {
      setStatus('Payment cancelled — you have not been charged.');
      return;
    }
    setStatus('Payment received — activating your plan…');
    const view = await api.verifyPayment(response).catch(() => null);
    if (!view) {
      // The webhook applies a charged payment the browser couldn't confirm; reload the plan shortly to pick it up.
      setStatus('');
      setUnconfirmed(response.razorpay_payment_id);
      timers.current.forEach(clearTimeout);
      timers.current = VERIFY_RETRY_MS.map((ms) => setTimeout(() => queryClient.invalidateQueries({ queryKey: ['me'] }), ms));
      return;
    }
    queryClient.setQueryData<Me>(['me'], (old) => (old ? { ...old, ...view } : old));
    setStatus(`You're on the ${view.plan.name} plan until ${fmtPeriodDate(view.plan.expiresAt)}.`);
  };

  const onSubmit = async (data: { plan: string; message: string }) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (payable(data.plan)) {
        await buy(data.plan);
        return;
      }
      await request.mutateAsync(data);
      setSent((s) => ({ ...s, [data.plan]: { plan: data.plan, sentAt: new Date().toISOString() } }));
      setStatus('');
      resetField('message');
    } catch (err) {
      setStatus(errorText(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const current = me.plan.price;
  const action = (p: string) => (p === me.plan.id ? 'Extend 30 days' : 'Pay');
  const planName = (p: string) => me.plans[p]?.name ?? UPGRADE_OPTIONS.find(([v]) => v === p)?.[1].split(' —')[0] ?? p;
  const sentFor = sent[plan];
  return (
    <section className="card">
      <h2 style={{ margin: '0 0 12px' }}>Plan</h2>
      <p style={{ margin: 0 }}><b>{me.plan.name + (!PAYMENTS_VISIBLE ? '' : current ? ` — ${fmtPrice(current, me.plan.currency)} / 30 days` : current === 0 ? ` — ${fmtPrice(0, me.plan.currency)}` : '')}</b></p>
      {paidUntil ? <p className="small muted" style={{ margin: '4px 0 0' }}>Paid until {fmtPeriodDate(paidUntil)} · then the Free plan, unless you extend it.</p> : null}
      <ul className="muted small" style={{ paddingLeft: 18 }}>
        <li>{me.plan.monthlyTokens == null ? 'Custom monthly tokens' : `${fmt(me.plan.monthlyTokens)} tokens / month`}</li>
        <li>{fmt(me.plan.ratePerMinute)} requests / minute</li>
        <li>Up to {me.plan.maxKeys} API keys</li>
      </ul>
      {unconfirmed ? (
        <div className="notice" role="alert" style={{ margin: '0 0 12px' }}>
          We couldn't confirm the payment yet. If you were charged, your plan will switch on within a few minutes.
          {' '}Payment id <code>{unconfirmed}</code>. If it hasn't switched on by then, contact support with this id.
        </div>
      ) : null}
      {!PAYMENTS_VISIBLE ? null : firstOpen == null ? (
        <p className="small muted" style={{ margin: 0 }}>You're on our highest plan. To change it, contact us.</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="field">
            <label htmlFor="upgrade-plan">{paidUntil ? 'Extend or move up' : 'Need more?'}</label>
            <select id="upgrade-plan" {...register('plan')}>
              {UPGRADE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value} disabled={!selectable(value)}>{label}</option>
              ))}
            </select>
          </div>
          {sentFor ? (
            <p className="small" style={{ margin: '8px 0 0' }}>
              <b>Request sent</b> for the {planName(sentFor.plan)} plan on {fmtDate(sentFor.sentAt)}. We'll be in touch at {me.account.email}.
            </p>
          ) : (
            <>
              <div className="field" hidden={payable(plan)}>
                <label htmlFor="upgrade-msg">Tell us about your app (optional)</label>
                <textarea id="upgrade-msg" rows={2} maxLength={1000} {...register('message')} />
              </div>
              <button className="btn btn-ghost btn-sm" type="submit" disabled={busy || !selectable(plan)} aria-busy={busy || undefined}>
                {payable(plan) ? `${action(plan)} — ${fmtPrice(price(plan)!, me.plans[plan]?.currency)}` : 'Request upgrade'}
              </button>
              <p className="small muted" hidden={!payable(plan)} style={{ margin: '8px 0 0' }}>
                One-time payment for 30 days; no automatic renewal.
                {me.billing.mode === 'test' ? <> Test mode: use one of Razorpay's{' '}
                  <a href="https://razorpay.com/docs/payments/payments/test-card-details/" target="_blank" rel="noreferrer">test cards or UPI ids</a>.</> : null}
              </p>
            </>
          )}
          <p className="small muted" style={{ margin: '8px 0 0' }}>{status}</p>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- API keys

function KeysCard({ me, onCreated }: { me: Me; onCreated: (r: Reveal) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['keys'], queryFn: api.keys });
  const { register, handleSubmit, reset } = useForm<{ name: string }>({ defaultValues: { name: '' } });
  // Revokes in flight, by key id: a ref so a double click can't send twice, state so the row's button disables.
  const revoking = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const settle = (id: string) => {
    revoking.current.delete(id);
    setPendingIds(new Set(revoking.current));
  };

  const create = useMutation({
    mutationFn: (name: string) => api.createKey(name),
    onSuccess: (key) => {
      reset();
      onCreated({ key: key.key, title: `New key “${key.name}” created` });
      toast('New key created');
    },
    // The plan's key limit is enforced by the server (403 key_limit); its message says what to do.
    onError: (err) => toast(errorText(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: () => toast('Key revoked'),
    onError: (err) => toast(errorText(err)),
    onSettled: async (_data, _err, id) => {
      await queryClient.invalidateQueries({ queryKey: ['keys'] });
      settle(id);
    },
  });

  const onRevoke = (id: string, name: string) => {
    if (revoking.current.has(id)) return;
    if (!window.confirm(`Revoke “${name}”? Apps using it (and its access tokens) stop working immediately.`)) return;
    revoking.current.add(id);
    setPendingIds(new Set(revoking.current));
    revoke.mutate(id);
  };

  const list = keys.data?.keys;
  const active = list?.filter((k) => !k.revokedAt).length;
  const atLimit = active != null && active >= me.plan.maxKeys;
  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '0 0 12px' }}>API keys</h2>
        <form className="row" onSubmit={handleSubmit(({ name }) => { if (!create.isPending) create.mutate(name); })}>
          <input className="input" placeholder="Key name, e.g. iOS app" maxLength={100} aria-label="New key name" style={{ width: 220 }} {...register('name')} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={create.isPending || atLimit} aria-describedby={atLimit ? 'key-limit' : undefined}>
            Create key
          </button>
        </form>
      </div>
      {atLimit ? (
        <p className="small" id="key-limit" style={{ margin: '8px 0 0' }}>
          Your {me.plan.name} plan allows {me.plan.maxKeys} active {me.plan.maxKeys === 1 ? 'key' : 'keys'}. Revoke one or upgrade your plan to create another.
        </p>
      ) : null}
      <p className="small muted" style={{ margin: '8px 0 12px' }}>
        {active != null && `${active} of ${me.plan.maxKeys} active keys on the ${me.plan.name} plan. Keys share the account's monthly allowance.`}
      </p>
      {keys.isPending ? (
        <div className="skeleton-rows" aria-busy="true"><span className="sr-only">Loading keys…</span><i /><i /></div>
      ) : keys.isError ? (
        <ErrorRetry error={keys.error} onRetry={() => keys.refetch()} />
      ) : !list?.length ? (
        <p className="muted" style={{ margin: 0 }}>No keys yet. Name one above and choose Create key to start calling the API.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Name</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col">Tokens this month</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((k) => (
                <tr key={k.id}>
                  <td>{k.name} <span className="muted small">{k.id}</span></td>
                  <td>{fmtDate(k.createdAt)}</td>
                  <td>{k.lastUsedAt ? fmtDate(k.lastUsedAt) : <span className="muted">never</span>}</td>
                  <td>{fmt(k.usedThisMonth)}</td>
                  <td>
                    {k.revokedAt
                      ? <span className="badge">revoked</span>
                      : (
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          aria-label={`Revoke ${k.name}`}
                          disabled={pendingIds.has(k.id)}
                          onClick={() => onRevoke(k.id, k.name)}
                        >
                          Revoke
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- page

function DashboardLoading() {
  return (
    <main className="wrap dash" aria-busy="true">
      <p className="muted" role="status">Loading your dashboard…</p>
      <div className="dash-grid">
        <div className="card skeleton-card" />
        <div className="card skeleton-card" />
      </div>
    </main>
  );
}

// Unverified address: the API keeps working; this asks once per visit and can send the link again.
function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'sent' } | { kind: 'error'; text: string }>({ kind: 'idle' });
  const send = async () => {
    setState({ kind: 'sending' });
    try {
      await api.sendVerification();
      setState({ kind: 'sent' });
    } catch (err) {
      setState({ kind: 'error', text: err instanceof ApiError && err.code === 'too_many_emails' ? `A link was sent recently. Check your inbox, or try again ${waitText(err.retryAfter)}.` : errorText(err) });
    }
  };
  return (
    <div className="notice" role="status">
      <b>Confirm your email.</b> We sent a link to <b>{email}</b> so you can recover your account if you forget your password.{' '}
      {state.kind === 'sent' ? <span>A new link is on its way.</span>
        : <button type="button" className="btn btn-ghost btn-sm" onClick={send} disabled={state.kind === 'sending'}>Send a new link</button>}
      {state.kind === 'error' ? <span role="alert"> {state.text}</span> : null}
    </div>
  );
}

export function Dashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // A new key stays on screen (and in sessionStorage) until dismissed, so a refresh doesn't lose it.
  const [reveal, setRevealState] = useState<Reveal | null>(storedReveal);
  const [upgradeStatus, setUpgradeStatus] = useState('');
  const leaving = useRef(false);
  const setReveal = (r: Reveal | null) => {
    try {
      if (r) sessionStorage.setItem(NEW_KEY, JSON.stringify(r));
      else sessionStorage.removeItem(NEW_KEY);
    } catch { /* storage unavailable: the key still shows until this page is left */ }
    setRevealState(r);
  };

  // An account cached from login or another page may predate recent calls: refresh it so the headline matches the chart.
  useEffect(() => {
    if (queryClient.getQueryData(['me'])) queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  // Signed out: log in first, then come back here.
  useEffect(() => {
    if (me.data === null && !leaving.current) navigate('/login?next=/dashboard', { replace: true });
  }, [me.data, navigate]);

  const account = me.data;

  const logout = async () => {
    leaving.current = true;
    await api.logout().catch(() => {});
    try {
      sessionStorage.removeItem(PLAYGROUND_KEY_STORE);
      sessionStorage.removeItem(NEW_KEY);
    } catch { /* nothing stored */ }
    navigate('/');
    queryClient.setQueryData(['me'], null);
    queryClient.removeQueries({ queryKey: ['keys'] });
    queryClient.removeQueries({ queryKey: ['usage'] });
  };

  if (!account) {
    if (me.error) {
      return (
        <main className="wrap dash">
          <ErrorRetry error={me.error} onRetry={() => me.refetch()} />
        </main>
      );
    }
    return <DashboardLoading />;
  }

  return (
    <main className="wrap dash">
      <div className="dash-head">
        <div>
          <span className="kicker">Dashboard</span>
          <h1>Hi, <span>{account.account.name}</span></h1>
          <p className="muted" style={{ margin: 0 }}><span>{account.account.email}</span> · <span className="badge ok">{account.plan.name} plan</span></p>
        </div>
        <div className="row">
          <Link className="btn btn-ghost btn-sm" to="/docs">Docs</Link>
          <Link className="btn btn-ghost btn-sm" to="/playground">Playground</Link>
          <button className="btn btn-ghost btn-sm" type="button" onClick={logout}>Log out</button>
        </div>
      </div>

      {account.account.emailVerified === false ? <VerifyBanner email={account.account.email} /> : null}

      {reveal ? <KeyReveal reveal={reveal} onDismiss={() => setReveal(null)} /> : null}

      <div className="dash-grid">
        <UsageCard me={account} />
        <PlanCard me={account} status={upgradeStatus} setStatus={setUpgradeStatus} />
      </div>

      <KeysCard me={account} onCreated={setReveal} />

      <section className="card">
        <h2 style={{ margin: '0 0 12px' }}>Make your first request</h2>
        <CodeBlock>
          <code>{`export NUTRIKIT_KEY=${reveal?.key ?? 'nk_your_key'}
curl "${window.location.origin}/v1/log/text" \\
  -H "Authorization: Bearer $NUTRIKIT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "a bowl of oatmeal with blueberries and a coffee"}'`}</code>
        </CodeBlock>
        <p className="small muted" style={{ margin: 0 }}>
          Next: <Link to="/docs#access-tokens">use access tokens in apps</Link> · <Link to="/docs/reference">API reference</Link> · <a href="https://www.npmjs.com/package/@nutrikit/sdk" target="_blank" rel="noopener">install the SDK</a> (<code>npm i @nutrikit/sdk</code>)
        </p>
      </section>
    </main>
  );
}
