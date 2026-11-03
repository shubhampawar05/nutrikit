// Page titles, descriptions and indexing rules. seo.json is the one source: the server reads the copy
// emitted into dist/ to render each page's <head> for crawlers and link previews, and the app applies the
// same values on client-side navigation.
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import seo from './seo.json';

export interface PageMeta { title: string; description: string; index: boolean; found: boolean }

/** /docs/ and /docs are the same page. */
export const normalizePath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';

export function pageMeta(pathname: string): PageMeta {
  const page = (seo.pages as Record<string, { title: string; description: string; index: boolean }>)[normalizePath(pathname)];
  if (!page) return { title: seo.site.notFoundTitle, description: seo.site.description, index: false, found: false };
  return { ...page, found: true };
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Keeps <head> in step with the current route. */
export function usePageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = pageMeta(pathname);
    const url = location.origin + normalizePath(pathname);
    document.title = meta.title;
    setMeta('name', 'description', meta.description);
    setMeta('name', 'robots', meta.index ? 'index, follow' : 'noindex, follow');
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:url', url);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [pathname]);
}
