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

function stubFetch(v1: Handler | ((url: string, init?: RequestInit) => Promise<Response>), signedIn = true, token: () => Response = () => json(TOKEN)) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/portal/api/me')) return signedIn ? json(ME) : json({ error: { code: 'unauthorized', message: 'Log in' } }, 401);
    if (url.includes('/portal/api/playground-token')) return token();
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
    expect(within(box).getByText('Invalid API key.')).toBeTruthy(); // server messages read as sentences
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

  // ---------------------------------------------------------------- 6.1 credential state
  it('never sends with the session in "Use another key" mode, and "Use my account" restores it', async () => {
    let minted = 0;
    const fetchMock = stubFetch(() => json(SEARCH), true, () => json({ ...TOKEN, access_token: `nkat_${++minted}` }));
    renderPage(<Playground />, { path: '/playground#search' });
    await screen.findByText(/Signed in · key “Default key”/);

    fireEvent.click(screen.getByRole('button', { name: 'Use another key' }));
    // Nothing pasted: the playground asks for a key instead of sending with the session.
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText('Paste an API key above to send requests.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/'))).toBe(false);

    fireEvent.change(screen.getByLabelText('API key or access token'), { target: { value: 'nk_pasted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use key' }));
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await screen.findByText('Yogurt, Greek, plain');
    const v1Calls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/v1/'));
    expect(new Headers(v1Calls()[0]?.[1]?.headers).get('Authorization')).toBe('Bearer nk_pasted');

    fireEvent.click(screen.getByRole('button', { name: 'Use my account' }));
    expect(await screen.findByText(/Signed in · key “Default key”/)).toBeTruthy();
    expect(minted).toBe(2); // a fresh token, not the one from before
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await waitFor(() => expect(v1Calls()).toHaveLength(2));
    expect(new Headers(v1Calls()[1]?.[1]?.headers).get('Authorization')).toBe('Bearer nkat_2');
  });

  // ---------------------------------------------------------------- 6.2 one request at a time
  it('sends once for three quick Ctrl+Enter presses, and ignores the button and chips while busy', async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((res) => { release = res; }));
    renderPage(<Playground />, { path: '/playground#search' });
    await screen.findByText(/Signed in/);

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: /Sending/ }));
    fireEvent.click(screen.getByRole('button', { name: 'banana' }));
    const v1Calls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/v1/'));
    await waitFor(() => expect(v1Calls()).toHaveLength(1));
    expect(String(v1Calls()[0]?.[0])).toContain('q=greek+yogurt'); // the chip didn't change the query either

    release(json(SEARCH, 200, { 'X-Tokens-Charged': '1' }));
    await screen.findByText('Yogurt, Greek, plain');
    expect(v1Calls()).toHaveLength(1);
  });

  // ---------------------------------------------------------------- 6.3 guidance
  it('points a signed-in user without a key to the dashboard', async () => {
    const fetchMock = stubFetch(() => json(SEARCH), true, () => json({ error: { code: 'no_active_key', message: 'No active key' } }, 409));
    renderPage(<Playground />, { path: '/playground#search' });
    await screen.findByText('You have no active API keys');
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    const link = await screen.findByRole('link', { name: /Create a key in your dashboard/ });
    expect(link.getAttribute('href')).toBe('/dashboard');
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get a free key' })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/'))).toBe(false);
  });

  it('describes a missing AI provider without server configuration details', async () => {
    stubFetch(() => json({ error: { code: 'ai_provider_unavailable', message: 'no AI provider configured' } }, 501));
    renderPage(<Playground />, { path: '/playground#photo' });
    await screen.findByText(/Signed in/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    expect(await screen.findByText(/AI features aren’t enabled on this server yet/)).toBeTruthy();
    expect(screen.getByText(/Text logging, voice transcripts and label text still work/)).toBeTruthy();
    // The server message is shown as a sentence.
    expect(screen.getByText('No AI provider configured.')).toBeTruthy();
    expect(document.querySelector('.pg-error')?.textContent).not.toMatch(/API_KEY|env/i);
  });

  it('sends a quota error to the dashboard to upgrade', async () => {
    stubFetch(() => json({ error: { code: 'quota_exceeded', message: 'Monthly token quota exceeded' } }, 402));
    renderPage(<Playground />, { path: '/playground#search' });
    await screen.findByText(/Signed in/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    expect(await screen.findByText(/Upgrade from your dashboard/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open dashboard/ }).getAttribute('href')).toBe('/dashboard');
  });

  it('points to the JSON tab when a 2xx response can’t be previewed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React logs the caught render error
    stubFetch(() => json({ unexpected: true }));
    renderPage(<Playground />, { path: '/playground#search' });
    await screen.findByText(/Signed in/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    expect(await screen.findByText('Couldn’t display this response — see the JSON tab.')).toBeTruthy();
    expect(screen.queryByText(/Could not reach the API/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show JSON' }));
    expect(screen.getByRole('tab', { name: 'JSON' }).getAttribute('aria-selected')).toBe('true');
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------- 6.4 previews and accessibility
  const kcal = (amount: number) => ({ calories: { amount, unit: 'kcal', dailyValuePercent: null } });
  const LOG = {
    meal: null, unmatched: [], provider: 'rules', totals: kcal(143),
    items: [{
      input: '2 eggs', food: { id: 1, name: 'Egg, whole, cooked', source: 'survey' }, quantity: 2, unit: 'egg', grams: 100,
      portionBasis: '1 egg', portionMethod: 'household', confidence: 'high', nutrients: kcal(143), alternatives: [],
    }],
  };

  it('shows the quantity said and the grams, with a short live status line', async () => {
    stubFetch(() => json(LOG, 200, { 'X-Tokens-Charged': '5' }));
    renderPage(<Playground />, { path: '/playground#text' });
    await screen.findByText(/Signed in/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    await screen.findByText('Egg, whole, cooked');
    const item = document.querySelector('.pg-item .muted.small');
    expect(item?.textContent).toMatch(/^2 eggs · 100 g/);
    expect(item?.textContent).not.toMatch(/^1 egg/);

    // Only the status line is live, not the whole response panel.
    expect(document.querySelector('.pg-response')?.hasAttribute('aria-live')).toBe(false);
    expect(document.querySelectorAll('.pg-response [aria-live]')).toHaveLength(1);
    expect(within(document.querySelector<HTMLElement>('.pg-response')!).getByRole('status').textContent).toBe('200 OK · 5 tokens');
  });

  it('shows the unit on every per-100 g label value', async () => {
    stubFetch(() => json({
      source: 'text', servingSize: '2/3 cup (55g)', servingGrams: 55, servingsPerContainer: 8, warnings: [],
      perServing: { calories: { amount: 230, unit: 'kcal' }, fat: { amount: 8, unit: 'g' }, sodium: { amount: 160, unit: 'mg' } },
      per100g: { calories: 418, fat: 14.5, sodium: 291 },
    }));
    renderPage(<Playground />, { path: '/playground#label' });
    await screen.findByText(/Signed in/);
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));

    await screen.findByText('Per 100 g');
    const per100 = [...document.querySelectorAll('.pg-out:not([hidden]) tbody tr')].slice(1).map((tr) => tr.lastElementChild?.textContent);
    expect(per100).toEqual(['418 kcal', '14.5 g', '291 mg']);
  });

  it('keeps the photo input keyboard reachable', async () => {
    stubFetch(() => json({}), false);
    renderPage(<Playground />, { path: '/playground#photo' });
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!el) throw new Error('no input yet');
      return el;
    });
    expect(input.hidden).toBe(false);
    expect(input.classList.contains('sr-only')).toBe(true);
    expect(input.tabIndex).toBe(0);
    expect(input.closest('label.pg-drop')).toBeTruthy();
  });

  it('labels the response tabs and moves between them with the arrow keys', async () => {
    stubFetch(() => json({}), false);
    renderPage(<Playground />, { path: '/playground#search' });
    const list = screen.getByRole('tablist', { name: 'Response view' });
    const preview = within(list).getByRole('tab', { name: 'Preview' });
    expect(preview.getAttribute('tabindex')).toBe('0');
    expect(within(list).getByRole('tab', { name: 'JSON' }).getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById(preview.getAttribute('aria-controls') ?? '')?.getAttribute('role')).toBe('tabpanel');

    preview.focus();
    fireEvent.keyDown(preview, { key: 'ArrowRight' });
    const jsonTab = within(list).getByRole('tab', { name: 'JSON' });
    expect(jsonTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(jsonTab);
    const panel = document.getElementById(jsonTab.getAttribute('aria-controls') ?? '');
    expect(panel?.hidden).toBe(false);
    expect(panel?.getAttribute('aria-labelledby')).toBe(jsonTab.id);
  });
});
