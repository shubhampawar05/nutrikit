// With payments hidden (features.ts, the shipped setting): no Pricing page or links, no prices or upgrade form.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Route, RouterProvider, Routes, createMemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast.tsx';
import { renderPage } from './test-utils.tsx';
import { PAYMENTS_VISIBLE } from './features.ts';
import { Layout } from './components/Layout.tsx';
import { Home } from './pages/Home.tsx';
import { Pricing } from './pages/Pricing.tsx';
import { Docs } from './pages/Docs.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import seo from './seo.json';
import type { Me } from './api/client.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const plans = {
  free: { name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, rank: 0 },
  starter: { name: 'Starter', monthlyTokens: 100000, ratePerMinute: 120, price: 1499, currency: 'INR', maxKeys: 5, rank: 1 },
};
const me: Me = {
  account: { id: 'acc_1', name: 'Ada Labs', email: 'ada@example.com', emailVerified: true, createdAt: '2026-10-01T00:00:00Z' },
  plan: { id: 'free', ...plans.free, expiresAt: null },
  usage: { periodStart: '2026-10-01T00:00:00Z', used: 0, remaining: 2000 },
  plans,
  billing: { enabled: true, mode: 'test', currency: 'INR', keyId: 'rzp_test_key' },
};

/** Signed in or out; answers the portal calls the pages make. */
function stub(signedIn: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace('/portal/api', '');
    if (path === '/me') return signedIn ? json(200, me) : json(401, { error: { code: 'unauthorized', message: 'please log in' } });
    if (path === '/keys') return json(200, { keys: [] });
    if (path.startsWith('/usage')) return json(200, { series: [], month: { periodStart: '2026-10-01T00:00:00Z', tokenLimit: 2000, used: 0, remaining: 2000, byEndpoint: [] } });
    if (path === '/demo') return json(200, { items: [], unmatched: [], totals: {} });
    if (path === '/plans') return json(200, { plans, currency: 'INR' });
    return json(404, { error: { code: 'not_found', message: 'not found' } });
  }));
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

afterEach(() => vi.unstubAllGlobals());

describe('payments hidden', () => {
  it('is the shipped setting, and /pricing is out of the sitemap', () => {
    expect(PAYMENTS_VISIBLE).toBe(false);
    expect(seo.pages['/pricing'].index).toBe(false);
  });

  it('shows no Pricing link in the header or footer, and no "See pricing" on the homepage', async () => {
    stub(false);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ element: <Layout />, children: [{ path: '/', element: <Home /> }] }], { initialEntries: ['/'] });
    render(<QueryClientProvider client={client}><ToastProvider><RouterProvider router={router} /></ToastProvider></QueryClientProvider>);
    await screen.findByRole('link', { name: 'Docs' });
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'See pricing' })).toBeNull();
    expect(screen.queryByText(/Upgrade only when/)).toBeNull();
  });

  it('sends /pricing to the homepage', async () => {
    stub(false);
    renderPage(<Routes><Route path="/pricing" element={<Pricing />} /><Route path="*" element={<Where />} /></Routes>, { path: '/pricing' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'));
  });

  it('leaves the cost-table link out of the docs', () => {
    stub(false);
    renderPage(<Docs />, { path: '/docs' });
    expect(screen.queryByRole('link', { name: 'cost table' })).toBeNull();
  });

  it('shows the plan allowances on the dashboard without a price, upgrade picker or Pay button', async () => {
    stub(true);
    renderPage(<Routes><Route path="/dashboard" element={<Dashboard />} /></Routes>, { path: '/dashboard' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Hi, Ada Labs' })).toBeTruthy();
    expect(screen.getByText('2,000 tokens / month')).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(screen.queryByLabelText('Need more?')).toBeNull();
    expect(screen.queryByRole('button', { name: /Pay|Request upgrade/ })).toBeNull();
  });
});
