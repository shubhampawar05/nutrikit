import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { choose, renderPage } from '../test-utils.tsx';
import { Admin } from './Admin.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const overview = {
  accounts: 3, byPlan: { free: 2, starter: 1 }, activePaidPeriods: 1,
  payments: { count: 1, revenue: 1499, last30Days: { count: 1, revenue: 1499 } },
  activeKeys: 4, upgradeRequests: 1, tokensThisMonth: 1234,
};
const accounts = [{ id: 'acct_1', email: 'test11@gmail.com', name: 'Test Co', members: 2, plan: 'starter', planExpiresAt: '2026-11-29T00:00:00Z', createdAt: '2026-10-30T00:00:00Z', activeKeys: 1, usedThisMonth: 40, totalPaid: 1499, lastPaymentAt: '2026-10-30T11:50:00Z' }];
const payments = [{ paymentId: 'pay_abc', orderId: 'order_abc', accountId: 'acct_1', email: 'test11@gmail.com', name: 'Test Co', plan: 'starter', amount: 1499, currency: 'INR', periodEnd: '2026-11-29T00:00:00Z', paidAt: '2026-10-30T11:50:00Z' }];
const metrics = {
  startedAt: '2026-11-12T00:00:00Z', uptimeSeconds: 7500,
  process: { rssMb: 182.4, heapUsedMb: 61.2, eventLoopDelayMs: { p50: 10.1, p99: 21.7, max: 40 }, node: 'v24.1.0' },
  requests: {
    total: 120, byStatus: { '2xx': 110, '3xx': 0, '4xx': 8, '5xx': 2 },
    last5Minutes: { requests: 40, serverErrors: 2 }, last60Minutes: { requests: 120, serverErrors: 2 },
  },
  routes: [{ route: 'GET /v1/foods/search', count: 100, byStatus: { '2xx': 95, '3xx': 0, '4xx': 3, '5xx': 2 }, p50Ms: 12.3, p95Ms: 48, p99Ms: 90.6 }],
  alerts: { configured: false, sent: 0, failed: 0, suppressed: 0, lastSentAt: null },
};
const keys = [{ id: 'key_1', name: 'Default key', mode: 'live', tokenLimit: null, createdAt: '2026-10-30T00:00:00Z', revokedAt: null, lastUsedAt: null, accountId: 'acct_1', email: 'test11@gmail.com', accountName: 'Test Co', usedThisMonth: 40 }];

/** The admin API, accepting only the token "right-token". */
const foodRequests = [
  {
    id: 7, phrase: 'sabudana khichdi', example: '2 bowls sabudana khichdi', reason: 'no matching food', count: 42,
    firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-18T00:00:00Z', status: 'open', note: null,
    estimateStatus: 'pending', estimateUses: 3,
    estimate: {
      name: 'Sabudana khichdi', confidence: 'medium', provider: 'openai', model: 'gpt-5-mini', at: '2026-11-17T00:00:00Z',
      per100g: { calories: 180, protein: 3, fat: 7, carbs: 27, fiber: 1, sugar: 1, saturatedFat: 1, sodium: 300 },
      serving: { label: '1 bowl', unit: 'bowl', grams: 250 },
    },
  },
  {
    id: 9, phrase: 'chicken korma restaurant', example: 'chicken korma restaurant', reason: 'no confident match', count: 2,
    firstSeen: '2026-11-18T00:00:00Z', lastSeen: '2026-11-18T00:00:00Z', status: 'open', note: null,
    estimateStatus: 'pending', estimateUses: 2,
    estimate: {
      name: 'Curry, chicken korma, homemade', confidence: 'high', provider: 'openai', model: 'gpt-5-mini', at: '2026-11-17T00:00:00Z',
      per100g: { calories: 170, protein: 13, fat: 10, carbs: 7, fiber: 1, sugar: 2, saturatedFat: 3, sodium: 400 },
      serving: { label: '1 bowl', unit: 'bowl', grams: 250 }, sameAs: { id: 800150700, name: 'Curry, chicken korma, homemade' },
    },
  },
  {
    id: 8, phrase: 'qwzx', example: 'qwzx', reason: 'no matching food', count: 1,
    firstSeen: '2026-11-18T00:00:00Z', lastSeen: '2026-11-18T00:00:00Z', status: 'open', note: null,
    estimateStatus: 'none', estimateUses: 0, estimate: null,
  },
];

function stubAdmin() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== 'Bearer right-token') return json(401, { error: { code: 'unauthorized', message: 'admin token required' } });
    const path = String(input).replace('/v1/admin', '').split('?')[0];
    const method = init?.method ?? 'GET';
    if (path === '/overview') return json(200, overview);
    if (path === '/accounts') return json(200, { accounts });
    if (path === '/payments') return json(200, { payments });
    if (path === '/keys' && method === 'GET') return json(200, { keys });
    if (path === '/upgrade-requests') return json(200, { requests: [] });
    if (path === '/metrics') return json(200, metrics);
    if (path === '/keys/key_1' && method === 'DELETE') return json(200, { revoked: 'key_1' });
    if (path === '/accounts/acct_1/plan' && method === 'POST') return json(200, { account: 'acct_1', plan: 'enterprise' });
    if (path === '/food-requests' && method === 'GET') return json(200, { requests: foodRequests, counts: { open: 3, pendingEstimates: 2, approvedEstimates: 0 } });
    if (path === '/food-requests/7' && method === 'PATCH') return json(200, { ...foodRequests[0], ...JSON.parse(String(init?.body)) });
    return json(404, { error: { code: 'not_found', message: 'not found' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function signIn(token = 'right-token') {
  fireEvent.change(await screen.findByLabelText('Admin token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Admin console', () => {
  it('refuses a wrong token and shows no data', async () => {
    stubAdmin();
    renderPage(<Admin />);
    await signIn('wrong');
    expect(await screen.findByText('That admin token was not accepted.')).toBeTruthy();
    expect(screen.queryByText('Revenue (all time)')).toBeNull();
    expect(sessionStorage.getItem('nk-admin-token')).toBeNull();
  });

  it('signs in and shows the overview, payments and accounts', async () => {
    stubAdmin();
    renderPage(<Admin />);
    await signIn();
    expect(await screen.findByText('Revenue (all time)')).toBeTruthy();
    expect(screen.getAllByText('₹1,499').length).toBeGreaterThan(0);
    expect(sessionStorage.getItem('nk-admin-token')).toBe('right-token');

    fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(await screen.findByText('pay_abc')).toBeTruthy();
    expect(screen.getByText('test11@gmail.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
    expect(await screen.findByText('acct_1', { exact: false })).toBeTruthy();
  });

  it('shows server health: uptime, error rate, latency per route, and whether alerts are on', async () => {
    stubAdmin();
    renderPage(<Admin />);
    await signIn();
    fireEvent.click(await screen.findByRole('tab', { name: 'Health' }));
    expect(await screen.findByText('2h 5m')).toBeTruthy();
    expect(screen.getByText('2 server errors (5%)')).toBeTruthy();
    expect(screen.getByText('GET /v1/foods/search')).toBeTruthy();
    expect(screen.getByText('91 ms')).toBeTruthy();
    expect(screen.getByText('Off: set NUTRIKIT_ALERT_WEBHOOK_URL')).toBeTruthy();
  });

  it('revokes a key after confirmation', async () => {
    const fetchMock = stubAdmin();
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderPage(<Admin />);
    await signIn();
    fireEvent.click(await screen.findByRole('tab', { name: 'Keys' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Default key' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/v1/admin/keys/key_1' && i?.method === 'DELETE')).toBe(true));
  });

  it('changes an account plan after confirmation', async () => {
    const fetchMock = stubAdmin();
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderPage(<Admin />);
    await signIn();
    fireEvent.click(await screen.findByRole('tab', { name: 'Accounts' }));
    choose(await screen.findByLabelText('Plan for Test Co'), 'Enterprise');
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/v1/admin/accounts/acct_1/plan' && i?.method === 'POST');
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ plan: 'enterprise' });
    });
  });

  it('signing out forgets the token', async () => {
    stubAdmin();
    renderPage(<Admin />);
    await signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Admin token')).toBeTruthy();
    expect(sessionStorage.getItem('nk-admin-token')).toBeNull();
  });

  it('debounces search into one request and keeps the table while it loads', async () => {
    const fetchMock = stubAdmin();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage(<Admin />);
    await signIn();
    fireEvent.click(await screen.findByRole('tab', { name: 'Accounts' }));
    expect(await screen.findByText('acct_1', { exact: false })).toBeTruthy();
    const searches = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/v1/admin/accounts?'));

    const box = screen.getByLabelText("Search by a member's email or team name");
    for (const value of ['p', 'pr', 'pri', 'priy', 'priya', 'priya@']) {
      fireEvent.change(box, { target: { value } });
      act(() => { vi.advanceTimersByTime(100); });
    }
    expect(searches()).toHaveLength(0);
    expect(screen.getByText('acct_1', { exact: false })).toBeTruthy();
    expect(screen.getByText('Searching…')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(String(searches()[0]![0])).toBe('/v1/admin/accounts?q=priya%40');
    expect(screen.getByText('acct_1', { exact: false })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull());
  });

  it('returns to sign-in when the stored token is refused', async () => {
    const fetchMock = stubAdmin();
    renderPage(<Admin />);
    await signIn();
    expect(await screen.findByText('Revenue (all time)')).toBeTruthy();

    // The token is rotated on the server: every admin call now answers 401.
    fetchMock.mockImplementation(async () => json(401, { error: { code: 'unauthorized', message: 'admin token required' } }));
    fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(await screen.findByText('That admin token is no longer accepted.')).toBeTruthy();
    expect(screen.getByLabelText('Admin token')).toBeTruthy();
    expect(sessionStorage.getItem('nk-admin-token')).toBeNull();
  });

  it('uses the ARIA tabs pattern and names table headers and row buttons', async () => {
    stubAdmin();
    renderPage(<Admin />);
    await signIn();
    const list = await screen.findByRole('tablist', { name: 'Admin sections' });
    const overview = within(list).getByRole('tab', { name: 'Overview' });
    expect(overview.getAttribute('tabindex')).toBe('0');
    expect(within(list).getByRole('tab', { name: 'Keys' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(overview.id);

    fireEvent.keyDown(overview, { key: 'End' });
    const lastTab = screen.getByRole('tab', { name: 'Missing foods' });
    expect(lastTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(lastTab, { key: 'ArrowLeft' });
    const requestsTab = screen.getByRole('tab', { name: 'Requests' });
    expect(requestsTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(requestsTab, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Keys' }).getAttribute('aria-selected')).toBe('true');

    expect(await screen.findByRole('button', { name: 'Revoke Default key' })).toBeTruthy();
    const header = screen.getByRole('columnheader', { name: 'Key' });
    expect(header.getAttribute('scope')).toBe('col');
    expect(header.closest('thead')).toBeTruthy();
  });

  it('lists missing foods with their AI estimates and approves one after confirmation', async () => {
    const fetchMock = stubAdmin();
    vi.stubGlobal('confirm', vi.fn(() => true));
    renderPage(<Admin />);
    await signIn();
    fireEvent.click(await screen.findByRole('tab', { name: 'Missing foods' }));
    expect(await screen.findByText('sabudana khichdi')).toBeTruthy();
    expect(screen.getByText(/180 kcal · P 3 g · C 27 g · F 7 g per 100 g · 1 bowl = 250 g/)).toBeTruthy();
    expect(screen.getAllByText('to review')).toHaveLength(2);
    expect(screen.getByText('none yet')).toBeTruthy();
    expect(screen.getByText(/Consider adding “chicken korma restaurant” as its alias/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve estimate for qwzx' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve estimate for sabudana khichdi' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/v1/admin/food-requests/7' && i?.method === 'PATCH');
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ estimateStatus: 'approved' });
    });
    expect(await screen.findByText('Estimate for “sabudana khichdi” approved')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/v1/admin/food-requests?status=open')).toBe(true);
  });
});
