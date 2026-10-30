import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';
import { Pricing } from './Pricing.tsx';

describe('Pricing', () => {
  it('renders plans, token costs and FAQ', () => {
    renderPage(<Pricing />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pay for what you log.');
    expect(screen.getByText('what you log').tagName).toBe('EM');
    for (const name of ['Free', 'Growth', 'Enterprise']) expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy();
    expect(screen.getByText('Popular')).toBeTruthy();
    expect(screen.getByText('100,000 tokens / month')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start free' }).getAttribute('href')).toBe('/signup');
    expect(screen.getByText('What each call costs')).toBeTruthy();
    expect(screen.getByText('Do failed requests cost tokens?')).toBeTruthy();
    expect(document.title).toBe('Pricing — Nutrikit');
  });
});
