// Operator console: sign in with the admin token, then see accounts, payments and keys, revoke keys, change plans
// and review upgrade requests. Not linked from the site navigation; open /admin directly.
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ADMIN_UNAUTHORIZED, adminToken } from '../api/admin.ts';
import { TabList, tabIds } from '../components/Tabs.tsx';
import { SignIn } from './admin/SignIn.tsx';
import { OverviewTab } from './admin/OverviewTab.tsx';
import { HealthTab } from './admin/HealthTab.tsx';
import { PaymentsTab } from './admin/PaymentsTab.tsx';
import { AccountsTab } from './admin/AccountsTab.tsx';
import { KeysTab } from './admin/KeysTab.tsx';
import { RequestsTab } from './admin/RequestsTab.tsx';
import { MissingFoodsTab } from './admin/MissingFoodsTab.tsx';
import '../styles/admin.css';

const TABS = ['Overview', 'Health', 'Payments', 'Accounts', 'Keys', 'Requests', 'Missing foods'] as const;
type Tab = (typeof TABS)[number];

const TABS_PREFIX = 'admin';
const TOKEN_REFUSED = 'That admin token is no longer accepted.';

export function Admin() {
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(() => adminToken.get() !== null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [notice, setNotice] = useState('');

  const signOut = useCallback((why = '') => {
    adminToken.clear();
    queryClient.removeQueries({ queryKey: ['admin'] });
    setNotice(why);
    setSignedIn(false);
  }, [queryClient]);

  // The stored token was refused by any admin call (rotated on the server, say): back to sign-in.
  useEffect(() => {
    const onRefused = () => signOut(TOKEN_REFUSED);
    window.addEventListener(ADMIN_UNAUTHORIZED, onRefused);
    return () => window.removeEventListener(ADMIN_UNAUTHORIZED, onRefused);
  }, [signOut]);

  if (!signedIn) return <SignIn notice={notice} onSignedIn={() => { setNotice(''); setTab('Overview'); setSignedIn(true); }} />;

  const ids = tabIds(TABS_PREFIX, tab);

  return (
    <main className="wrap admin">
      <div className="admin-head">
        <h1>Operator console</h1>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => signOut()}>Sign out</button>
      </div>
      <TabList
        tabs={TABS.map((t) => ({ id: t, label: t }))}
        current={tab}
        onChange={(id) => setTab(id as Tab)}
        label="Admin sections"
        prefix={TABS_PREFIX}
        className="admin-tabs"
        tabClassName="pg-tab"
        onlySelectedPanel
      />
      <div id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} tabIndex={0}>
        {tab === 'Overview' && <OverviewTab />}
        {tab === 'Health' && <HealthTab />}
        {tab === 'Payments' && <PaymentsTab />}
        {tab === 'Accounts' && <AccountsTab />}
        {tab === 'Keys' && <KeysTab />}
        {tab === 'Requests' && <RequestsTab />}
        {tab === 'Missing foods' && <MissingFoodsTab />}
      </div>
    </main>
  );
}
