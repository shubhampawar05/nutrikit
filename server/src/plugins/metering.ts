// API-key authentication, rate limiting and token metering for routes with `config.cost`.
// Before the body is read: authenticate, rate limit, then reserve the flat cost against the allowance
// (atomically: a call that doesn't fit is refused and its handler never runs).
// After the handler succeeds: settle to the actual cost (flat cost of the variant that ran + AI usage) and set
// X-Tokens-Charged / X-Tokens-Remaining. On failure: release the reservation, charging only AI tokens the
// provider reported before failing (refusal, truncation), and say so in X-Tokens-Charged.
// Handlers may return { costKey, body, usage } to pick the cost themselves (cost 'dynamic', which reserves the
// most expensive variant).
import type { FastifyInstance, FastifyReply, FastifyRequest, onErrorHookHandler, onRequestHookHandler, RouteHandlerMethod } from 'fastify';
import { HttpError } from '../http.ts';
import { COSTS, aiTokens, authenticate, rateLimit, reserve, settle, type Reservation } from '../domain/auth.ts';
import type { AIUsage } from '../domain/types.ts';

type CostKey = keyof typeof COSTS;
interface Dynamic { costKey: CostKey; body: unknown; usage?: AIUsage }

const isDynamic = (r: unknown): r is Dynamic => typeof r === 'object' && r !== null && 'costKey' in r;

// Per request: the reservation, and whether it has been settled (exactly once).
const pending = new WeakMap<FastifyRequest, Reservation>();

function chargeHeaders(reply: FastifyReply, bill: { tokens: number; remaining: number | null }) {
  reply.header('X-Tokens-Charged', String(bill.tokens));
  if (bill.remaining != null) reply.header('X-Tokens-Remaining', String(bill.remaining));
}

export function metering(app: FastifyInstance) {
  app.addHook('onRoute', (route) => {
    const cost = route.config?.cost;
    if (!cost) return;
    // 'dynamic' routes reserve their dearest variant (labels/parse: an image) and settle down.
    const reserveKey: CostKey = cost in COSTS ? cost as CostKey : 'labelImage';

    const guard: onRequestHookHandler = async (req) => {
      const key = await authenticate(app.sql, req.headers);
      if (!key) throw new HttpError(401, 'unauthorized', 'missing or invalid API key (Authorization: Bearer nk_...)');
      await rateLimit(app.sql, key);
      req.key = key;
      pending.set(req, await reserve(app.sql, key, COSTS[reserveKey]));
    };
    route.onRequest = [...[route.onRequest ?? []].flat(), guard];

    // Any failure after the reservation (validation, body limits, the handler): release it, keeping AI tokens.
    const release: onErrorHookHandler = async (req, reply, err) => {
      const reservation = pending.get(req);
      if (!reservation) return;
      pending.delete(req);
      const tokens = aiTokens((err as { usage?: AIUsage }).usage);
      const bill = await settle(app.sql, req.key, reservation, reserveKey, tokens);
      if (tokens > 0) chargeHeaders(reply, bill);
    };
    route.onError = [...[route.onError ?? []].flat(), release];

    const handler = route.handler as (this: FastifyInstance, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    route.handler = async function (this: FastifyInstance, req: FastifyRequest, reply: FastifyReply) {
      let result = await handler.call(this, req, reply);
      let charged = cost as CostKey;
      let aiUsage = (result as { usage?: AIUsage } | null)?.usage;
      if (isDynamic(result)) {
        charged = result.costKey;
        aiUsage = result.usage;
        result = result.body;
      }
      if (result && typeof result === 'object' && 'usage' in result && cost !== 'usage') delete (result as { usage?: unknown }).usage;
      const reservation = pending.get(req)!;
      pending.delete(req);
      chargeHeaders(reply, await settle(app.sql, req.key, reservation, charged, COSTS[charged] + aiTokens(aiUsage)));
      return result;
    } as RouteHandlerMethod;
  });
}
