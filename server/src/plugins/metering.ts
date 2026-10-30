// API-key authentication, rate limiting and token metering for routes with `config.cost`.
// Before the body is read: authenticate, rate limit, and pre-check the allowance with the flat cost.
// After the handler succeeds: charge (flat cost + AI usage) and set X-Tokens-Charged / X-Tokens-Remaining.
// Handlers may return { costKey, body, usage } to pick the cost themselves (cost 'dynamic').
import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestHookHandler, RouteHandlerMethod } from 'fastify';
import { HttpError } from '../http.ts';
import { COSTS, authenticate, rateLimit, checkAllowance, charge } from '../domain/auth.ts';

type CostKey = keyof typeof COSTS;
interface AIUsage { inputTokens?: number; outputTokens?: number }
interface Dynamic { costKey: CostKey; body: unknown; usage?: AIUsage }

const isDynamic = (r: unknown): r is Dynamic => typeof r === 'object' && r !== null && 'costKey' in r;

export function metering(app: FastifyInstance) {
  app.addHook('onRoute', (route) => {
    const cost = route.config?.cost;
    if (!cost) return;

    const guard: onRequestHookHandler = async (req) => {
      const key = await authenticate(app.sql, req.headers);
      if (!key) throw new HttpError(401, 'unauthorized', 'missing or invalid API key (Authorization: Bearer nk_...)');
      await rateLimit(app.sql, key);
      await checkAllowance(app.sql, key, COSTS[cost as CostKey] ?? COSTS.labelImage);
      req.key = key;
    };
    route.onRequest = [...[route.onRequest ?? []].flat(), guard];

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
      const bill = await charge(app.sql, req.key, charged, COSTS[charged], aiUsage);
      reply.header('X-Tokens-Charged', String(bill.tokens));
      if (bill.remaining != null) reply.header('X-Tokens-Remaining', String(bill.remaining));
      return result;
    } as RouteHandlerMethod;
  });
}
