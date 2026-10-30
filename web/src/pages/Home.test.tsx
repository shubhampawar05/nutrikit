import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';
import { Home } from './Home.tsx';

const demoResponse = {
  items: [
    { input: '2 eggs', food: { id: 1, name: 'Egg, whole, cooked' }, quantity: 2, unit: 'large', grams: 100, portionBasis: '2 large', nutrients: { calories: { amount: 155, unit: 'kcal', dailyValuePercent: 8 } } },
    { input: 'toast', food: { id: 2, name: 'Bread, toasted' }, quantity: 1, unit: 'slice', grams: 30, nutrients: { calories: { amount: 87, unit: 'kcal' } } },
  ],
  unmatched: [{ text: 'gravel' }],
  totals: { calories: { amount: 242, unit: 'kcal', dailyValuePercent: 12 }, protein: { amount: 15.4, unit: 'g', dailyValuePercent: 31 } },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Home', () => {
  it('renders the hero and runs the live demo on load', async () => {
    const fetchMock = vi.fn((url: string) => (url === '/portal/api/demo' ? Promise.resolve(json(demoResponse)) : Promise.resolve(json({}, 401))));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<Home />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveProperty('textContent', 'Describe a meal.Get the nutrition label.');
    expect(screen.getByText('nutrition label').tagName).toBe('EM');
    expect(document.getElementById('how')).not.toBeNull();

    expect(await screen.findByText('Egg, whole, cooked')).toBeTruthy();
    expect(screen.getByText('Bread, toasted')).toBeTruthy();
    expect(screen.getByText('Skipped: gravel')).toBeTruthy();
    expect(screen.getByText('2 foods · this meal')).toBeTruthy();
    expect(document.querySelector('.nf-cal .tick')?.textContent).toBe('240'); // calories rounded FDA-style
    expect(screen.getByText(/POST \/v1\/log\/text · 2 items/)).toBeTruthy();

    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/portal/api/demo') as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: '2 eggs, toast with butter and an orange juice' });
  });

  it('runs an example chip and shows the rate-limit message', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.resolve(calls === 1 ? json(demoResponse) : json({ error: { code: 'rate_limited', message: 'demo limit reached; create a free key for more' } }, 429));
    }));
    renderPage(<Home />);
    await screen.findByText('Egg, whole, cooked');
    fireEvent.click(screen.getByRole('button', { name: '2 slices of pizza and a diet coke' }));
    expect(await screen.findByText('demo limit reached; create a free key for more')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2 slices of pizza and a diet coke');
  });

  it('shows a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    renderPage(<Home />);
    await waitFor(() => expect(screen.getByText('Could not reach the API.')).toBeTruthy());
  });

  it('switches code sample tabs', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage(<Home />);
    fireEvent.click(screen.getByRole('tab', { name: 'curl' }));
    expect(screen.getByRole('tab', { name: 'curl' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('https://api.your-domain.com/v1/log/text')).toBeTruthy();
  });
});
