// Fastify application factory. main.ts listens; tests build an app per file.
import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import { createSql } from './pg.ts';
import { HttpError, IMAGE_TYPES, MAX_JSON, contentType } from './http.ts';
import { errorHandling } from './plugins/errors.ts';
import { metering } from './plugins/metering.ts';
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
}

// The public API is callable cross-origin with bearer credentials; the cookie-based portal is not.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, X-Api-Key, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Tokens-Charged, X-Tokens-Remaining, Retry-After',
};
const isPortal = (url: string) => url.startsWith('/portal/');

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  // Scalars are coerced (query strings arrive as text), but a scalar never becomes an array.
  const app = Fastify({ logger: false, bodyLimit: MAX_JSON, ajv: { customOptions: { coerceTypes: true } } });

  const sql = createSql(opts.databaseUrl);
  app.decorate('sql', sql);
  app.addHook('onClose', async () => { await sql.end({ timeout: 5 }); });

  app.addHook('onRequest', async (req, reply) => {
    if (!isPortal(req.url)) reply.headers(CORS);
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
