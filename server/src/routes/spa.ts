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

function pageHeaders(reply: FastifyReply) {
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
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

/** Sends the app shell (index.html), or null when web/dist has not been built. */
export function appShell(webDist: string) {
  const index = path.join(webDist, 'index.html');
  if (!fs.existsSync(index)) return null;
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    pageHeaders(reply);
    reply.header('Cache-Control', 'no-cache');
    reply.type('text/html; charset=utf-8');
    return reply.send(fs.readFileSync(index));
  };
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
