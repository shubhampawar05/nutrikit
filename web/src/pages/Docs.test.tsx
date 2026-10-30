import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';
import { Docs } from './Docs.tsx';

afterEach(() => vi.unstubAllGlobals());

describe('Docs', () => {
  it('renders the guides, nav anchors and the nutrient table from /v1/nutrients', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      nutrients: [
        { key: 'calories', name: 'Energy', unit: 'kcal', dailyValue: 2000 },
        { key: 'sugar', name: 'Total sugars', unit: 'g', dailyValue: null },
      ],
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<Docs />, { path: '/docs' });

    expect(screen.getByRole('heading', { level: 1, name: 'Nutrikit documentation' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Authentication' }).getAttribute('href')).toBe('#authentication');
    expect(document.getElementById('authentication')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'API reference →' }).getAttribute('href')).toBe('/docs/reference');

    expect(await screen.findByText('Energy')).toBeTruthy();
    expect(screen.getByText('2000 kcal')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/v1/nutrients');
  });

  it('toggles the contents nav and reports a failed nutrient load', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    renderPage(<Docs />, { path: '/docs' });
    const toggle = screen.getByRole('button', { name: 'Contents ▾' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Documentation' }).className).toBe('docs-nav');
    expect(await screen.findByText('Could not load the nutrient list.')).toBeTruthy();
  });
});
