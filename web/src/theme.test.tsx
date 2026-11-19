import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { toggleTheme, useTheme } from './theme.ts';

function Probe() {
  return <span data-testid="theme">{useTheme()}</span>;
}

describe('theme', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('follows the system (light here), switches to dark, and switching back clears the pick', () => {
    render(<Probe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');

    act(() => toggleTheme());
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('nk-theme')).toBe('dark');

    act(() => toggleTheme());
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('nk-theme')).toBeNull();
  });
});
