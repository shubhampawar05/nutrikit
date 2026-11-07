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

  it('describes charging, errors and the changelog as the API behaves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage(<Docs />, { path: '/docs' });
    const section = (id: string) => document.getElementById(id)!.textContent ?? '';

    expect(section('tokens')).toContain('Failed calls are free, except AI usage the server\'s AI provider had already consumed');
    expect(section('tokens')).toContain('Every metered response carries');
    expect(section('labels')).toContain('reserves the photo cost (20 tokens)');
    expect(section('labels')).toContain('settles to 5 tokens');

    const timeout = screen.getByText('ai_timeout').closest('tr')!;
    expect(timeout.textContent).toMatch(/^504ai_timeout/);
    expect(timeout.textContent).toContain('Retry');

    const v13 = screen.getByText('v1.3').closest('li')!.textContent ?? '';
    for (const text of ['X-Request-Id', '/v1/health/ready', 'atomically', 'AI usage already consumed', '504 ai_timeout', 'add-on portions', 'chai', 'fries', 'near-duplicate search results']) {
      expect(v13).toContain(text);
    }
    const v14 = screen.getByText('v1.4').closest('li')!.textContent ?? '';
    for (const text of ['match', 'unmatched', 'suggestions', 'missingFrom']) {
      expect(v14).toContain(text);
    }
    expect(document.body.textContent).not.toMatch(/Claude|Anthropic/);
  });

  it('makes the h1 the first heading (nav group titles are not headings)', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderPage(<Docs />, { path: '/docs' });
    const first = document.querySelector('h1, h2, h3, h4, h5, h6');
    expect(first?.tagName).toBe('H1');
    const nav = screen.getByRole('navigation', { name: 'Documentation' });
    expect(nav.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect([...nav.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Getting started', 'Guides', 'SDK', 'Platform', 'Reference']);
  });
});
