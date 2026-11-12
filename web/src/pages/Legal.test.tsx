import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test-utils.tsx';
import { Privacy, Terms } from './Legal.tsx';
import { CONTACT_EMAIL, OPERATOR } from '../legal.ts';
import seo from '../seo.json';

describe('legal pages', () => {
  it('have a real contact address before they ship', () => {
    expect(CONTACT_EMAIL, 'set CONTACT_EMAIL in web/src/legal.ts to an inbox someone reads').not.toMatch(/example\.com|REPLACE/i);
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(OPERATOR.trim()).not.toBe('');
  });

  it('privacy policy: what is collected, who handles it, and how to delete it', async () => {
    renderPage(<Privacy />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy policy' })).toBeTruthy();
    for (const section of ['Who we are', 'What we collect', 'Who else handles it', 'How long we keep it', 'Your rights']) {
      expect(screen.getByRole('heading', { name: section })).toBeTruthy();
    }
    expect(screen.getByText(/Dashboard → Delete account/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: CONTACT_EMAIL })[0]!.getAttribute('href')).toBe(`mailto:${CONTACT_EMAIL}`);
  });

  it('terms: link to the privacy policy and say results are not medical advice', async () => {
    renderPage(<Terms />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of use' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Not medical advice' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'privacy policy' })[0]!.getAttribute('href')).toBe('/privacy');
  });

  it('are listed for search engines', () => {
    expect(seo.pages['/privacy'].index).toBe(true);
    expect(seo.pages['/terms'].index).toBe(true);
  });
});
