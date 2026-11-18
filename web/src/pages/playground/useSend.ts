// Sending a playground request through the SDK, and the response state it fills (status, preview, JSON, cURL).
import { useCallback, useRef, useState, type RefObject } from 'react';
import { Nutrikit, NutrikitError } from '../../sdk.ts';
import { ApiError, errorText } from '../../api/client.ts';
import { buildRequest, convert, curlFor, defaults, type Endpoint, type RawValues, type Result, type Values } from './endpoints.ts';
import type { AuthView, Credential } from './usePlaygroundAuth.ts';

export type View = 'preview' | 'json' | 'curl';
export interface ErrorBody { error?: { code?: string; message?: string } }
interface Meta { status: number; statusText: string; ok: boolean; ms: number; charged: string | null; remaining: string | null }
type Out =
  | { kind: 'empty' }
  | { kind: 'error'; status: number; body: ErrorBody }
  | { kind: 'result'; result: Result; offset: number }
  /** A 2xx whose body can't be previewed: the JSON tab still has it. */
  | { kind: 'unpreviewable'; status: number };
interface Captured { status: number; statusText: string; ok: boolean; charged: string | null; remaining: string | null; body: unknown }

const errorBody = (body: unknown): ErrorBody => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return {};
  const e: unknown = body.error;
  if (typeof e !== 'object' || e === null) return {};
  const code = 'code' in e && typeof e.code === 'string' ? e.code : undefined;
  const message = 'message' in e && typeof e.message === 'string' ? e.message : undefined;
  return { error: { code, message } };
};

const NETWORK: ErrorBody = { error: { code: 'network', message: 'Could not reach the API.' } };

const curlOf = (ep: Endpoint, v: Values) => curlFor(buildRequest(ep, v), window.location.origin);

export function useSend({ auth, authViewRef, signedIn, mintSessionToken, initial }: {
  auth: RefObject<Credential>;
  authViewRef: RefObject<AuthView>;
  signedIn: boolean;
  mintSessionToken: () => Promise<unknown>;
  /** The endpoint shown first, for the initial cURL snippet. */
  initial: Endpoint;
}) {
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<Meta | 'sending' | null>(null);
  const [out, setOut] = useState<Out>({ kind: 'empty' });
  const [json, setJson] = useState<string | null>(null);
  const [curl, setCurl] = useState(() => curlOf(initial, convert(initial, defaults(initial), {})));
  const [view, setView] = useState<View>('preview');
  const inflight = useRef(0);
  // Set synchronously when a send starts, so repeated shortcuts in one tick can't slip past `busy`.
  const busyRef = useRef(false);

  /** Another endpoint was chosen: clear the response. A reply still on its way belongs to the endpoint left behind,
   * so it is dropped, and a send is allowed right away. */
  const reset = useCallback((ep: Endpoint, raw: RawValues) => {
    inflight.current += 1;
    busyRef.current = false;
    setBusy(false);
    setMeta(null);
    setOut({ kind: 'empty' });
    setJson(null);
    setCurl(curlOf(ep, convert(ep, raw, {})));
  }, []);

  const showError = useCallback((status: number, body: ErrorBody) => {
    setOut({ kind: 'error', status, body });
    if (!status) setMeta(null);
    setView('preview');
  }, []);

  const send = useCallback(async (ep: Endpoint, raw: RawValues, imgs: Record<string, string>) => {
    if (busyRef.current) return; // one request at a time
    const v = convert(ep, raw, imgs);
    const req = buildRequest(ep, v);
    setCurl(curlFor(req, window.location.origin));
    if (!auth.current.value) {
      const view = authViewRef.current;
      const message = view === 'no-key' ? 'Your account has no active API key yet.'
        : view === 'manual' || (view === 'anonymous' && signedIn) ? 'Paste an API key above to send requests.'
          : 'Add an API key above (or log in) to send requests.';
      showError(0, { error: { code: 'no_key', message } });
      return;
    }
    const mine = ++inflight.current;
    busyRef.current = true;
    setBusy(true);
    setMeta('sending');

    // The SDK hides status, statusText and the raw error body, so a fetch wrapper records the last response.
    const cap: { last: Captured | null } = { last: null };
    const capture: typeof fetch = async (input, init) => {
      cap.last = null;
      const res = await fetch(input, init);
      cap.last = {
        status: res.status, statusText: res.statusText, ok: res.ok,
        charged: res.headers.get('x-tokens-charged'), remaining: res.headers.get('x-tokens-remaining'),
        body: await res.clone().json().catch(() => ({})),
      };
      return res;
    };
    // maxRetries 0: the legacy page showed a 429 straight away instead of retrying.
    const attempt = async (): Promise<Result | null> => {
      const nk = new Nutrikit({ apiKey: auth.current.value ?? '', baseUrl: window.location.origin, fetch: capture, maxRetries: 0 });
      try {
        return await ep.call(nk, v);
      } catch (err) {
        if (err instanceof NutrikitError && cap.last) return null; // an HTTP error: shown from the captured response
        throw err;
      }
    };

    const t0 = performance.now();
    const record = (c: Captured) => {
      setMeta({ status: c.status, statusText: c.statusText, ok: c.ok, ms: Math.round(performance.now() - t0), charged: c.charged, remaining: c.remaining });
      setJson(JSON.stringify(c.body, null, 2));
    };
    try {
      let result = await attempt();
      // Session tokens last an hour; renew transparently once.
      if (!result && cap.last?.status === 401 && errorBody(cap.last.body).error?.code === 'token_expired' && auth.current.mode === 'session') {
        try {
          await mintSessionToken();
        } catch (err) {
          // Renewing failed (signed out meanwhile, say): show why, not a network error.
          if (mine !== inflight.current) return;
          setMeta(null);
          showError(err instanceof ApiError ? err.status : 0, { error: { code: err instanceof ApiError ? err.code : 'error', message: errorText(err) } });
          return;
        }
        result = await attempt();
      }
      if (mine !== inflight.current) return;
      const c = cap.last;
      if (!c) throw new Error('no response');
      record(c);
      if (!c.ok || !result) { showError(c.status, errorBody(c.body)); return; }
      const offset = Number(new URLSearchParams(req.path.split('?')[1] ?? '').get('offset') || 0);
      setOut({ kind: 'result', result, offset });
      setView('preview');
    } catch {
      if (mine !== inflight.current) return;
      // A 2xx arrived but the SDK couldn't read it: that's a display problem, not a network one.
      const c = cap.last;
      if (c?.ok) { record(c); setOut({ kind: 'unpreviewable', status: c.status }); setView('preview'); }
      else showError(0, NETWORK);
    } finally {
      if (mine === inflight.current) { busyRef.current = false; setBusy(false); }
    }
  }, [signedIn, mintSessionToken, showError]);

  return { busy, busyRef, meta, out, json, curl, view, setView, send, reset };
}
