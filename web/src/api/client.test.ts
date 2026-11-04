import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, portal } from './client.ts';

const calls: { url: string; init: RequestInit }[] = [];
function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }));
}

afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });

describe('portal client', () => {
  it('sends the CSRF header, same-origin credentials and a JSON body', async () => {
    respond(201, { id: 'key_1', name: 'ci', key: 'nk_x' });
    expect(await api.createKey('ci')).toEqual({ id: 'key_1', name: 'ci', key: 'nk_x' });
    const { url, init } = calls[0]!;
    expect(url).toBe('/portal/api/keys');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({ 'X-Nutrikit-Portal': '1', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ name: 'ci' });
  });

  it('sends GETs without a body or Content-Type', async () => {
    respond(200, { keys: [] });
    await api.keys();
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.headers).toEqual({ 'X-Nutrikit-Portal': '1' });
  });

  it('turns error JSON into an ApiError with code, fields and Retry-After', async () => {
    respond(400, { error: { code: 'invalid_request', message: 'check the highlighted fields', fields: { email: 'Enter a valid email address.' } } });
    const err = await api.signup({ name: 'A', email: 'x', password: 'y' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'invalid_request', message: 'check the highlighted fields', fields: { email: 'Enter a valid email address.' } });

    respond(429, { error: { code: 'too_many_attempts', message: 'too many failed logins; try again in 15 minutes' } }, { 'Retry-After': '900' });
    await expect(api.login({ email: 'a@b.c', password: 'x' })).rejects.toMatchObject({ code: 'too_many_attempts', retryAfter: 900 });
  });

  it('copes with a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    await expect(portal('GET', '/me')).rejects.toMatchObject({ status: 502, code: 'error', message: 'Something went wrong' });
  });
});

describe('formatting helpers', () => {
  it('turns server messages into sentences', async () => {
    const { sentence, errorText } = await import('./client.ts');
    expect(sentence('your Free plan allows 2 active keys; revoke one first')).toBe('Your Free plan allows 2 active keys; revoke one first.');
    expect(sentence('Already done.')).toBe('Already done.');
    expect(sentence('')).toBe('Something went wrong.');
    expect(errorText(new Error('rate limit exceeded'))).toBe('Rate limit exceeded.');
    expect(errorText('nope')).toBe('Something went wrong.');
  });

  it('formats counts the same way everywhere and period dates in UTC', async () => {
    const { fmt, fmtPeriodDate } = await import('./client.ts');
    expect(fmt(1000000)).toBe('1,000,000');
    expect(fmt(null)).toBe('—');
    // Midnight UTC on 1 Dec is still 30 Nov in UTC-5; a period date must read as 1 Dec anyway.
    expect(fmtPeriodDate('2026-12-01T00:00:00.000Z')).toMatch(/Dec\D*1\D|1 Dec/);
    expect(fmtPeriodDate('2026-12-01T00:00:00.000Z')).not.toMatch(/30/);
  });
});
