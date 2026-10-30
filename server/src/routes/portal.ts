// Developer portal API under /portal/api: session cookie, CSRF header, no CORS.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, bad, jsonBody } from '../http.ts';
import * as auth from '../domain/auth.ts';
import * as accounts from '../domain/accounts.ts';
import * as billing from '../domain/billing.ts';
import { logText } from '../domain/textlog.ts';

const SESSION_COOKIE = 'nk_session';

function cookies(req: FastifyRequest): Record<string, string> {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k)
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function sessionCookie(token: string | null, expires?: Date) {
  const secure = process.env.NUTRIKIT_SECURE_COOKIES === '1' ? '; Secure' : '';
  return token
    ? `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires!.toUTCString()}${secure}`
    : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

interface KeyRow { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null; usedThisMonth: number }

function publicKey(k: KeyRow) {
  return { id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, usedThisMonth: k.usedThisMonth };
}

function intParam(v: unknown, def: number, min: number, max: number) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`expected an integer between ${min} and ${max}`);
  return n;
}

export async function portalRoutes(app: FastifyInstance) {
  const sql = app.sql;

  async function accountView(account: accounts.Account) {
    const plan = account.planDetails;
    const used = await auth.accountUsedThisMonth(sql, account.id);
    return {
      account: { id: account.id, name: account.name, email: account.email, createdAt: account.createdAt },
      plan: { id: account.plan, ...plan, expiresAt: account.planExpiresAt },
      usage: { periodStart: auth.monthStart(), used, remaining: plan.monthlyTokens == null ? null : Math.max(plan.monthlyTokens - used, 0) },
    };
  }

  // The homepage's live demo: text logging only, no account, short input, rate limited per IP.
  async function demoLimit(req: FastifyRequest) {
    try {
      await auth.hitRateLimit(sql, `demo:${req.socket.remoteAddress || 'unknown'}`, 20);
    } catch (err) {
      if ((err as { code?: string }).code !== 'rate_limited') throw err;
      throw new HttpError(429, 'rate_limited', 'demo limit reached; create a free key for more', { retryAfter: 60 });
    }
  }

  // CSRF: state-changing portal calls must carry a header a cross-site form cannot set.
  app.addHook('onRequest', async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-nutrikit-portal'] !== '1') throw new HttpError(403, 'csrf', 'missing X-Nutrikit-Portal header');
  });
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); });

  // Routes that need a signed-in developer.
  const signedIn = {
    onRequest: async (req: FastifyRequest) => {
      const account = await accounts.sessionAccount(sql, cookies(req)[SESSION_COOKIE]);
      if (!account) throw new HttpError(401, 'unauthorized', 'please log in');
      req.account = account;
    },
    schema: { hide: true },
  };
  const open = { schema: { hide: true } };

  app.post('/portal/api/demo', open, async (req) => {
    await demoLimit(req);
    const body = jsonBody(req);
    if (typeof body.text !== 'string' || !body.text.trim()) throw bad('`text` is required');
    if (body.text.length > 200) throw bad('the demo accepts up to 200 characters');
    return logText(body.text);
  });

  app.post('/portal/api/signup', open, async (req, reply) => {
    const account = await accounts.createAccount(sql, jsonBody(req) as { name: string; email: string; password: string });
    const key = await auth.createKey(sql, { name: 'Default key', accountId: account.id });
    const session = await accounts.createSession(sql, account.id);
    reply.status(201).header('Set-Cookie', sessionCookie(session.token, session.expires));
    return { ...(await accountView(account)), firstKey: { id: key.id, name: key.name, key: key.key } };
  });

  app.post('/portal/api/login', open, async (req, reply) => {
    const account = await accounts.login(sql, jsonBody(req) as { email: string; password: string });
    const session = await accounts.createSession(sql, account.id);
    reply.header('Set-Cookie', sessionCookie(session.token, session.expires));
    return accountView(account);
  });

  app.post('/portal/api/logout', open, async (req, reply) => {
    await accounts.endSession(sql, cookies(req)[SESSION_COOKIE]);
    reply.header('Set-Cookie', sessionCookie(null));
    return { ok: true };
  });

  app.get('/portal/api/me', signedIn, async (req) => ({ ...(await accountView(req.account)), plans: accounts.PLANS, billing: billing.billingInfo() }));

  app.get('/portal/api/keys', signedIn, async (req) => ({ keys: (await auth.listKeys(sql, req.account.id) as KeyRow[]).map(publicKey) }));

  app.post('/portal/api/keys', signedIn, async (req, reply) => {
    const body = jsonBody(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled key';
    const { planDetails } = req.account;
    if (await auth.activeKeyCount(sql, req.account.id) >= planDetails.maxKeys) {
      throw new HttpError(403, 'key_limit', `your ${planDetails.name} plan allows ${planDetails.maxKeys} active keys; revoke one first`);
    }
    const key = await auth.createKey(sql, { name, accountId: req.account.id });
    reply.status(201);
    return { id: key.id, name: key.name, key: key.key };
  });

  app.delete('/portal/api/keys/:id(^key_[a-f0-9]+$)', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    if (!(await auth.revokeKey(sql, id, req.account.id))) throw new HttpError(404, 'not_found', 'key not found or already revoked');
    return { revoked: id };
  });

  app.get('/portal/api/usage', signedIn, async (req) => {
    const days = intParam((req.query as Record<string, unknown>).days, 30, 1, 90);
    const key = { id: null, accountId: req.account.id, tokenLimit: req.account.planDetails.monthlyTokens } as unknown as auth.KeyContext;
    return { series: await auth.usageSeries(sql, req.account.id, days), month: await auth.usageSummary(sql, key) };
  });

  app.post('/portal/api/playground-token', signedIn, async (req) => {
    // Signed-in developers try the API without pasting a key: mint a 1-hour token for their newest key.
    const key = await auth.newestActiveKey(sql, req.account.id);
    if (!key) throw new HttpError(409, 'no_active_key', 'create an API key in your dashboard first');
    return { ...(await auth.issueAccessToken(sql, key as auth.KeyContext)), key: { id: key.id, name: key.name } };
  });

  app.post('/portal/api/upgrade', signedIn, async (req, reply) => {
    const body = jsonBody(req);
    reply.status(201);
    return accounts.requestUpgrade(sql, req.account.id, body.plan as string, body.message as string | undefined);
  });

  // Self-serve paid plans (Razorpay one-time payments): create an order, then confirm what Checkout returns.
  app.post('/portal/api/billing/order', signedIn, async (req, reply) => {
    const body = jsonBody(req);
    reply.status(201);
    return billing.createOrder(req.account, body.plan as string);
  });

  app.post('/portal/api/billing/verify', signedIn, async (req) => {
    await billing.verifyPayment(sql, req.account, jsonBody(req));
    return accountView((await accounts.getAccount(sql, req.account.id))!);
  });
}
