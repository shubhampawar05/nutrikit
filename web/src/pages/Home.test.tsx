import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const demoCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([u]) => u === '/portal/api/demo').length;

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
    // The amount the visitor said, not the portion it was worked out from.
    expect(screen.getByText('2 large · 100 g')).toBeTruthy();
    expect(screen.getByText('from 2 large')).toBeTruthy();
    expect(screen.getByText('1 slice · 30 g')).toBeTruthy();

    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/portal/api/demo') as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: '2 eggs, toast with butter and an orange juice' });
  });

  it('runs an example chip and shows the rate limit as a sentence with a signup link, clearing the label', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.resolve(calls === 1 ? json(demoResponse) : json({ error: { code: 'rate_limited', message: 'demo limit reached; create a free key for more' } }, 429));
    }));
    renderPage(<Home />);
    await screen.findByText('Egg, whole, cooked');
    expect(document.querySelector('.nf-cal .tick')?.textContent).toBe('240');
    fireEvent.click(screen.getByRole('button', { name: '2 slices of pizza and a diet coke' }));
    const link = await screen.findByRole('link', { name: 'create a free key' });
    expect(link.getAttribute('href')).toBe('/signup');
    expect(link.parentElement?.textContent).toBe('Demo limit reached; create a free key for more.');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2 slices of pizza and a diet coke');
    // No numbers from the previous meal next to the error.
    expect(screen.queryByText('Egg, whole, cooked')).toBeNull();
    expect(document.querySelector('.nf-cal .tick')?.textContent).toBe('—');
    expect(screen.getByText('0 foods · this meal')).toBeTruthy();
  });

  it('clears the previous totals on any API error and shows the message as a sentence', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      return Promise.resolve(calls === 1 ? json(demoResponse) : json({ error: { code: 'invalid_request', message: 'the demo accepts up to 200 characters' } }, 400));
    }));
    renderPage(<Home />);
    await screen.findByText('Egg, whole, cooked');
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    expect(await screen.findByText('The demo accepts up to 200 characters.')).toBeTruthy();
    expect(document.querySelector('.nf-cal .tick')?.textContent).toBe('—');
    expect(screen.getByText('0 foods · this meal')).toBeTruthy();
  });

  it('sends one request after the visitor stops typing for 1.5 s', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(url === '/portal/api/demo' ? json(demoResponse) : json({}, 401)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<Home />);
    await screen.findByText('Egg, whole, cooked');
    expect(demoCalls(fetchMock)).toBe(1);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const input = screen.getByRole('textbox');
    const words = 'a bowl of oatmeal with milk and two boiled eggs today'.split(' ');
    for (let n = 1; n <= words.length; n++) {
      fireEvent.change(input, { target: { value: words.slice(0, n).join(' ') } });
      act(() => vi.advanceTimersByTime(400)); // a normal typing pace
    }
    act(() => vi.advanceTimersByTime(1099));
    expect(demoCalls(fetchMock)).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(demoCalls(fetchMock)).toBe(2);
    vi.useRealTimers();

    const [, init] = fetchMock.mock.calls.filter(([u]) => u === '/portal/api/demo')[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: words.join(' ') });
  });

  it('offers a respelling and logs the corrected meal when it is clicked', async () => {
    const respelled = { ...demoResponse, items: [demoResponse.items[0]], unmatched: [{ text: '1 cup panner', didYouMean: '1 cup paneer' }] };
    const bodies: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url !== '/portal/api/demo') return Promise.resolve(json({}, 401));
      bodies.push(JSON.parse(String(init?.body)).text);
      return Promise.resolve(json(bodies.length === 2 ? respelled : demoResponse));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<Home />);
    await screen.findByText('Egg, whole, cooked');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2 eggs and 1 cup panner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    const suggestion = await screen.findByRole('button', { name: '1 cup paneer' });
    expect(screen.queryByText(/Skipped/)).toBeNull(); // a respellable phrase is offered, not listed as skipped

    fireEvent.click(suggestion);
    await waitFor(() => expect(bodies[2]).toBe('2 eggs and 1 cup paneer'));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2 eggs and 1 cup paneer');
  });

  it('shows a dash for nutrients no food has, names each food\'s source, and never hides a skipped phrase', async () => {
    const cofidOnly = {
      items: [{ input: 'rajma', food: { id: 9, name: 'Curry, red kidney bean', source: 'cofid' }, quantity: 1, unit: 'serving', grams: 100, nutrients: { calories: { amount: 106, unit: 'kcal' } } }],
      unmatched: [], totals: { calories: { amount: 106, unit: 'kcal', dailyValuePercent: 5 } },
    };
    const nothingLogged = {
      items: [],
      unmatched: [
        { text: 'biriyani', didYouMean: 'biryani' },
        { text: 'panner tikka' },
        { text: '1 bowl oats', note: '"Oats, raw" is the dry, uncooked food and no cooked dish for it is in the catalog; give a weight to log the dry amount' },
      ],
      totals: {},
    };
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url !== '/portal/api/demo') return Promise.resolve(json({}, 401));
      calls++;
      return Promise.resolve(json(calls === 1 ? cofidOnly : nothingLogged));
    }));
    renderPage(<Home />);
    await screen.findByText('Curry, red kidney bean');
    expect(screen.getByText('UK CoFID 2021')).toBeTruthy(); // not "USDA FoodData Central"
    const cholesterol = [...document.querySelectorAll('.nf-row')].find((r) => r.textContent?.startsWith('Cholesterol'));
    expect(cholesterol?.querySelector('.tick')?.textContent).toBe('—'); // unknown, not 0 mg

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'biriyani, panner tikka and 1 bowl oats' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    expect(await screen.findByRole('button', { name: 'biryani' })).toBeTruthy();
    expect(screen.getByText('Skipped: panner tikka')).toBeTruthy();
    expect(screen.getByText(/Skipped “1 bowl oats”: "Oats, raw" is the dry, uncooked food/)).toBeTruthy();
  });

  it('submits immediately and shows a busy, disabled button while a request runs', async () => {
    let finish: (r: Response) => void = () => {};
    let calls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url !== '/portal/api/demo') return Promise.resolve(json({}, 401));
      calls++;
      return calls === 1 ? Promise.resolve(json(demoResponse)) : new Promise<Response>((r) => { finish = r; });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<Home />);
    await screen.findByText('Egg, whole, cooked');
    const button = screen.getByRole('button', { name: 'Log it' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a banana' } });
    fireEvent.click(button);
    expect(demoCalls(fetchMock)).toBe(2); // no debounce wait
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(button.textContent).toBe('Logging…');

    await act(async () => finish(json(demoResponse)));
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe('Log it');
  });

  it('labels the demo and its nutrition facts with roles that take a label', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage(<Home />);
    expect(screen.getByRole('region', { name: 'Try it — what did you eat?' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Nutrition facts for this meal' })).toBeTruthy();
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
    expect(screen.getByText(`${window.location.origin}/v1/log/text`)).toBeTruthy();
    expect(document.body.textContent).not.toContain('your-domain.com');
  });
});
