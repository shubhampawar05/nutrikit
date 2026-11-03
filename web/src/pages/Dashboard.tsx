// Developer dashboard: account, plan and usage, API keys, upgrades (the legacy portal.js dashboard half).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate, fmtPrice, type Me } from '../api/client.ts';
import { payWithRazorpay } from '../api/razorpay.ts';
import { useMe } from '../hooks.ts';
import { useToast } from '../components/Toast.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { UsageChart } from './dashboard/UsageChart.tsx';
import '../styles/dashboard.css';

const NEW_KEY = 'nutrikit-new-key';
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

interface Reveal { key: string; title: string }

// ---------------------------------------------------------------- one-time key reveal

function KeyReveal({ reveal, onDismiss }: { reveal: Reveal | null; onDismiss: () => void }) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) box.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [reveal]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal?.key ?? '');
      toast('Key copied');
    } catch {
      toast('Select the key and copy it manually');
    }
  };
  return (
    <div className="key-reveal" role="status" hidden={!reveal} ref={box}>
      <b>{reveal?.title ?? 'Your new API key'}</b>
      <code>{reveal?.key}</code>
      <div className="row">
        <button className="btn btn-primary btn-sm" type="button" onClick={copy}>Copy key</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onDismiss}>I've saved it</button>
      </div>
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
        <span className="small muted">Resets {fmtDate(reset.toISOString())}</span>
      </div>
      <p style={{ margin: '16px 0 0' }}>
        <span className="big-number">{fmt(used)}</span>{' '}
        <span className="muted">{limit == null ? 'tokens used' : `of ${fmt(limit)} tokens · ${fmt(me.usage.remaining)} left`}</span>
      </p>
      <div className={pct >= 80 ? 'meter high' : 'meter'}><span style={{ width: `${pct}%` }} /></div>
      <UsageChart series={usage.data?.series ?? []} />
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data">
          <tbody>
            <tr><th>Endpoint</th><th>Calls</th><th>Tokens</th></tr>
            {usage.data && (usage.data.month.byEndpoint.length
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
  // While a paid period runs, the same plan can be extended and a dearer one bought; a cheaper one waits.
  const selectable = (p: string) =>
    p === me.plan.id ? Boolean(paidUntil && payable(p)) : !(paidUntil && (price(p) ?? Infinity) < (me.plan.price ?? 0));
  const firstOpen = UPGRADE_OPTIONS.find(([v]) => v !== me.plan.id && selectable(v))?.[0]
    ?? UPGRADE_OPTIONS.find(([v]) => selectable(v))?.[0] ?? 'starter';
  const { register, handleSubmit, watch, resetField } = useForm<{ plan: string; message: string }>({
    defaultValues: { plan: firstOpen, message: '' },
  });
  const plan = watch('plan');
  const [busy, setBusy] = useState(false);
  const request = useMutation({ mutationFn: (v: { plan: string; message: string }) => api.requestUpgrade(v.plan, v.message) });

  const buy = async (p: string) => {
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
    }, (message) => setStatus(`${message}. You can try again in the Razorpay window.`));
    if (!response) {
      setStatus('Payment cancelled — you have not been charged.');
      return;
    }
    setStatus('Payment received — activating your plan…');
    const view = await api.verifyPayment(response);
    queryClient.setQueryData<Me>(['me'], (old) => (old ? { ...old, ...view } : old));
    setStatus(`You're on the ${view.plan.name} plan until ${fmtDate(view.plan.expiresAt)}.`);
  };

  const onSubmit = async (data: { plan: string; message: string }) => {
    setBusy(true);
    try {
      if (payable(data.plan)) {
        await buy(data.plan);
        return;
      }
      await request.mutateAsync(data);
      const label = UPGRADE_OPTIONS.find(([v]) => v === data.plan)?.[1] ?? data.plan;
      setStatus(`Thanks — we've received your request for the ${label.split(' —')[0]} plan and will be in touch at ${me.account.email}.`);
      resetField('message');
    } catch (err) {
      setStatus(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const current = me.plan.price;
  const action = (p: string) => (p === me.plan.id ? 'Extend 30 days' : 'Pay');
  return (
    <section className="card">
      <h2 style={{ margin: '0 0 12px' }}>Plan</h2>
      <p style={{ margin: 0 }}><b>{me.plan.name + (current ? ` — ${fmtPrice(current, me.plan.currency)} / 30 days` : current === 0 ? ` — ${fmtPrice(0, me.plan.currency)}` : '')}</b></p>
      {paidUntil ? <p className="small muted" style={{ margin: '4px 0 0' }}>Paid until {fmtDate(paidUntil)} · then the Free plan, unless you extend it.</p> : null}
      <ul className="muted small" style={{ paddingLeft: 18 }}>
        <li>{me.plan.monthlyTokens == null ? 'Custom monthly tokens' : `${fmt(me.plan.monthlyTokens)} tokens / month`}</li>
        <li>{fmt(me.plan.ratePerMinute)} requests / minute</li>
        <li>Up to {me.plan.maxKeys} API keys</li>
      </ul>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="field">
          <label htmlFor="upgrade-plan">{paidUntil ? 'Extend or move up' : 'Need more?'}</label>
          <select id="upgrade-plan" {...register('plan')}>
            {UPGRADE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value} disabled={!selectable(value)}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field" hidden={payable(plan)}>
          <label htmlFor="upgrade-msg">Tell us about your app (optional)</label>
          <textarea id="upgrade-msg" rows={2} maxLength={1000} {...register('message')} />
        </div>
        <button className="btn btn-ghost btn-sm" type="submit" disabled={busy}>
          {payable(plan) ? `${action(plan)} — ${fmtPrice(price(plan)!, me.plans[plan]?.currency)}` : 'Request upgrade'}
        </button>
        <p className="small muted" hidden={!payable(plan)} style={{ margin: '8px 0 0' }}>
          One-time payment for 30 days; no automatic renewal.
          {me.billing.mode === 'test' ? <> Test mode: use one of Razorpay's{' '}
            <a href="https://razorpay.com/docs/payments/payments/test-card-details/" target="_blank" rel="noreferrer">test cards or UPI ids</a>.</> : null}
        </p>
        <p className="small muted" style={{ margin: '8px 0 0' }}>{status}</p>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- API keys

function KeysCard({ me, onCreated }: { me: Me; onCreated: (r: Reveal) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['keys'], queryFn: api.keys });
  const { register, handleSubmit, reset } = useForm<{ name: string }>({ defaultValues: { name: '' } });

  const create = useMutation({
    mutationFn: (name: string) => api.createKey(name),
    onSuccess: (key) => {
      reset();
      onCreated({ key: key.key, title: `New key “${key.name}” created` });
    },
    // The plan's key limit is enforced by the server (403 key_limit); its message says what to do.
    onError: (err) => toast(errorMessage(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: () => toast('Key revoked'),
    onError: (err) => toast(errorMessage(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
  });

  const onRevoke = (id: string, name: string) => {
    if (!window.confirm(`Revoke “${name}”? Apps using it (and its access tokens) stop working immediately.`)) return;
    revoke.mutate(id);
  };

  const list = keys.data?.keys;
  const active = list?.filter((k) => !k.revokedAt).length;
  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '0 0 12px' }}>API keys</h2>
        <form className="row" onSubmit={handleSubmit(({ name }) => create.mutate(name))}>
          <input className="input" placeholder="Key name, e.g. iOS app" maxLength={100} aria-label="New key name" style={{ width: 220 }} {...register('name')} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={create.isPending}>Create key</button>
        </form>
      </div>
      <p className="small muted" style={{ margin: '8px 0 12px' }}>
        {active != null && `${active} of ${me.plan.maxKeys} active keys on the ${me.plan.name} plan. Keys share the account's monthly allowance.`}
      </p>
      <div className="table-scroll">
        <table className="data">
          <tbody>
            <tr><th>Name</th><th>Created</th><th>Last used</th><th>Tokens this month</th><th></th></tr>
            {list?.map((k) => (
              <tr key={k.id}>
                <td>{k.name} <span className="muted small">{k.id}</span></td>
                <td>{fmtDate(k.createdAt)}</td>
                <td>{k.lastUsedAt ? fmtDate(k.lastUsedAt) : <span className="muted">never</span>}</td>
                <td>{fmt(k.usedThisMonth)}</td>
                <td>
                  {k.revokedAt
                    ? <span className="badge">revoked</span>
                    : <button className="btn btn-danger btn-sm" type="button" onClick={() => onRevoke(k.id, k.name)}>Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- page

export function Dashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [upgradeStatus, setUpgradeStatus] = useState('');
  const leaving = useRef(false);
  const started = useRef(false);
  // Signed out: log in first, then come back here.
  useEffect(() => {
    if (me.data === null && !leaving.current) navigate('/login?next=/dashboard', { replace: true });
  }, [me.data, navigate]);

  // Once the account has loaded: show a fresh signup key once.
  const account = me.data;
  useEffect(() => {
    if (!account || started.current) return;
    started.current = true;

    const fresh = sessionStorage.getItem(NEW_KEY);
    if (fresh) {
      sessionStorage.removeItem(NEW_KEY);
      try {
        const parsed = JSON.parse(fresh) as { key?: unknown };
        if (typeof parsed.key === 'string') setReveal({ key: parsed.key, title: 'Welcome! Here is your first API key' });
      } catch { /* ignore a malformed entry */ }
    }
  }, [account]); // runs its body once, when the account first loads (guarded by `started`)

  const logout = async () => {
    leaving.current = true;
    await api.logout().catch(() => {});
    navigate('/');
    queryClient.setQueryData(['me'], null);
    queryClient.removeQueries({ queryKey: ['keys'] });
    queryClient.removeQueries({ queryKey: ['usage'] });
  };

  if (me.error) {
    return <p className="wrap form-error" style={{ marginTop: 24 }}>{errorMessage(me.error)}</p>;
  }
  if (!account) return null;

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

      <KeyReveal reveal={reveal} onDismiss={() => setReveal(null)} />

      <div className="dash-grid">
        <UsageCard me={account} />
        <PlanCard me={account} status={upgradeStatus} setStatus={setUpgradeStatus} />
      </div>

      <KeysCard me={account} onCreated={setReveal} />

      <section className="card">
        <h2 style={{ margin: '0 0 12px' }}>Make your first request</h2>
        <CodeBlock>
          <code>{`export NUTRIKIT_KEY=nk_your_key
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
