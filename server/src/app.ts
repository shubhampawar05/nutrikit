// Fastify application factory. main.ts listens; tests build an app per file.
import crypto from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { createSql } from './pg.ts';
import { HttpError, IMAGE_TYPES, MAX_JSON, contentType } from './http.ts';
import { errorHandling } from './plugins/errors.ts';
import { metering } from './plugins/metering.ts';
import { monitoring } from './plugins/monitoring.ts';
import { registerSchemas } from './schemas.ts';
import { v1Routes } from './routes/v1.ts';
import { adminRoutes } from './routes/admin.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { portalRoutes } from './routes/portal.ts';
import { spaRoutes, appShell, wantsApp, DEFAULT_WEB_DIST } from './routes/spa.ts';

export interface AppOptions {
  /** Postgres connection string for the application store (default: DATABASE_URL). */
  databaseUrl?: string;
  /** Built React app (default: web/dist, or NUTRIKIT_WEB_DIST). Without one the server is API-only. */
  webDist?: string;
  /** Trusted proxies for req.ip (default: NUTRIKIT_TRUST_PROXY): a hop count, or addresses/CIDRs. */
  trustProxy?: number | string;
  /** Where JSON logs go (default stdout); tests capture them here. */
  logStream?: Writable;
  /** Log level (default: NUTRIKIT_LOG_LEVEL, else info). */
  logLevel?: string;
  /** Where alerts are posted (default: NUTRIKIT_ALERT_WEBHOOK_URL); see plugins/monitoring.ts. */
  alertWebhookUrl?: string;
}

// The public API is callable cross-origin with bearer credentials; the cookie-based portal is not.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, X-Api-Key, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Tokens-Charged, X-Tokens-Remaining, Retry-After, X-Request-Id',
};
const isPortal = (url: string) => url.startsWith('/portal/');

// A caller-supplied X-Request-Id is reused when it is safe to echo and to log.
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// Request logs carry only what the onResponse hook passes; these paths are redacted in case a header object
// is ever logged.
// NUTRIKIT_TRUST_PROXY: a hop count (for hosts where every request comes through the proxy, such as Render), or a
// comma-separated list of proxy addresses/CIDRs. Fastify reads a bare number as "trust nothing", so a count
// becomes a function trusting that many hops nearest the server.
function trustProxyOption(value: number | string | undefined) {
  const text = String(value ?? '').trim();
  if (!text || text === '0') return false;
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    return (_address: string, hop: number) => hop < hops;
  }
  return text;
}

const REDACT = ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'headers.authorization', 'headers.cookie', 'headers["x-api-key"]'];

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  // Scalars are coerced (query strings arrive as text), but a scalar never becomes an array.
  const app = Fastify({
    logger: { level: opts.logLevel || process.env.NUTRIKIT_LOG_LEVEL || 'info', redact: REDACT, ...(opts.logStream ? { stream: opts.logStream } : {}) },
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'requestId' }),
    genReqId: (req) => {
      const given = req.headers['x-request-id'];
      return typeof given === 'string' && REQUEST_ID.test(given) ? given : crypto.randomUUID();
    },
    trustProxy: trustProxyOption(opts.trustProxy ?? process.env.NUTRIKIT_TRUST_PROXY),
    bodyLimit: MAX_JSON,
    ajv: { customOptions: { coerceTypes: true } },
  });

  const sql = createSql(opts.databaseUrl);
  app.decorate('sql', sql);
  app.addHook('onClose', async () => { await sql.end({ timeout: 5 }); });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
    if (!isPortal(req.url)) reply.headers(CORS);
  });

  // Security headers on every response; HSTS once the site is HTTPS-only (secure cookies on).
  const hsts = process.env.NUTRIKIT_SECURE_COOKIES === '1';
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  // One line per request: never headers, bodies or credentials.
  app.addHook('onResponse', async (req, reply) => {
    const { key, account } = req as { key?: { id: string; accountId: string | null }; account?: { id: string } };
    req.log.info({
      method: req.method,
      route: req.routeOptions.url ?? null,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 10) / 10,
      ...(key ? { keyId: key.id, accountId: key.accountId } : account ? { accountId: account.id } : {}),
    }, 'request');
  });

  // Bodies: raw image/* uploads stay bytes; anything else is a JSON object, whatever its
  // Content-Type (as clients have always been able to send). The raw bytes are kept on the request.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    req.rawBody = body;
    if (IMAGE_TYPES.includes(contentType(req))) return done(null, body);
    if (!body.length) return done(null, {});
    try {
      const value = JSON.parse(body.toString('utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      done(null, value);
    } catch {
      done(new HttpError(400, 'invalid_request', 'body must be a JSON object'), undefined);
    }
  });
  app.addHook('preValidation', async (req) => {
    if (req.body === undefined && req.method !== 'GET' && req.method !== 'HEAD') req.body = {};
  });

  // Responses are plain JSON.stringify: response schemas document the API and never strip fields.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));

  registerSchemas(app);
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Nutrikit API',
        version: '0.1.0',
        description: 'Food search, nutrient breakdowns, meal logging from text/voice/photos, barcode and nutrition-label scanning, and meal plans. Data: USDA FoodData Central (public domain) and Open Food Facts (ODbL). Usage is metered in tokens; AI-assisted calls add 1 token per 1,000 model tokens.',
      },
      servers: [{ url: 'http://localhost:8787' }],
      security: [{ bearer: [] }],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', description: 'Secret API key `nk_...` (also accepted as X-Api-Key) or an access token `nkat_...` from POST /v1/auth/token' },
          admin: { type: 'http', scheme: 'bearer', description: 'NUTRIKIT_ADMIN_TOKEN' },
        },
      },
    },
    refResolver: { buildLocalReference: (json, _baseUri, _fragment, i) => String(json.$id || `def-${i}`) },
  });

  // Every registered route, for checks such as the OpenAPI coverage test.
  const routeTable: { method: string; url: string; hidden: boolean }[] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) routeTable.push({ method, url: route.url, hidden: Boolean((route.schema as { hide?: boolean } | undefined)?.hide) });
  });

  const webDist = opts.webDist || process.env.NUTRIKIT_WEB_DIST || DEFAULT_WEB_DIST;
  const shell = appShell(webDist);
  monitoring(app, { alertWebhookUrl: opts.alertWebhookUrl });
  errorHandling(app, { fallback: (req, reply) => (shell && wantsApp(req) ? shell(req, reply) : false) });
  metering(app);

  app.options('*', { schema: { hide: true } }, async (req, reply) => {
    if (isPortal(req.url)) throw new HttpError(404, 'not_found', `no route for ${req.url.split('?')[0]}`);
    return reply.status(204).send();
  });

  await app.register(v1Routes);
  await app.register(adminRoutes);
  await app.register(webhookRoutes);
  await app.register(portalRoutes);
  await app.register(spaRoutes(webDist));

  app.get('/openapi.json', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return app.swagger();
  });

  return app;
}
