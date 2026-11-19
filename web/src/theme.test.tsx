import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { THEME_COLORS, THEME_KEY, toggleTheme, useTheme } from './theme.ts';

function Probe() {
  return <span data-testid="theme">{useTheme()}</span>;
}

const html = document.documentElement;
const metaColors = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'));

describe('theme', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#f7f2e8" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#12110f" media="(prefers-color-scheme: dark)">';
  });
  afterEach(() => {
    localStorage.clear();
    // Back to following the system (light in jsdom) for the next test.
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: null }));
  });

  it('follows the system (light here), switches to dark, and switching back clears the pick', () => {
    render(<Probe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');

    act(() => toggleTheme());
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(metaColors()).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]); // browser chrome follows the pick

    act(() => toggleTheme());
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(html.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(metaColors()).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it('follows a theme picked in another tab', () => {
    render(<Probe />);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' })); });
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(html.dataset.theme).toBe('dark');
    // Toggling here now starts from the other tab's pick instead of overwriting it with a stale one.
    act(() => toggleTheme());
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('public/theme.js applies the same key and colours before paint', () => {
    const script = readFileSync(resolve(process.cwd(), 'public/theme.js'), 'utf8'); // tests run from web/
    delete html.dataset.theme;
    localStorage.setItem(THEME_KEY, 'dark');
    new Function(script)();
    expect(html.dataset.theme).toBe('dark');
    expect(metaColors()).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);

    localStorage.removeItem(THEME_KEY);
    new Function(script)();
    expect(html.dataset.theme).toBe('light'); // no pick: the system setting (light in jsdom)
    expect(metaColors()).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });
});
