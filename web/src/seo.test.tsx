import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { act } from '@testing-library/react';
import { renderPage } from './test-utils.tsx';
import { normalizePath, pageMeta, usePageMeta } from './seo.ts';
import seo from './seo.json';

function Head() {
  usePageMeta();
  return null;
}

const head = () => ({
  title: document.title,
  description: document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content,
  robots: document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
  canonical: document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href'),
});

describe('page metadata', () => {
  it('applies the title, description, canonical URL and robots rule for the route', async () => {
    await act(async () => { renderPage(<Routes><Route path="*" element={<Head />} /></Routes>, { path: '/docs/' }); });
    expect(head()).toEqual({
      title: 'Documentation — Nutrikit Nutrition API',
      description: seo.pages['/docs'].description,
      robots: 'index, follow',
      canonical: `${location.origin}/docs`,
    });
  });

  it('keeps private and unknown pages out of search results', () => {
    expect(pageMeta('/dashboard')).toMatchObject({ title: 'Dashboard — Nutrikit', index: false, found: true });
    expect(pageMeta('/no-such-page')).toMatchObject({ title: 'Page not found — Nutrikit', index: false, found: false });
    expect(normalizePath('/docs/')).toBe('/docs');
  });

  it('has a distinct title and a search-friendly description for every page', () => {
    const pages = Object.values(seo.pages);
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
    for (const p of pages) {
      expect(p.title.length).toBeLessThanOrEqual(70);
      expect(p.description.length).toBeLessThanOrEqual(170);
    }
  });
});
