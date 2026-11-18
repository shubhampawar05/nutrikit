// Developer portal API under /portal/api: session cookie, CSRF header, no CORS.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, bad, jsonBody } from '../http.ts';
import * as auth from '../domain/auth.ts';
import * as accounts from '../domain/accounts.ts';
import * as billing from '../domain/billing.ts';
import * as teams from '../domain/teams.ts';
import { logText } from '../domain/textlog.ts';
import { publicOrigin } from './spa.ts';

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

function publicKey(k: auth.KeySummary) {
  return { id: k.id, name: k.name, mode: k.mode, createdBy: k.createdBy, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, usedThisMonth: k.usedThisMonth };
}

const keyModeParam = (v: unknown): auth.KeyMode => {
  if (v == null || v === '') return 'live';
  if (v !== 'live' && v !== 'test') throw bad('`mode` must be "live" or "test"');
  return v;
};

function intParam(v: unknown, def: number, min: number, max: number) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`expected an integer between ${min} and ${max}`);
  return n;
}

export async function portalRoutes(app: FastifyInstance) {
  const sql = app.sql;

  // What the dashboard shows for the signed-in user in their current team. `account` keeps its old fields (name and
  // email of the person) for older clients; `team` is the team itself.
  async function accountView(user: accounts.User, account: accounts.Account, role: accounts.Role) {
    const plan = account.planDetails;
    const [used, testUsed, teams] = await Promise.all([
      auth.accountUsedThisMonth(sql, account.id),
      auth.accountUsedThisMonth(sql, account.id, 'test'),
      accounts.userTeams(sql, user.id),
    ]);
    const testLimit = auth.testAllowance();
    return {
      account: { id: account.id, name: user.name, email: user.email, emailVerified: user.emailVerified, createdAt: user.createdAt },
      user: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, createdAt: user.createdAt },
      team: { id: account.id, name: account.name, role, createdAt: account.createdAt },
      teams,
      plan: { id: account.plan, ...(accounts.publicPlans()[account.plan] ?? { ...plan, rank: 0 }), expiresAt: account.planExpiresAt },
      usage: { periodStart: auth.monthStart(), used, remaining: plan.monthlyTokens == null ? null : Math.max(plan.monthlyTokens - used, 0) },
      testUsage: { used: testUsed, limit: testLimit, remaining: Math.max(testLimit - testUsed, 0) },
    };
  }

  /** The view for a user right after they sign in (session just created in `accountId`, or their oldest team). */
  async function viewFor(token: string) {
    const ctx = (await accounts.sessionContext(sql, token))!;
    return accountView(ctx.user, ctx.account, ctx.role);
  }

  const requireRole = (allowed: boolean, message?: string) => {
    if (!allowed) throw new HttpError(403, 'forbidden', message ?? 'your role in this team does not allow this');
  };

  // The homepage's live demo: text logging only, no account, short input, rate limited per IP.
  async function demoLimit(req: FastifyRequest) {
    try {
      await auth.hitRateLimit(sql, `demo:${req.ip}`, 20);
    } catch (err) {
      if ((err as { code?: string }).code !== 'rate_limited') throw err;
      throw new HttpError(429, 'rate_limited', 'demo limit reached; create a free key for more', { retryAfter: 60 });
    }
  }

  // CSRF: state-changing portal calls must carry a header a cross-site form cannot set.
  app.addHook('onRequest', async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-nutrikit-portal'] !== '1') throw new HttpError(403, 'csrf', 'missing X-Nutrikit-Portal header');
  });
  app.addHook('onSend', async (_req, reply) => { if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store'); });

  // Routes that need a signed-in developer.
  const signedIn = {
    onRequest: async (req: FastifyRequest) => {
      const token = cookies(req)[SESSION_COOKIE];
      const ctx = await accounts.sessionContext(sql, token);
      if (!ctx) throw new HttpError(401, 'unauthorized', 'please log in');
      req.account = ctx.account;
      req.user = ctx.user;
      req.role = ctx.role;
      req.sessionToken = token!;
    },
    schema: { hide: true },
  };
  const open = { schema: { hide: true } };

  // Public: the pricing page reads the plans the server actually sells.
  app.get('/portal/api/plans', open, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { plans: accounts.publicPlans(), currency: accounts.CURRENCY };
  });

  app.post('/portal/api/demo', open, async (req) => {
    await demoLimit(req);
    const body = jsonBody(req);
    if (typeof body.text !== 'string' || !body.text.trim()) throw bad('`text` is required');
    if (body.text.length > 200) throw bad('the demo accepts up to 200 characters');
    return logText(body.text);
  });

  app.post('/portal/api/signup', open, async (req, reply) => {
    const { user, account } = await accounts.signup(sql, jsonBody(req) as { name: string; email: string; password: string }, { ip: req.ip });
    const key = await auth.createKey(sql, { name: 'Default key', accountId: account.id, createdBy: user.id });
    const session = await accounts.createSession(sql, user.id, account.id);
    // A mail outage never fails a signup: the dashboard offers to send the link again.
    await accounts.sendVerification(sql, user, publicOrigin(req), { ip: req.ip })
      .catch((err: Error) => req.log.error({ err: err.message }, 'verification email not sent'));
    reply.status(201).header('Set-Cookie', sessionCookie(session.token, session.expires));
    return { ...(await accountView(user, account, 'owner')), firstKey: { id: key.id, name: key.name, mode: key.mode, key: key.key } };
  });

  // Forgotten password: the same answer whether or not the address has an account.
  app.post('/portal/api/password/forgot', open, async (req) => {
    await accounts.requestPasswordReset(sql, jsonBody(req).email, publicOrigin(req), { ip: req.ip })
      .catch((err: Error & { status?: number }) => {
        if (err.status) throw err; // invalid address or too many requests from this network
        req.log.error({ err: err.message }, 'password reset email not sent');
      });
    return { ok: true };
  });

  // A reset link sets a new password, ends every other session and signs the user in.
  app.post('/portal/api/password/reset', open, async (req, reply) => {
    const body = jsonBody(req);
    const user = await accounts.resetPassword(sql, body.token, body.password);
    const session = await accounts.createSession(sql, user.id);
    reply.header('Set-Cookie', sessionCookie(session.token, session.expires));
    return viewFor(session.token);
  });

  app.post('/portal/api/email/verify', open, async (req) => ({ verified: true, ...(await accounts.verifyEmail(sql, jsonBody(req).token)) }));

  app.post('/portal/api/login', open, async (req, reply) => {
    const user = await accounts.login(sql, jsonBody(req) as { email: string; password: string }, { ip: req.ip });
    const session = await accounts.createSession(sql, user.id);
    reply.header('Set-Cookie', sessionCookie(session.token, session.expires));
    return viewFor(session.token);
  });

  app.post('/portal/api/logout', open, async (req, reply) => {
    await accounts.endSession(sql, cookies(req)[SESSION_COOKIE]);
    reply.header('Set-Cookie', sessionCookie(null));
    return { ok: true };
  });

  app.post('/portal/api/email/verification', signedIn, async (req) => {
    if (req.user.emailVerified) return { verified: true };
    const result = await accounts.sendVerification(sql, req.user, publicOrigin(req), { ip: req.ip }).catch((err: Error & { status?: number }) => {
      if (err.status) throw err;
      req.log.error({ err: err.message }, 'verification email not sent');
      throw new HttpError(503, 'email_unavailable', 'the email could not be sent; try again later');
    });
    if (result.retryAfter) throw new HttpError(429, 'too_many_emails', 'a link was sent recently; check your inbox or try again later', { retryAfter: result.retryAfter });
    return { sent: true };
  });

  // Deletes the signed-in user (and teams where they are the only member) after re-entering the password, and signs out.
  app.post('/portal/api/account/delete', signedIn, async (req, reply) => {
    const { deletedTeams } = await accounts.deleteAccount(sql, req.user.id, jsonBody(req).password, { ip: req.ip });
    req.log.info({ userId: req.user.id, deletedTeams }, 'account deleted');
    reply.header('Set-Cookie', sessionCookie(null));
    return { deleted: true };
  });

  app.get('/portal/api/me', signedIn, async (req) => ({ ...(await accountView(req.user, req.account, req.role)), plans: accounts.publicPlans(), billing: billing.billingInfo() }));

  // ---- Teams ----

  app.post('/portal/api/teams', signedIn, async (req, reply) => {
    const accountId = await accounts.createOwnedTeam(sql, req.user.id, jsonBody(req).name);
    await accounts.switchTeam(sql, req.sessionToken, req.user.id, accountId);
    reply.status(201);
    return viewFor(req.sessionToken);
  });

  app.post('/portal/api/teams/switch', signedIn, async (req) => {
    const { accountId } = jsonBody(req);
    if (typeof accountId !== 'string' || !(await accounts.switchTeam(sql, req.sessionToken, req.user.id, accountId))) {
      throw new HttpError(404, 'not_found', 'team not found');
    }
    return viewFor(req.sessionToken);
  });

  app.patch('/portal/api/team', signedIn, async (req) => {
    requireRole(teams.can.manageTeam(req.role), 'only an owner can rename the team');
    await accounts.renameTeam(sql, req.account.id, jsonBody(req).name);
    return viewFor(req.sessionToken);
  });

  app.get('/portal/api/members', signedIn, async (req) => ({
    members: await teams.listMembers(sql, req.account.id),
    invitations: await teams.listInvitations(sql, req.account.id),
    maxMembers: req.account.planDetails.maxMembers,
  }));

  app.patch('/portal/api/members/:userId(^usr_[a-f0-9]+$)', signedIn, async (req) => {
    const { userId } = req.params as { userId: string };
    await teams.changeRole(sql, req.account.id, req.role, userId, jsonBody(req).role);
    return { members: await teams.listMembers(sql, req.account.id) };
  });

  // Removes a member, or leaves the team when it is the signed-in user.
  app.delete('/portal/api/members/:userId(^usr_[a-f0-9]+$)', signedIn, async (req) => {
    const { userId } = req.params as { userId: string };
    await teams.removeMember(sql, req.account.id, { userId: req.user.id, role: req.role }, userId);
    return { removed: userId, left: userId === req.user.id };
  });

  app.post('/portal/api/invitations', signedIn, async (req, reply) => {
    const body = jsonBody(req);
    const invitation = await teams.invite(sql, {
      account: req.account, inviter: req.user, inviterRole: req.role, email: body.email, role: body.role, origin: publicOrigin(req),
    }).catch((err: Error & { status?: number }) => {
      if (err.status) throw err;
      req.log.error({ err: err.message }, 'invitation email not sent');
      throw new HttpError(503, 'email_unavailable', 'the invitation email could not be sent; try again later');
    });
    reply.status(201);
    return invitation;
  });

  app.delete('/portal/api/invitations/:id(^[a-f0-9]{12}$)', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    if (!(await teams.revokeInvitation(sql, req.account.id, req.role, id))) throw new HttpError(404, 'not_found', 'invitation not found or already used');
    return { revoked: id };
  });

  // Public: what an invitation link offers, so the page can say it before the visitor signs in.
  app.get('/portal/api/invitations/:token(^[A-Za-z0-9_-]{20,100}$)', open, async (req) => teams.previewInvitation(sql, (req.params as { token: string }).token));

  app.post('/portal/api/invitations/:token(^[A-Za-z0-9_-]{20,100}$)/accept', signedIn, async (req) => {
    const accountId = await teams.acceptInvitation(sql, (req.params as { token: string }).token, req.user);
    await accounts.switchTeam(sql, req.sessionToken, req.user.id, accountId);
    return viewFor(req.sessionToken);
  });

  // ---- Keys ----
  // Everyone in the team sees its keys and manages test keys; live keys need an owner or admin.

  app.get('/portal/api/keys', signedIn, async (req) => ({ keys: (await auth.listKeys(sql, req.account.id)).map(publicKey) }));

  app.post('/portal/api/keys', signedIn, async (req, reply) => {
    const body = jsonBody(req);
    const mode = keyModeParam(body.mode);
    if (mode === 'live') requireRole(teams.can.manageLiveKeys(req.role), 'developers can create test keys; ask an owner or admin for a live key');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : (mode === 'test' ? 'Untitled test key' : 'Untitled key');
    const { planDetails } = req.account;
    if (await auth.activeKeyCount(sql, req.account.id, mode) >= planDetails.maxKeys) {
      throw new HttpError(403, 'key_limit', `your ${planDetails.name} plan allows ${planDetails.maxKeys} active ${mode} keys; revoke one first`);
    }
    const key = await auth.createKey(sql, { name, accountId: req.account.id, mode, createdBy: req.user.id });
    reply.status(201);
    return { id: key.id, name: key.name, mode: key.mode, key: key.key };
  });

  async function checkKeyAccess(req: FastifyRequest, id: string) {
    const mode = await auth.keyMode(sql, id, req.account.id);
    if (!mode) throw new HttpError(404, 'not_found', 'key not found or already revoked');
    if (mode === 'live') requireRole(teams.can.manageLiveKeys(req.role), 'only an owner or admin can change live keys');
  }

  app.delete('/portal/api/keys/:id(^key_[a-f0-9]+$)', signedIn, async (req) => {
    const { id } = req.params as { id: string };
    await checkKeyAccess(req, id);
    if (!(await auth.revokeKey(sql, id, req.account.id))) throw new HttpError(404, 'not_found', 'key not found or already revoked');
    return { revoked: id };
  });

  // Keys are stored only as hashes, so a lost key can't be shown again: this swaps it for a new one instead.
  app.post('/portal/api/keys/:id(^key_[a-f0-9]+$)/regenerate', signedIn, async (req, reply) => {
    const { id } = req.params as { id: string };
    await checkKeyAccess(req, id);
    const key = await auth.regenerateKey(sql, id, req.account.id, req.user.id);
    if (!key) throw new HttpError(404, 'not_found', 'key not found or already revoked');
    reply.status(201);
    return { id: key.id, name: key.name, mode: key.mode, key: key.key, replaced: id };
  });

  app.get('/portal/api/usage', signedIn, async (req) => {
    const days = intParam((req.query as Record<string, unknown>).days, 30, 1, 90);
    const key = { id: null, accountId: req.account.id, mode: 'live', tokenLimit: req.account.planDetails.monthlyTokens } as unknown as auth.KeyContext;
    return { series: await auth.usageSeries(sql, req.account.id, days), month: await auth.usageSummary(sql, key) };
  });

  app.post('/portal/api/playground-token', signedIn, async (req) => {
    // Signed-in developers try the API without pasting a key: mint a 1-hour token for the team's newest key (owners
    // and admins: live first; developers: test keys only).
    const key = teams.can.manageLiveKeys(req.role)
      ? (await auth.newestActiveKey(sql, req.account.id, 'live')) ?? await auth.newestActiveKey(sql, req.account.id, 'test')
      : await auth.newestActiveKey(sql, req.account.id, 'test');
    if (!key) throw new HttpError(409, 'no_active_key', teams.can.manageLiveKeys(req.role) ? 'create an API key in your dashboard first' : 'create a test key in your dashboard first');
    return { ...(await auth.issueAccessToken(sql, key as auth.KeyContext)), key: { id: key.id, name: key.name, mode: key.mode } };
  });

  app.post('/portal/api/upgrade', signedIn, async (req, reply) => {
    requireRole(teams.can.manageTeam(req.role), 'only an owner can change the plan');
    const body = jsonBody(req);
    reply.status(201);
    return accounts.requestUpgrade(sql, req.account.id, body.plan as string, body.message as string | undefined);
  });

  // Self-serve paid plans (Razorpay one-time payments): create an order, then confirm what Checkout returns.
  app.post('/portal/api/billing/order', signedIn, async (req, reply) => {
    requireRole(teams.can.manageTeam(req.role), 'only an owner can change the plan');
    const body = jsonBody(req);
    reply.status(201);
    return billing.createOrder(req.account, body.plan as string);
  });

  app.post('/portal/api/billing/verify', signedIn, async (req) => {
    requireRole(teams.can.manageTeam(req.role), 'only an owner can change the plan');
    await billing.verifyPayment(sql, req.account, jsonBody(req));
    return viewFor(req.sessionToken);
  });
}
