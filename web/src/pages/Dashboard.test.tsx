import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderPage } from '../test-utils.tsx';
import { ToastProvider } from '../components/Toast.tsx';
import { Dashboard } from './Dashboard.tsx';
import type { KeySummary, Me } from '../api/client.ts';

// These tests cover the paid-plan screens, which features.ts can hide; they run with payments shown.
vi.mock('../features.ts', () => ({ PAYMENTS_VISIBLE: true }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me: Me = {
  account: { id: 'acc_1', name: 'Ada Labs', email: 'ada@example.com', createdAt: '2026-10-01T00:00:00Z' },
  plan: { id: 'free', name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, rank: 0, expiresAt: null },
  usage: { periodStart: '2026-10-01T00:00:00Z', used: 1700, remaining: 300 },
  plans: {
    free: { name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, rank: 0 },
    starter: { name: 'Starter', monthlyTokens: 100000, ratePerMinute: 120, price: 1499, currency: 'INR', maxKeys: 5, rank: 1 },
    growth: { name: 'Growth', monthlyTokens: 1000000, ratePerMinute: 600, price: 4999, currency: 'INR', maxKeys: 10, rank: 2 },
    enterprise: { name: 'Enterprise', monthlyTokens: null, ratePerMinute: 3000, price: null, currency: 'INR', maxKeys: 50, rank: 3 },
  },
  billing: { enabled: false, mode: null, currency: 'INR', keyId: null },
};

const usage = {
  series: [
    { day: '2026-10-29', tokens: 0, calls: 0 },
    { day: '2026-10-30', tokens: 40, calls: 2 },
  ],
  month: { periodStart: '2026-10-01T00:00:00Z', tokenLimit: 2000, used: 1700, remaining: 300, byEndpoint: [{ endpoint: '/v1/log/text', calls: 2, tokens: 40 }] },
};

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function app(path = '/dashboard') {
  return renderPage(
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path },
  );
}

const defaultKey: KeySummary = { id: 'key_a', name: 'Default', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: null, revokedAt: null, usedThisMonth: 40 };

type Override = (path: string, method: string) => Response | Promise<Response> | undefined;

/** A small in-memory portal: /me, /keys (list, create, revoke), /usage. `override` answers a request first when it returns a response. */
function stubPortal({ signedIn = true, maxKeys = 2, account = me, initialKeys = [defaultKey], override }: {
  signedIn?: boolean; maxKeys?: number; account?: Me; initialKeys?: KeySummary[]; override?: Override;
} = {}) {
  let keys: KeySummary[] = initialKeys;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/portal/api', '');
    const method = init?.method ?? 'GET';
    const answer = override?.(path, method);
    if (answer) return answer;
    if (!signedIn) return json(401, { error: { code: 'unauthorized', message: 'not signed in' } });
    if (path === '/me') return json(200, account);
    if (path === '/logout' && method === 'POST') return json(200, { ok: true });
    if (path === '/upgrade' && method === 'POST') return json(200, { requested: 'enterprise' });
    if (path === '/billing/order' && method === 'POST') {
      return json(201, { orderId: 'order_test_1', keyId: 'rzp_test_key', plan: 'starter', amount: 149900, currency: 'INR' });
    }
    if (path === '/billing/verify' && method === 'POST') return json(200, { ...account, plan: { id: 'starter', ...account.plans.starter!, expiresAt: '2026-11-29T00:00:00Z' } });
    if (path.startsWith('/usage')) return json(200, usage);
    if (path === '/keys' && method === 'GET') return json(200, { keys });
    if (path === '/keys' && method === 'POST') {
      if (keys.filter((k) => !k.revokedAt).length >= maxKeys) {
        return json(403, { error: { code: 'key_limit', message: `your Free plan allows ${maxKeys} active keys; revoke one first` } });
      }
      const { name } = JSON.parse(String(init?.body)) as { name: string };
      keys = [...keys, { id: 'key_b', name, createdAt: '2026-10-30T00:00:00Z', lastUsedAt: null, revokedAt: null, usedThisMonth: 0 }];
      return json(201, { id: 'key_b', name, key: 'nk_live_brand_new_secret' });
    }
    const regen = /^\/keys\/(.+)\/regenerate$/.exec(path);
    if (regen && method === 'POST') {
      const old = keys.find((k) => k.id === regen[1])!;
      keys = [{ ...old, id: 'key_r', createdAt: '2026-10-30T00:00:00Z', lastUsedAt: null, usedThisMonth: 0 }, ...keys.map((k) => (k.id === regen[1] ? { ...k, revokedAt: '2026-10-30T00:00:00Z' } : k))];
      return json(201, { id: 'key_r', name: old.name, key: 'nk_live_regenerated_key', replaced: regen[1] });
    }
    const revoke = /^\/keys\/(.+)$/.exec(path);
    if (revoke && method === 'DELETE') {
      keys = keys.map((k) => (k.id === revoke[1] ? { ...k, revokedAt: '2026-10-30T00:00:00Z' } : k));
      return json(200, { revoked: revoke[1] });
    }
    return json(404, { error: { code: 'not_found', message: 'not found' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubPortal>, path: string, method = 'GET') =>
  fetchMock.mock.calls.filter(([u, i]) => String(u) === `/portal/api${path}` && (i?.method ?? 'GET') === method).length;

const razorpayPays = () => vi.stubGlobal('Razorpay', class {
  constructor(private options: Record<string, unknown> & { handler: (r: unknown) => void }) {}
  on() {}
  open() { this.options.handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_test_1', razorpay_signature: 'sig' }); }
});

const billed: Me = { ...me, billing: { enabled: true, mode: 'test', currency: 'INR', keyId: 'rzp_test_key' } };

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true });
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('Dashboard', () => {
  it('redirects to login when signed out', async () => {
    stubPortal({ signedIn: false });
    app();
    expect((await screen.findByTestId('where')).textContent).toBe('/login?next=/dashboard');
  });

  it('shows the account, plan, usage and keys', async () => {
    stubPortal();
    app();
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Ada Labs' })).toBeTruthy();
    expect(screen.getByText('Free plan')).toBeTruthy();
    expect(screen.getByText('Free — ₹0')).toBeTruthy();
    expect(screen.getByText('of 2,000 tokens · 300 left')).toBeTruthy();
    expect(document.querySelector('.meter')?.classList.contains('high')).toBe(true);
    expect(await screen.findByText('Default')).toBeTruthy();
    expect(screen.getByText('1 of 2 active keys on the Free plan. Keys share the account\'s monthly allowance.')).toBeTruthy();
    expect(await screen.findByText('/v1/log/text')).toBeTruthy();
    expect(screen.getByText(/Last 30 days \(2026-10-29 → 2026-10-30\) · 40 tokens · busiest day 40/)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Starter — 100k tokens' })).toBeTruthy();
  });

  it('asks an unverified account to confirm its email and can send a new link', async () => {
    const unverified: Me = { ...me, account: { ...me.account, emailVerified: false } };
    let sends = 0;
    const fetchMock = stubPortal({
      account: unverified,
      override: (path, method) => (path === '/email/verification' && method === 'POST'
        ? (++sends === 1 ? json(200, { sent: true }) : json(429, { error: { code: 'too_many_emails', message: 'slow down' }, retryAfter: 600 }))
        : undefined),
    });
    app();
    expect(await screen.findByText('Confirm your email.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText('A new link is on its way.')).toBeTruthy();
    expect(calls(fetchMock, '/email/verification', 'POST')).toBe(1);
  });

  it('shows no email banner for a verified account', async () => {
    stubPortal({ account: { ...me, account: { ...me.account, emailVerified: true } } });
    app();
    await screen.findByRole('heading', { level: 1, name: 'Hi, Ada Labs' });
    expect(screen.queryByText('Confirm your email.')).toBeNull();
  });

  // ---------------------------------------------------------------- 5.1 new-key safety

  const MASKED_FIRST = 'nk_live' + '•'.repeat(12) + 'irst';
  const MASKED_NEW = 'nk_live' + '•'.repeat(12) + 'cret';


  it('keeps the signup key on screen across a refresh until it is dismissed', async () => {
    sessionStorage.setItem('nutrikit-new-key', JSON.stringify({ id: 'key_a', name: 'Default', key: 'nk_live_first' }));
    stubPortal();
    const first = app();
    expect(await screen.findByRole('heading', { name: 'Welcome! Here is your first API key' })).toBeTruthy();
    // Masked until asked for: recognisable, not usable.
    expect(screen.getByDisplayValue(MASKED_FIRST)).toBeTruthy();
    expect(screen.queryByDisplayValue('nk_live_first')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));
    expect(screen.getByDisplayValue('nk_live_first')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(screen.getByDisplayValue(MASKED_FIRST)).toBeTruthy();
    first.unmount();

    app(); // a refresh in the same tab
    expect(await screen.findByDisplayValue(MASKED_FIRST)).toBeTruthy();
    expect(sessionStorage.getItem('nutrikit-new-key')).not.toBeNull();
    vi.stubGlobal('confirm', vi.fn(() => true));
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(screen.queryByDisplayValue(MASKED_FIRST)).toBeNull();
    expect(sessionStorage.getItem('nutrikit-new-key')).toBeNull();
  });

  it('asks before dismissing a key that was never copied, and keeps it on cancel', async () => {
    sessionStorage.setItem('nutrikit-new-key', JSON.stringify({ key: 'nk_live_first' }));
    stubPortal();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    app();
    fireEvent.click(await screen.findByRole('button', { name: "I've saved it" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue(MASKED_FIRST)).toBeTruthy();
    expect(sessionStorage.getItem('nutrikit-new-key')).not.toBeNull();
  });

  it('dismisses a copied key without asking', async () => {
    sessionStorage.setItem('nutrikit-new-key', JSON.stringify({ key: 'nk_live_first' }));
    stubPortal();
    stubClipboard(async () => {});
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy key' }));
    await screen.findByRole('button', { name: 'Copied' });
    // Copy works without unmasking: the clipboard gets the real key.
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('nk_live_first');
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue(MASKED_FIRST)).toBeNull();
  });

  it('selects the key and says to copy it manually when the clipboard is blocked', async () => {
    sessionStorage.setItem('nutrikit-new-key', JSON.stringify({ key: 'nk_live_first' }));
    stubPortal();
    stubClipboard(async () => { throw new Error('denied'); });
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy key' }));
    expect(await screen.findByText(/copy it manually/)).toBeTruthy();
    const input = screen.getByDisplayValue('nk_live_first') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'nk_live_first'.length]);
  });

  it('creates a key, moves focus to the reveal, announces it without reading the key, and uses it in the snippet', async () => {
    const fetchMock = stubPortal();
    app();
    await screen.findByText('Default');
    expect(screen.getByText(/export NUTRIKIT_KEY=nk_your_key/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New key name'), { target: { value: 'iOS app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));

    const heading = await screen.findByRole('heading', { name: 'New key “iOS app” created' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.closest('[role="status"]')).toBeNull();
    expect(screen.getByDisplayValue(MASKED_NEW).closest('[role="status"]')).toBeNull();
    expect(screen.queryByDisplayValue('nk_live_brand_new_secret')).toBeNull();
    expect(await screen.findByText('New key created')).toBeTruthy();
    expect(within(screen.getByText('New key created').closest('[role="status"]') as HTMLElement).queryByText(/nk_live/)).toBeNull();
    expect(sessionStorage.getItem('nutrikit-new-key')).toContain('nk_live_brand_new_secret');
    // The snippet masks the key too, but its Copy button copies the real one.
    expect(screen.getByText((t) => t.includes(`export NUTRIKIT_KEY=${MASKED_NEW}`))).toBeTruthy();
    expect(screen.queryByText(/nk_live_brand_new_secret/)).toBeNull();
    stubClipboard(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('export NUTRIKIT_KEY=nk_live_brand_new_secret')));

    expect(await screen.findByText('iOS app')).toBeTruthy();
    expect((screen.getByLabelText('New key name') as HTMLInputElement).value).toBe('');
    const post = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/portal/api/keys') && i?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'iOS app' });
    // The secret appears only in the reveal box (and the snippet), never in the keys table.
    expect(within(screen.getByText('iOS app').closest('table') as HTMLElement).queryByText(/nk_live/)).toBeNull();

    vi.stubGlobal('confirm', vi.fn(() => true));
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(screen.queryByDisplayValue(MASKED_NEW)).toBeNull();
    expect(screen.getByText(/export NUTRIKIT_KEY=nk_your_key/)).toBeTruthy();
  });

  // ---------------------------------------------------------------- 5.2 loading, error and empty states

  it('shows a loading indicator while the account loads', async () => {
    stubPortal({ override: (path) => (path === '/me' ? new Promise<Response>(() => {}) : undefined) });
    app();
    expect(screen.getByText('Loading your dashboard…')).toBeTruthy();
  });

  it('shows an account error as a sentence with Retry', async () => {
    let failed = false;
    const fetchMock = stubPortal({
      override: (path) => {
        if (path !== '/me' || failed) return undefined;
        failed = true;
        return json(500, { error: { code: 'internal', message: 'database is busy' } });
      },
    });
    app();
    expect(await screen.findByText('Database is busy.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Ada Labs' })).toBeTruthy();
    expect(calls(fetchMock, '/me')).toBe(2);
  });

  it('shows a keys error with Retry instead of an empty table', async () => {
    let failed = false;
    stubPortal({
      override: (path, method) => {
        if (path !== '/keys' || method !== 'GET' || failed) return undefined;
        failed = true;
        return json(500, { error: { code: 'internal', message: 'could not load keys' } });
      },
    });
    app();
    expect(await screen.findByText('Could not load keys.')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Last used' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Default')).toBeTruthy();
  });

  it('says so when there are no keys yet', async () => {
    stubPortal({ initialKeys: [] });
    app();
    expect(await screen.findByText(/No keys yet/)).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Last used' })).toBeNull();
  });

  it('disables Create key at the plan limit and explains why', async () => {
    stubPortal({ initialKeys: [defaultKey, { ...defaultKey, id: 'key_b', name: 'Second' }] });
    app();
    await screen.findByText('Second');
    expect((screen.getByRole('button', { name: 'Create key' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Your Free plan allows 2 active keys. Revoke one or upgrade your plan to create another.')).toBeTruthy();
  });

  it('reports the plan key limit from the server as a sentence', async () => {
    stubPortal({ maxKeys: 1 });
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('Your Free plan allows 1 active keys; revoke one first.')).toBeTruthy();
  });

  // ---------------------------------------------------------------- 5.3 pending-safe actions, a11y, freshness

  it('revokes a key after confirmation with DELETE /portal/api/keys/:id', async () => {
    const fetchMock = stubPortal();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Default' }));
    expect(confirm).toHaveBeenCalledWith('Revoke “Default”? Apps using it (and its access tokens) stop working immediately.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/portal/api/keys/key_a', expect.objectContaining({ method: 'DELETE' })));
    expect(await screen.findByText('revoked')).toBeTruthy();
    expect(await screen.findByText('Key revoked')).toBeTruthy();
  });

  it('a double-clicked Revoke sends one request and shows one message', async () => {
    const fetchMock = stubPortal();
    vi.stubGlobal('confirm', vi.fn(() => true));
    app();
    await screen.findByText('Default');
    const button = screen.getByRole('button', { name: 'Revoke Default' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText('revoked')).toBeTruthy();
    await screen.findByText('Key revoked');
    expect(calls(fetchMock, '/keys/key_a', 'DELETE')).toBe(1);
    expect(screen.getAllByText('Key revoked')).toHaveLength(1);
  });

  it('regenerates a key after confirmation and reveals the new one masked', async () => {
    const fetchMock = stubPortal();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Default' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('stops working immediately'));
    expect(await screen.findByRole('heading', { name: 'New key for “Default”' })).toBeTruthy();
    expect(screen.getByDisplayValue('nk_live' + '•'.repeat(12) + '_key')).toBeTruthy();
    expect(calls(fetchMock, `/keys/${defaultKey.id}/regenerate`, 'POST')).toBe(1);
    expect(await screen.findByText('Key regenerated. The old one no longer works')).toBeTruthy();
  });

  it('does not regenerate when the confirmation is declined', async () => {
    const fetchMock = stubPortal();
    vi.stubGlobal('confirm', vi.fn(() => false));
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate Default' }));
    expect(calls(fetchMock, `/keys/${defaultKey.id}/regenerate`, 'POST')).toBe(0);
  });

  it('does not revoke when the confirmation is declined', async () => {
    const fetchMock = stubPortal();
    vi.stubGlobal('confirm', vi.fn(() => false));
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Default' }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
  });

  it('tables have column headers and the usage chart has a text alternative', async () => {
    stubPortal();
    app();
    await screen.findByText('Default');
    await screen.findByText('/v1/log/text');
    for (const name of ['Name', 'Created', 'Last used', 'Tokens this month', 'Endpoint', 'Calls']) {
      const header = screen.getByRole('columnheader', { name });
      expect(header.getAttribute('scope')).toBe('col');
      expect(header.closest('thead')).not.toBeNull();
    }
    const chart = screen.getByRole('table', { name: 'Tokens used per day, last 30 days' });
    const rows = within(chart).getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['DayTokens', 'Oct 290', 'Oct 3040']);
  });

  it('refreshes a cached account on open so the headline matches the chart', async () => {
    stubPortal();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['me'], { ...me, usage: { ...me.usage, used: 10, remaining: 1990 } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/dashboard']}><Dashboard /></MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('of 2,000 tokens · 300 left')).toBeTruthy();
    expect(screen.getByText('1,700')).toBeTruthy();
  });

  it('logging out clears the playground key saved in the tab', async () => {
    sessionStorage.setItem('nk-playground-key', 'nk_live_pasted');
    stubPortal();
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(sessionStorage.getItem('nk-playground-key')).toBeNull();
  });

  it('an upgrade request is replaced by "Request sent" for that plan', async () => {
    const fetchMock = stubPortal();
    app();
    fireEvent.change(await screen.findByLabelText('Need more?'), { target: { value: 'enterprise' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request upgrade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Request upgrade' }));
    expect(await screen.findByText('Request sent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request upgrade' })).toBeNull();
    expect(calls(fetchMock, '/upgrade', 'POST')).toBe(1);
    const sent = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/upgrade'));
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ plan: 'enterprise' });
  });

  it('without online billing a paid plan is an upgrade request', async () => {
    const fetchMock = stubPortal();
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Request upgrade' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/upgrade'))).toBe(true));
  });

  // ---------------------------------------------------------------- 2.3 billing: rank and failed confirmation

  it('pays for 30 days of Starter through Razorpay Checkout and activates it after verification', async () => {
    const fetchMock = stubPortal({ account: billed });
    const opened: Record<string, unknown>[] = [];
    vi.stubGlobal('Razorpay', class {
      constructor(private options: Record<string, unknown> & { handler: (r: unknown) => void }) { opened.push(options); }
      on() {}
      open() { this.options.handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_test_1', razorpay_signature: 'sig' }); }
    });
    app();
    const pay = await screen.findByRole('button', { name: 'Pay — ₹1,499' });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(await screen.findByText(/You're on the Starter plan until Nov 29, 2026/)).toBeTruthy();
    expect(calls(fetchMock, '/billing/order', 'POST')).toBe(1);
    expect(opened[0]).toMatchObject({ key: 'rzp_test_key', order_id: 'order_test_1', amount: 149900, currency: 'INR', name: 'Nutrikit', prefill: { name: 'Ada Labs', email: 'ada@example.com' } });
    const verify = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/billing/verify'));
    expect(JSON.parse(String(verify?.[1]?.body))).toEqual({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_test_1', razorpay_signature: 'sig' });
    expect(await screen.findByText(/Paid until/)).toBeTruthy();
  });

  it('a failed confirmation shows the payment id and reloads the account after 5 s and 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubPortal({
      account: billed,
      override: (path) => (path === '/billing/verify' ? json(502, { error: { code: 'upstream', message: 'razorpay unavailable' } }) : undefined),
    });
    razorpayPays();
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Pay — ₹1,499' }));
    const notice = await screen.findByText(/We couldn't confirm the payment yet\. If you were charged, your plan will switch on within a few minutes\./);
    expect(within(notice).getByText('pay_1')).toBeTruthy();
    expect(screen.queryByText('Payment received — activating your plan…')).toBeNull();

    const before = calls(fetchMock, '/me');
    await vi.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(calls(fetchMock, '/me')).toBe(before + 1));
    await vi.advanceTimersByTimeAsync(25_000);
    await waitFor(() => expect(calls(fetchMock, '/me')).toBe(before + 2));
    expect(screen.getByText(/We couldn't confirm the payment yet/)).toBeTruthy();
  });

  it('closing Razorpay Checkout charges nothing', async () => {
    const fetchMock = stubPortal({ account: billed });
    vi.stubGlobal('Razorpay', class {
      constructor(private options: { modal: { ondismiss: () => void } }) {}
      on() {}
      open() { this.options.modal.ondismiss(); }
    });
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Pay — ₹1,499' }));
    expect(await screen.findByText('Payment cancelled — you have not been charged.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/billing/verify'))).toBe(false);
  });

  it('a paid period shows its end date and can be extended', async () => {
    const paid: Me = { ...billed, plan: { id: 'starter', ...me.plans.starter!, expiresAt: '2026-11-20T00:00:00Z' } };
    stubPortal({ account: paid });
    app();
    expect(await screen.findByText('Starter — ₹1,499 / 30 days')).toBeTruthy();
    expect(screen.getByText(/Paid until Nov 20, 2026/)).toBeTruthy();
    const select = screen.getByLabelText('Extend or move up') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'starter' } });
    expect(await screen.findByRole('button', { name: 'Extend 30 days — ₹1,499' })).toBeTruthy();
  });

  it('an operator-set plan with no end date never offers a cheaper plan', async () => {
    const operatorSet: Me = { ...billed, plan: { id: 'growth', ...me.plans.growth!, expiresAt: null } };
    stubPortal({ account: operatorSet });
    app();
    const starter = (await screen.findByRole('option', { name: 'Starter — 100k tokens' })) as HTMLOptionElement;
    expect(starter.disabled).toBe(true);
    expect((screen.getByRole('option', { name: 'Growth — 1M tokens' }) as HTMLOptionElement).disabled).toBe(false);
    expect((screen.getByRole('option', { name: 'Enterprise — custom' }) as HTMLOptionElement).disabled).toBe(false);
    expect((screen.getByLabelText('Need more?') as HTMLSelectElement).value).toBe('enterprise');
  });

  it('deletes the account only with the right password, then signs out and goes home', async () => {
    sessionStorage.setItem('nk-playground-key', 'nk_saved');
    const fetchMock = stubPortal({
      override: (path, method) => {
        if (path !== '/account/delete' || method !== 'POST') return undefined;
        const { password } = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)) as { password: string };
        return password === 'correct horse battery'
          ? json(200, { deleted: true })
          : json(400, { error: { code: 'invalid_password', message: 'check the highlighted fields', fields: { password: 'Password is incorrect' } } });
      },
    });
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account…' }));
    const submit = screen.getByRole('button', { name: 'Delete my account permanently' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Enter your password to confirm'), { target: { value: 'wrong password' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Password is incorrect')).toBeTruthy();
    expect(screen.getByLabelText('Enter your password to confirm').getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(screen.getByLabelText('Enter your password to confirm'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account permanently' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/');
    expect(await screen.findByText('Your account was deleted')).toBeTruthy();
    expect(calls(fetchMock, '/account/delete', 'POST')).toBe(2);
    expect(sessionStorage.getItem('nk-playground-key')).toBeNull();
  });

  it('warns that deleting ends a paid plan that is still running', async () => {
    stubPortal({ account: { ...me, plan: { id: 'starter', ...me.plans.starter!, expiresAt: '2099-01-01T00:00:00Z' } } });
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account…' }));
    expect(screen.getByText(/Deleting the account ends it with no refund/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete my account…' })).toBeTruthy();
  });
});
