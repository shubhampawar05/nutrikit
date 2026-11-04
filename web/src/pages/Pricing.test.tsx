import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';
import { Pricing } from './Pricing.tsx';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const plans = {
  currency: 'INR',
  plans: {
    free: { name: 'Free', monthlyTokens: 2000, ratePerMinute: 30, price: 0, currency: 'INR', maxKeys: 2, rank: 0 },
    starter: { name: 'Starter', monthlyTokens: 250000, ratePerMinute: 150, price: 1999, currency: 'INR', maxKeys: 5, rank: 1 },
    growth: { name: 'Growth', monthlyTokens: 1000000, ratePerMinute: 600, price: 11999, currency: 'INR', maxKeys: 20, rank: 2 },
    enterprise: { name: 'Enterprise', monthlyTokens: null, ratePerMinute: 3000, price: null, currency: 'INR', maxKeys: 100, rank: 3 },
  },
};

const me = {
  account: { id: 'acc_1', name: 'Ada', email: 'ada@example.com', createdAt: '2026-10-01T00:00:00Z' },
  plan: { id: 'free', ...plans.plans.free, expiresAt: null },
  usage: { periodStart: '2026-10-01T00:00:00Z', used: 0, remaining: 2000 },
  plans: plans.plans,
  billing: { enabled: false, mode: null, currency: 'INR', keyId: null },
};

function stub({ signedIn = false, plansResponse = () => Promise.resolve(json(plans)) }: { signedIn?: boolean; plansResponse?: () => Promise<Response> } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/portal/api/plans') return plansResponse();
    if (url === '/portal/api/me') return Promise.resolve(signedIn ? json(me) : json({ error: { code: 'unauthorized', message: 'not signed in' } }, 401));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('Pricing', () => {
  it('renders the plans from /portal/api/plans, token costs and FAQ', async () => {
    const fetchMock = stub();
    renderPage(<Pricing />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pay for what you log.');
    expect(screen.getByText('what you log').tagName).toBe('EM');

    expect(await screen.findByRole('heading', { level: 3, name: /Starter/ })).toBeTruthy();
    for (const name of ['Free', 'Growth', 'Enterprise']) expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    expect(screen.getByText('Popular')).toBeTruthy();
    // The numbers are the server's, not a copy in the page.
    expect(screen.getByText('250,000 tokens / month')).toBeTruthy();
    expect(screen.getByText('150 requests / minute')).toBeTruthy();
    expect(screen.getByText('₹1,999')).toBeTruthy();
    expect(screen.getByText('100 API keys')).toBeTruthy();
    expect(screen.getByText('Custom token volume')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start free' }).getAttribute('href')).toBe('/signup');
    expect(screen.getByText('What each call costs')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/portal/api/plans', expect.objectContaining({ method: 'GET' }));
  });

  it('shows skeleton cards while the plans load and no placeholder note', () => {
    stub({ plansResponse: () => new Promise(() => {}) });
    renderPage(<Pricing />);
    expect(document.querySelectorAll('.plan-skeleton')).toHaveLength(4);
    expect(document.body.textContent).not.toMatch(/placeholder/i);
    expect(document.querySelector('.notice')).toBeNull();
  });

  it('reports a failed plans load', async () => {
    stub({ plansResponse: () => Promise.resolve(json({ error: { code: 'error', message: 'database unavailable' } }, 503)) });
    renderPage(<Pricing />);
    expect((await screen.findByRole('alert')).textContent).toContain('Database unavailable.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('describes failed-call charging, metered responses and the AI provider generically', () => {
    stub();
    renderPage(<Pricing />);
    const failed = screen.getByText('Do failed requests cost tokens?').parentElement!;
    expect(failed.textContent).toContain('Failed calls are free, except AI usage');
    expect(failed.textContent).toContain('X-Tokens-Charged');
    expect(screen.getByText('How do I know what a call cost?').parentElement!.textContent).toContain('Every metered response');
    expect(screen.getByText(/the server's AI provider/, { selector: 'details:last-of-type p' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Claude/);
  });

  it('sends signed-out visitors to signup, then the upgrade form, from Enterprise', async () => {
    stub();
    renderPage(<Pricing />);
    const link = await screen.findByRole('link', { name: 'Contact us' });
    expect(link.getAttribute('href')).toBe('/signup?next=/dashboard%23upgrade');
  });

  it('sends signed-in developers straight to the upgrade form from Enterprise', async () => {
    stub({ signedIn: true });
    renderPage(<Pricing />);
    await screen.findByRole('link', { name: 'Contact us' });
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Contact us' }).getAttribute('href')).toBe('/dashboard#upgrade'));
  });
});
