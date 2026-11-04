// Error JSON for every failure: { error: { code, message, fields? } }, plus Retry-After when set.
// Unknown paths are 404 not_found; a /v1 path that exists with another method is 405 method_not_allowed.
import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../http.ts';

interface AppError extends Partial<FastifyError> {
  status?: number;
  retryAfter?: number;
  fields?: Record<string, string>;
  /** Detail for the server log only (e.g. an upstream provider's error); never sent to the client. */
  logDetail?: string;
}

// Route URL pattern ('/v1/foods/:id(^\\d+$)/nutrients') -> regex for a concrete path.
function patternToRegex(url: string) {
  let out = '';
  for (let i = 0; i < url.length; i++) {
    if (url[i] === ':') {
      let j = i + 1;
      while (j < url.length && /\w/.test(url[j]!)) j++;
      if (url[j] === '(') {
        let depth = 0;
        let k = j;
        for (; k < url.length; k++) {
          if (url[k] === '(') depth++;
          else if (url[k] === ')' && --depth === 0) break;
        }
        out += `(?:${url.slice(j + 1, k).replace(/^\^/, '').replace(/\$$/, '')})`;
        i = k;
      } else {
        out += '[^/]+';
        i = j - 1;
      }
    } else {
      out += url[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

interface ValidationIssue { instancePath: string; keyword: string; message?: string; params: Record<string, unknown> }

// Schema failures read like the API's own messages: "`limit` must be <= 50", "`text` is required".
function validationMessage(issues: ValidationIssue[]) {
  const issue = issues[0]!;
  const field = issue.keyword === 'required'
    ? [issue.instancePath.slice(1), issue.params.missingProperty].filter(Boolean).join('.')
    : issue.instancePath.slice(1).replace(/\//g, '.');
  if (issue.keyword === 'required') return `\`${field}\` is required`;
  if (issue.keyword === 'pattern' && issue.params.pattern === '\\S') return `\`${field}\` must not be empty`;
  if (issue.keyword === 'enum') return `\`${field}\` must be one of ${(issue.params.allowedValues as unknown[]).join(', ')}`;
  return field ? `\`${field}\` ${issue.message}` : `body ${issue.message}`;
}

export interface ErrorHandlingOptions {
  /** Answers browser navigations that match no route (the SPA shell); returns false to decline. */
  fallback?: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | false;
}

export function errorHandling(app: FastifyInstance, { fallback }: ErrorHandlingOptions = {}) {
  const methodRoutes: { method: string; re: RegExp }[] = [];
  app.addHook('onRoute', (route) => {
    if (!route.config?.allow405) return;
    for (const method of [route.method].flat()) if (method !== 'HEAD') methodRoutes.push({ method, re: patternToRegex(route.url) });
  });

  app.setNotFoundHandler((req, reply) => {
    const answered = fallback?.(req, reply);
    if (answered) return answered;
    const pathname = req.url.split('?')[0]!;
    const allowed = methodRoutes.filter((r) => r.re.test(pathname)).map((r) => r.method);
    if (allowed.length) throw new HttpError(405, 'method_not_allowed', `use ${allowed.join(', ')}`);
    throw new HttpError(404, 'not_found', `no route for ${pathname}`);
  });

  app.setErrorHandler((err: AppError, req, reply) => {
    let status = err.status || err.statusCode || 500;
    let code = err instanceof HttpError || !String(err.code || '').startsWith('FST_') ? err.code : undefined;
    let message = err.message || '';
    if (err.validation) {
      status = 400;
      code = 'invalid_request';
      message = validationMessage(err.validation as unknown as ValidationIssue[]);
    } else if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      status = 413;
      code = 'payload_too_large';
      message = `request body exceeds ${req.routeOptions.bodyLimit} bytes`;
    }
    if (status >= 500 && status !== 501 && status !== 502 && status !== 503 && status !== 504) req.log.error({ err }, 'unhandled error');
    else if (err.logDetail) req.log.warn({ code, detail: err.logDetail }, err.message);
    if (err.retryAfter) reply.header('Retry-After', String(err.retryAfter));
    const error: { code: string; message: string; fields?: Record<string, string> } = {
      code: code || (status === 500 ? 'internal_error' : status === 400 ? 'invalid_request' : 'error'),
      message: status === 500 ? 'internal server error' : message,
    };
    if (err.fields) error.fields = err.fields;
    return reply.status(status).send({ error });
  });
}
