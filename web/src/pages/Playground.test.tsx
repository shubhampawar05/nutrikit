import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';
import { Playground } from './Playground.tsx';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const ME = {
  account: { id: 'a1', name: 'Ada', email: 'ada@example.com', createdAt: '2026-01-01' },
  plan: { id: 'free', name: 'Free', monthlyTokens: 10000, ratePerMinute: 60, price: 0, currency: 'INR', maxKeys: 3, expiresAt: null },
  usage: { periodStart: '2026-10-01', used: 0, remaining: 10000 },
  plans: {},
  billing: { enabled: false, mode: null, currency: 'INR', keyId: null },
};
const TOKEN = { access_token: 'nkat_test', token_type: 'Bearer', expires_in: 3600, expires_at: '2026-10-30T12:00:00Z', key: { id: 'k1', name: 'Default key' } };
const SEARCH = { query: 'greek yogurt', relaxed: false, total: 2, results: [
  { id: 101, name: 'Yogurt, Greek, plain', source: 'survey', category: 'Yogurt', score: 1 },
  { id: 102, name: 'Yogurt, Greek, vanilla', source: 'survey', category: 'Yogurt', score: 0.9 },
] };

type Handler = (url: string, init?: RequestInit) => Response;

function stubFetch(v1: Handler, signedIn = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/portal/api/me')) return signedIn ? json(ME) : json({ error: { code: 'unauthorized', message: 'Log in' } }, 401);
    if (url.includes('/portal/api/playground-token')) return json(TOKEN);
    return v1(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  sessionStorage.clear();
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Playground', () => {
  it('renders the page', async () => {
    stubFetch(() => json({}), false);
    renderPage(<Playground />, { path: '/playground' });
    expect(screen.getByRole('heading', { level: 1, name: 'Try every endpoint.' })).toBeTruthy();
    expect(screen.getByText('Playground')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Endpoints' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Log from text' })).toBeTruthy();
    expect(screen.getByText('Send the request to see the result.')).toBeTruthy();
    // Signed out: the key form appears.
    expect(await screen.findByLabelText('API key or access token')).toBeTruthy();
  });

  it('runs a food search for a signed-in user and shows the JSON and token headers', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url).toContain('/v1/foods/search?q=greek+yogurt&limit=8');
      return json(SEARCH, 200, { 'X-Tokens-Charged': '1', 'X-Tokens-Remaining': '9999' });
    });
    renderPage(<Playground />, { path: '/playground#search' });

    expect(await screen.findByText(/Signed in · key “Default key”/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Search foods' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    expect(await screen.findByText('Yogurt, Greek, plain')).toBeTruthy();
    expect(screen.getByText('1 token', { selector: '.pg-chip' })).toBeTruthy();
    expect(screen.getByText('9,999 left', { selector: '.pg-chip' })).toBeTruthy();
    expect(screen.getByText(/^200/, { selector: '.pg-chip' })).toBeTruthy();

    // The SDK sent the minted session token.
    const v1Call = fetchMock.mock.calls.find(([u]) => String(u).includes('/v1/'));
    expect(new Headers(v1Call?.[1]?.headers).get('Authorization')).toBe('Bearer nkat_test');

    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    const pre = document.querySelector('.pg-out:not([hidden]) pre');
    expect(pre?.textContent).toContain('"name": "Yogurt, Greek, plain"');
    expect(JSON.parse(pre?.textContent ?? '')).toEqual(SEARCH);

    fireEvent.click(screen.getByRole('tab', { name: 'cURL' }));
    expect(screen.getByText(/curl ".*\/v1\/foods\/search\?q=greek\+yogurt&limit=8"/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('nkat_test');
  });

  it('shows an API error (401)', async () => {
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'Invalid API key' } }, 401));
    renderPage(<Playground />, { path: '/playground#usage' });
    await screen.findByText(/Signed in/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    const box = await waitFor(() => {
      const el = document.querySelector('.pg-error');
      if (!el) throw new Error('no error yet');
      return el as HTMLElement;
    });
    expect(within(box).getByText('401 · unauthorized')).toBeTruthy();
    expect(within(box).getByText('Invalid API key')).toBeTruthy();
    expect(within(box).getByText(/Check the key, or log in/)).toBeTruthy();
    expect(screen.getByText(/^401/, { selector: '.pg-chip' })).toBeTruthy();
  });

  it('asks for a key when signed out and nothing is saved', async () => {
    stubFetch(() => json({}), false);
    renderPage(<Playground />, { path: '/playground#search' });
    await screen.findByLabelText('API key or access token');
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText('no_key')).toBeTruthy();
    expect(screen.getByText('Add an API key above (or log in) to send requests.')).toBeTruthy();
  });

  it('uses a pasted key, saved for this tab', async () => {
    const fetchMock = stubFetch(() => json(SEARCH, 200, { 'X-Tokens-Charged': '1' }), false);
    renderPage(<Playground />, { path: '/playground#search' });
    const input = await screen.findByLabelText('API key or access token');
    fireEvent.change(input, { target: { value: '  nk_pasted  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use key' }));
    expect(sessionStorage.getItem('nk-playground-key')).toBe('nk_pasted');
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await screen.findByText('Yogurt, Greek, plain');
    const v1Call = fetchMock.mock.calls.find(([u]) => String(u).includes('/v1/'));
    expect(new Headers(v1Call?.[1]?.headers).get('Authorization')).toBe('Bearer nk_pasted');
  });
});
