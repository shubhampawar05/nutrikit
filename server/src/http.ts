// Shared HTTP helpers: the API's error type and request-body helpers used by several route groups.
import type { FastifyRequest } from 'fastify';

export class HttpError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, extra: { retryAfter?: number; fields?: Record<string, string> } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

export const bad = (message: string, code = 'invalid_request') => new HttpError(400, code, message);

export const MAX_JSON = 64 * 1024;
export const MAX_IMAGE = 5 * 1024 * 1024; // decoded bytes per image
export const IMAGE_BODY_LIMIT = Math.ceil(MAX_IMAGE * 1.4) + MAX_JSON; // base64 image inside JSON
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const contentType = (req: FastifyRequest) => String(req.headers['content-type'] || '').split(';')[0]!.trim();

/** JSON object body; requests without a body read as {}. */
export function jsonBody(req: FastifyRequest): Record<string, unknown> {
  const body = req.body;
  if (body === undefined || body === null) return {};
  if (Buffer.isBuffer(body) || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a JSON object');
  return body as Record<string, unknown>;
}

export interface ImageInput { image: string; mediaType: string; fields: Record<string, unknown> }

// Images arrive as JSON {image: base64 | data URL, mediaType} or as a raw image/* body.
export function readImage(req: FastifyRequest): ImageInput {
  const type = contentType(req);
  if (IMAGE_TYPES.includes(type) && Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_IMAGE) throw new HttpError(413, 'payload_too_large', `request body exceeds ${MAX_IMAGE} bytes`);
    return { image: req.body.toString('base64'), mediaType: type, fields: {} };
  }
  return imageFromJson(jsonBody(req));
}

export function imageFromJson(body: Record<string, unknown>): ImageInput {
  if (typeof body.image !== 'string' || !body.image) throw bad('`image` (base64 or data URL) is required');
  let data: string = body.image;
  let mediaType = body.mediaType as string | undefined;
  const dataUrl = data.match(/^data:(image\/[a-z+]+);base64,(.*)$/s);
  if (dataUrl) { mediaType = mediaType || dataUrl[1]; data = dataUrl[2]!; }
  data = data.replace(/\s+/g, '');
  if (!IMAGE_TYPES.includes(mediaType as string)) throw bad(`mediaType must be one of ${IMAGE_TYPES.join(', ')}`);
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw bad('`image` is not valid base64');
  if ((data.length * 3) / 4 > MAX_IMAGE) throw new HttpError(413, 'payload_too_large', 'image exceeds 5 MB');
  return { image: data, mediaType: mediaType as string, fields: body };
}
