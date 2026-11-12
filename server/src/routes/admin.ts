// Operator API under /v1/admin (Authorization: Bearer $NUTRIKIT_ADMIN_TOKEN).
import type { FastifyInstance } from 'fastify';
import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HttpError } from '../http.ts';
import { errors } from '../schemas.ts';
import { isAdmin, createKey, revokeKey } from '../domain/auth.ts';
import { overview, listAccounts, listPayments, listKeysWithOwners } from '../domain/admin.ts';
import { PLANS, listUpgradeRequests, setPlan } from '../domain/accounts.ts';

export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const sql = fastify.sql;
  const security = [{ admin: [] }];

  app.addHook('onRequest', async (req) => {
    if (!isAdmin(req.headers)) throw new HttpError(401, 'unauthorized', 'admin token required');
  });

  app.post('/v1/admin/keys', {
    schema: {
      summary: 'Create an API key (admin)', security,
      body: Type.Object({ name: Type.String({ minLength: 1 }), tokenLimit: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])) }),
      response: { 201: { description: 'Created; the plaintext key is only returned here', type: 'object' }, ...errors(400, 401) },
    },
  }, async (req, reply) => {
    reply.status(201);
    return createKey(sql, { name: req.body.name, tokenLimit: req.body.tokenLimit ?? null });
  });

  const search = Type.Object({ q: Type.Optional(Type.String({ maxLength: 200, description: 'Filter by email or name (substring)' })) });
  const list = (description: string) => ({ 200: { description, type: 'object' }, ...errors(401) });

  app.get('/v1/admin/keys', {
    schema: { summary: "List API keys with their owner's email (admin)", description: 'Active keys first, newest first; at most 200.', security, querystring: search, response: list('OK') },
  }, async (req) => ({ keys: await listKeysWithOwners(sql, req.query.q) }));

  app.get('/v1/admin/overview', {
    schema: { summary: 'Accounts, plans, payments and usage at a glance (admin)', security, response: list('OK') },
  }, async () => overview(sql));

  app.get('/v1/admin/metrics', {
    schema: {
      summary: 'Request, latency, memory and alert metrics for this instance (admin)',
      description: 'Counted in memory since this process started; each instance reports its own. `?format=prometheus` returns the Prometheus text format for a scraper.',
      security,
      querystring: Type.Object({ format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('prometheus')])) }),
      response: list('OK'),
    },
  }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (req.query.format === 'prometheus') return reply.type('text/plain; version=0.0.4').send(fastify.monitor.prometheus());
    return fastify.monitor.snapshot();
  });

  app.get('/v1/admin/accounts', {
    schema: { summary: 'List accounts with plan, paid-until, keys, usage and payments (admin)', description: 'Newest first; at most 200.', security, querystring: search, response: list('OK') },
  }, async (req) => ({ accounts: await listAccounts(sql, req.query.q) }));

  app.get('/v1/admin/payments', {
    schema: { summary: 'List Razorpay payments with the paying account (admin)', description: 'Newest first; at most 200. Amounts in rupees.', security, querystring: search, response: list('OK') },
  }, async (req) => ({ payments: await listPayments(sql, req.query.q) }));

  app.get('/v1/admin/upgrade-requests', {
    schema: { summary: 'List plan upgrade requests (admin)', security, response: { 200: { description: 'OK', type: 'object' }, ...errors(401) } },
  }, async () => ({ requests: await listUpgradeRequests(sql) }));

  app.post('/v1/admin/accounts/:id(^acct_[a-f0-9]+$)/plan', {
    schema: {
      summary: "Change an account's plan (admin)", security,
      params: Type.Object({ id: Type.String() }),
      // Unknown plans are rejected by setPlan with its own error code (invalid_plan).
      body: Type.Object({ plan: Type.String({ description: `One of ${Object.keys(PLANS).join(', ')}` }) }),
      response: { 200: { description: 'Updated', type: 'object' }, ...errors(400, 401, 404) },
    },
  }, async (req) => {
    if (!(await setPlan(sql, req.params.id, req.body.plan))) throw new HttpError(404, 'not_found', 'account not found');
    return { account: req.params.id, plan: req.body.plan };
  });

  app.delete('/v1/admin/keys/:id(^key_[a-f0-9]+$)', {
    schema: { summary: 'Revoke an API key (admin)', security, params: Type.Object({ id: Type.String() }), response: { 200: { description: 'Revoked', type: 'object' }, ...errors(401, 404) } },
  }, async (req) => {
    if (!(await revokeKey(sql, req.params.id))) throw new HttpError(404, 'not_found', 'key not found or already revoked');
    return { revoked: req.params.id };
  });
}
