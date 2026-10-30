import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderPage } from '../test-utils.tsx';
import { Dashboard } from './Dashboard.tsx';
import type { KeySummary, Me } from '../api/client.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me: Me = {
  account: { id: 'acc_1', name: 'Ada Labs', email: 'ada@example.com', createdAt: '2026-10-01T00:00:00Z' },
  plan: { id: 'free', name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, expiresAt: null },
  usage: { periodStart: '2026-10-01T00:00:00Z', used: 1700, remaining: 300 },
  plans: {
    free: { name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2 },
    starter: { name: 'Starter', monthlyTokens: 100000, ratePerMinute: 120, price: 1499, currency: 'INR', maxKeys: 5 },
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

/** A small in-memory portal: /me, /keys (list, create, revoke), /usage. */
function stubPortal({ signedIn = true, maxKeys = 2, account = me }: { signedIn?: boolean; maxKeys?: number; account?: Me } = {}) {
  let keys: KeySummary[] = [
    { id: 'key_a', name: 'Default', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: null, revokedAt: null, usedThisMonth: 40 },
  ];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('/portal/api', '');
    const method = init?.method ?? 'GET';
    if (!signedIn) return json(401, { error: { code: 'unauthorized', message: 'not signed in' } });
    if (path === '/me') return json(200, account);
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

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

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

  it('reveals the signup key once, then forgets it', async () => {
    sessionStorage.setItem('nutrikit-new-key', JSON.stringify({ id: 'key_a', name: 'Default', key: 'nk_live_first' }));
    stubPortal();
    app();
    expect(await screen.findByText('Welcome! Here is your first API key')).toBeTruthy();
    expect(screen.getByText('nk_live_first')).toBeTruthy();
    expect(sessionStorage.getItem('nutrikit-new-key')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(screen.queryByText('nk_live_first')).toBeNull();
  });

  it('creates a key and reveals it once', async () => {
    const fetchMock = stubPortal();
    app();
    await screen.findByText('Default');
    fireEvent.change(screen.getByLabelText('New key name'), { target: { value: 'iOS app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByText('New key “iOS app” created')).toBeTruthy();
    expect(screen.getByText('nk_live_brand_new_secret')).toBeTruthy();
    expect(await screen.findByText('iOS app')).toBeTruthy();
    expect((screen.getByLabelText('New key name') as HTMLInputElement).value).toBe('');
    const post = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/portal/api/keys') && i?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ name: 'iOS app' });
    // The secret appears only in the reveal box, never in the keys table.
    expect(within(screen.getByText('iOS app').closest('table') as HTMLElement).queryByText(/nk_live/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(screen.queryByText('nk_live_brand_new_secret')).toBeNull();
  });

  it('reports the plan key limit from the server', async () => {
    stubPortal({ maxKeys: 1 });
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('your Free plan allows 1 active keys; revoke one first')).toBeTruthy();
  });

  it('revokes a key after confirmation with DELETE /portal/api/keys/:id', async () => {
    const fetchMock = stubPortal();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(confirm).toHaveBeenCalledWith('Revoke “Default”? Apps using it (and its access tokens) stop working immediately.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/portal/api/keys/key_a', expect.objectContaining({ method: 'DELETE' })));
    expect(await screen.findByText('revoked')).toBeTruthy();
    expect(await screen.findByText('Key revoked')).toBeTruthy();
  });

  it('does not revoke when the confirmation is declined', async () => {
    const fetchMock = stubPortal();
    vi.stubGlobal('confirm', vi.fn(() => false));
    app();
    await screen.findByText('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
  });

  it('pays for 30 days of Starter through Razorpay Checkout and activates it after verification', async () => {
    const billed: Me = { ...me, billing: { enabled: true, mode: 'test', currency: 'INR', keyId: 'rzp_test_key' } };
    const fetchMock = stubPortal({ account: billed });
    const opened: Record<string, unknown>[] = [];
    vi.stubGlobal('Razorpay', class {
      constructor(private options: Record<string, unknown> & { handler: (r: unknown) => void }) { opened.push(options); }
      on() {}
      open() { this.options.handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_test_1', razorpay_signature: 'sig' }); }
    });
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Pay — ₹1,499' }));
    expect(await screen.findByText(/You're on the Starter plan until/)).toBeTruthy();
    expect(opened[0]).toMatchObject({ key: 'rzp_test_key', order_id: 'order_test_1', amount: 149900, currency: 'INR', name: 'Nutrikit', prefill: { name: 'Ada Labs', email: 'ada@example.com' } });
    const verify = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/billing/verify'));
    expect(JSON.parse(String(verify?.[1]?.body))).toEqual({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_test_1', razorpay_signature: 'sig' });
    expect(await screen.findByText(/Paid until/)).toBeTruthy();
  });

  it('closing Razorpay Checkout charges nothing', async () => {
    const fetchMock = stubPortal({ account: { ...me, billing: { enabled: true, mode: 'test', currency: 'INR', keyId: 'rzp_test_key' } } });
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
    const paid: Me = { ...me, plan: { id: 'starter', ...me.plans.starter!, expiresAt: '2026-11-20T00:00:00Z' }, billing: { enabled: true, mode: 'test', currency: 'INR', keyId: 'rzp_test_key' } };
    stubPortal({ account: paid });
    app();
    expect(await screen.findByText('Starter — ₹1,499 / 30 days')).toBeTruthy();
    expect(screen.getByText(/Paid until/)).toBeTruthy();
    const select = screen.getByLabelText('Extend or move up') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'starter' } });
    expect(await screen.findByRole('button', { name: 'Extend 30 days — ₹1,499' })).toBeTruthy();
  });

  it('without online billing a paid plan is an upgrade request', async () => {
    const fetchMock = stubPortal();
    app();
    fireEvent.click(await screen.findByRole('button', { name: 'Request upgrade' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/upgrade'))).toBe(true));
  });
});
