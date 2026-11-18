// Developer dashboard: the team in use (switcher, members), plan and usage, live and test API keys, upgrades.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, NEW_KEY_STORE } from '../api/client.ts';
import { forgetAccount, useMe } from '../hooks.ts';
import { tabStore } from '../storage.ts';
import { useToast } from '../components/Toast.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { ErrorRetry } from '../components/ErrorRetry.tsx';
import { MembersCard, ROLE_NAMES, TeamSwitcher } from './dashboard/Team.tsx';
import { KeyReveal, maskKey, type Reveal } from './dashboard/KeyReveal.tsx';
import { UsageCard } from './dashboard/UsageCard.tsx';
import { PlanCard } from './dashboard/PlanCard.tsx';
import { KeysCard } from './dashboard/KeysCard.tsx';
import { DeleteAccountCard } from './dashboard/DeleteAccountCard.tsx';
import { VerifyBanner } from './dashboard/VerifyBanner.tsx';
import '../styles/dashboard.css';

const WELCOME = 'Welcome! Here is your first API key';

function storedReveal(): Reveal | null {
  try {
    const parsed = JSON.parse(tabStore.get(NEW_KEY_STORE) ?? 'null') as { key?: unknown; title?: unknown; teamId?: unknown } | null;
    if (parsed && typeof parsed.key === 'string') {
      return { key: parsed.key, title: typeof parsed.title === 'string' ? parsed.title : WELCOME, teamId: typeof parsed.teamId === 'string' ? parsed.teamId : undefined };
    }
  } catch { /* ignore a malformed entry */ }
  return null;
}

/** The quick-start request, using `key`. */
const snippet = (key: string) => `export NUTRIKIT_KEY=${key}
curl "${window.location.origin}/v1/log/text" \\
  -H "Authorization: Bearer $NUTRIKIT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "a bowl of oatmeal with blueberries and a coffee"}'`;

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

export function Dashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  // A new key stays on screen (and in sessionStorage) until dismissed, so a refresh doesn't lose it.
  const [reveal, setRevealState] = useState<Reveal | null>(storedReveal);
  const leaving = useRef(false);
  const setReveal = (r: Reveal | null) => {
    // With storage blocked the key still shows until this page is left.
    tabStore.set(NEW_KEY_STORE, r ? JSON.stringify(r) : null);
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

  // Forgets everything this browser holds for the account (after logging out or deleting it) and goes home.
  const leave = (notice?: string) => {
    navigate('/');
    forgetAccount(queryClient);
    if (notice) toast(notice);
  };

  const logout = async () => {
    leaving.current = true;
    await api.logout().catch(() => {});
    leave();
  };

  const onDeleted = () => {
    leaving.current = true;
    leave('Your account was deleted');
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

  // A key made in another team stays saved for when that team is in use again, but isn't shown here.
  const shown = reveal && (!reveal.teamId || reveal.teamId === account.team.id) ? reveal : null;

  return (
    <main className="wrap dash">
      <div className="dash-head">
        <div>
          <span className="kicker">Dashboard</span>
          <h1>Hi, <span>{account.user.name}</span></h1>
          <p className="muted" style={{ margin: 0 }}>
            <span>{account.user.email}</span> · <span className="badge ok">{account.plan.name} plan</span> · <span className="badge">{ROLE_NAMES[account.team.role]}</span>
          </p>
          <TeamSwitcher me={account} />
        </div>
        <div className="row">
          <Link className="btn btn-ghost btn-sm" to="/docs">Docs</Link>
          <Link className="btn btn-ghost btn-sm" to="/playground">Playground</Link>
          <button className="btn btn-ghost btn-sm" type="button" onClick={logout}>Log out</button>
        </div>
      </div>

      {account.user.emailVerified === false ? <VerifyBanner email={account.user.email} /> : null}

      {shown ? <KeyReveal reveal={shown} onDismiss={() => setReveal(null)} /> : null}

      <div className="dash-grid">
        <UsageCard me={account} />
        <PlanCard key={`plan:${account.team.id}`} me={account} />
      </div>

      {/* Keyed by team: switching teams starts the forms afresh (the key type defaults by role). */}
      <KeysCard key={`keys:${account.team.id}`} me={account} onCreated={setReveal} />

      <MembersCard key={`members:${account.team.id}`} me={account} />

      <section className="card">
        <h2 style={{ margin: '0 0 12px' }}>Make your first request</h2>
        {/* The snippet shows the new key masked like the reveal box; its Copy button copies the real key. */}
        <CodeBlock copyText={snippet(shown?.key ?? 'nk_your_key')}>
          <code>{snippet(shown ? maskKey(shown.key) : 'nk_your_key')}</code>
        </CodeBlock>
        <p className="small muted" style={{ margin: 0 }}>
          Next: <Link to="/docs#access-tokens">use access tokens in apps</Link> · <Link to="/docs/reference">API reference</Link> · <a href="https://www.npmjs.com/package/@nutrikit/sdk" target="_blank" rel="noopener">install the SDK</a> (<code>npm i @nutrikit/sdk</code>)
        </p>
      </section>

      <DeleteAccountCard me={account} onDeleted={onDeleted} />
    </main>
  );
}
