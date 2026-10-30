// Razorpay webhook: the signature is checked against the raw body, so this scope reads bodies as bytes.
import type { FastifyInstance } from 'fastify';
import { MAX_JSON } from '../http.ts';
import { verifyWebhook, applyEvent } from '../domain/billing.ts';

export async function webhookRoutes(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_JSON }, (_req, body, done) => done(null, body));

  app.post('/webhooks/razorpay', { schema: { hide: true } }, async (req) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const event = verifyWebhook(raw, req.headers['x-razorpay-signature'] as string | undefined);
    return { received: true, ...(await applyEvent(app.sql, event)) };
  });
}
