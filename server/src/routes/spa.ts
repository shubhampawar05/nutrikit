// The React app (web/dist, built by `npm run build -w web`) and the JS SDK.
// Files under dist are served as they are; any other GET that wants HTML and is not an API path gets
// index.html, so client-side routes such as /dashboard work. API paths keep their JSON 404/405.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_WEB_DIST = path.join(REPO, 'web/dist');
const API_PREFIXES = ['/v1/', '/portal/', '/webhooks/', '/openapi.json', '/sdk/'];

const SDK: Record<string, [string, string]> = {
  '/sdk/nutrikit.mjs': ['sdk/js/nutrikit.mjs', 'text/javascript; charset=utf-8'],
  '/sdk/nutrikit.d.ts': ['sdk/js/nutrikit.d.ts', 'text/plain; charset=utf-8'],
};

// Website pages: scripts only from this site and Razorpay Checkout (loaded when a payment starts), whose
// window is a frame; styles allow inline (React style attributes, the Checkout overlay); product images come
// from Open Food Facts. nosniff and Referrer-Policy are set on every response in app.ts.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://checkout.razorpay.com",
  'frame-src https://api.razorpay.com https://checkout.razorpay.com',
  "connect-src 'self' https://lumberjack.razorpay.com",
  "img-src 'self' data: https://images.openfoodfacts.org https://*.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function pageHeaders(reply: FastifyReply) {
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
}

/** True for a browser navigation that the SPA should answer with index.html. */
export function wantsApp(req: FastifyRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = req.url.split('?')[0]!;
  if (API_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))) return false;
  // A missing file (/assets/app-old.js, /favicon.png) is a 404, not the app shell.
  if (pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname)) return false;
  return String(req.headers.accept || '').includes('text/html');
}

// ---------------------------------------------------------------- SEO
// web/src/seo.json, copied into dist by the web build, lists every page with its title, description and
// whether search engines may index it. The server puts those into each page's <head> so crawlers and link
// previews see them without running JavaScript; the app applies the same values on client-side navigation.

interface SeoPage { title: string; description: string; index: boolean; priority?: number }
interface Seo {
  site: { name: string; description: string; image: string; imageAlt: string; notFoundTitle: string };
  pages: Record<string, SeoPage>;
}

function loadSeo(webDist: string): Seo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(webDist, 'seo.json'), 'utf8')) as Seo;
  } catch {
    return null;
  }
}

const normalizePath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The site's public origin: NUTRIKIT_PUBLIC_URL, or the request's own (hosts such as Render set X-Forwarded-Proto). */
export function publicOrigin(req: FastifyRequest) {
  if (process.env.NUTRIKIT_PUBLIC_URL) return process.env.NUTRIKIT_PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0]!.trim();
  return `${proto}://${req.headers.host}`;
}

/** index.html with this page's head tags, and whether the page exists. */
export function renderPage(html: string, seo: Seo, pathname: string, origin: string) {
  const here = normalizePath(pathname);
  const page = seo.pages[here];
  const title = page?.title ?? seo.site.notFoundTitle;
  const description = page?.description ?? seo.site.description;
  const url = origin + here;
  const image = origin + seo.site.image;
  const meta = (attr: string, key: string, value: string) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    meta('name', 'robots', page?.index ? 'index, follow' : 'noindex, follow'),
    page ? `<link rel="canonical" href="${escapeHtml(url)}">` : '',
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', seo.site.name),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('property', 'og:image:alt', seo.site.imageAlt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
  ];
  if (here === '/') {
    const data = [
      { '@context': 'https://schema.org', '@type': 'Organization', name: seo.site.name, url: origin + '/', logo: `${origin}/icon-512.png` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: seo.site.name, url: origin + '/', description: seo.site.description },
    ];
    tags.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  }
  const head = tags.filter(Boolean).join('\n  ');
  const body = html.replace(/<meta name="description"[^>]*>\s*/i, '').replace(/<title>[\s\S]*?<\/title>/i, head);
  return { html: body, found: Boolean(page) };
}

/** Sends the app shell (index.html), or null when web/dist has not been built. Unknown pages get it with a 404. */
export function appShell(webDist: string) {
  const index = path.join(webDist, 'index.html');
  if (!fs.existsSync(index)) return null;
  const html = fs.readFileSync(index, 'utf8');
  const seo = loadSeo(webDist);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    pageHeaders(reply);
    reply.header('Cache-Control', 'no-cache');
    reply.type('text/html; charset=utf-8');
    if (!seo) return reply.send(html);
    const page = renderPage(html, seo, req.url.split('?')[0]!, publicOrigin(req));
    return reply.status(page.found ? 200 : 404).send(page.html);
  };
}

/** robots.txt and sitemap.xml, with absolute URLs for wherever the site is served. */
function crawlerRoutes(app: FastifyInstance, webDist: string) {
  const seo = loadSeo(webDist);
  if (!seo) return;
  const updated = fs.statSync(path.join(webDist, 'seo.json')).mtime.toISOString().slice(0, 10);
  app.get('/robots.txt', { schema: { hide: true } }, async (req, reply) => {
    reply.headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return ['User-agent: *', 'Allow: /', 'Disallow: /v1/', 'Disallow: /portal/', 'Disallow: /webhooks/', '', `Sitemap: ${publicOrigin(req)}/sitemap.xml`, ''].join('\n');
  });
  app.get('/sitemap.xml', { schema: { hide: true } }, async (req, reply) => {
    const origin = escapeHtml(publicOrigin(req));
    const urls = Object.entries(seo.pages)
      .filter(([, page]) => page.index)
      .map(([pathname, page]) => `  <url><loc>${origin}${pathname}</loc><lastmod>${updated}</lastmod><priority>${(page.priority ?? 0.5).toFixed(1)}</priority></url>`);
    reply.headers({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  });
}

export function spaRoutes(webDist: string) {
  return async function spa(app: FastifyInstance) {
    for (const [url, [rel, type]] of Object.entries(SDK)) {
      app.get(url, { schema: { hide: true } }, async (_req, reply) => {
        reply.headers({ 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        return reply.send(fs.readFileSync(path.join(REPO, rel)));
      });
    }

    const shell = appShell(webDist);
    if (!shell) return; // API only (tests, or development through the Vite server)
    crawlerRoutes(app, webDist);

    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false, // one route per built file; everything else reaches the not-found handler
      index: false,
      schemaHide: true,
      cacheControl: false,
      setHeaders: (reply, file) => {
        // Vite fingerprints everything under assets/, so those files never change.
        if (file.includes(`${path.sep}assets${path.sep}`)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        else reply.header('Cache-Control', 'no-cache');
        if (file.endsWith('.html')) pageHeaders(reply);
        else reply.header('X-Content-Type-Options', 'nosniff');
      },
    });
    app.get('/', { schema: { hide: true } }, shell);
  };
}
