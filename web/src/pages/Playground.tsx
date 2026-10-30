// API playground: pick an endpoint, fill the form, send, inspect the result.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { Nutrikit, NutrikitError } from '../sdk.ts';
import { api, ApiError } from '../api/client.ts';
import { useMe, useTitle } from '../hooks.ts';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import {
  ENDPOINTS, HINTS, buildRequest, convert, curlFor, defaultHints, defaults, findEndpoint, fmtN,
  type Endpoint, type Field, type RawValues, type Result,
} from './playground/endpoints.ts';
import { JsonText, Preview, PreviewBoundary } from './playground/previews.tsx';

const KEY_STORE = 'nk-playground-key';
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

type AuthView = 'checking' | 'session' | 'no-key' | 'anonymous' | 'manual';
type View = 'preview' | 'json' | 'curl';
interface ErrorBody { error?: { code?: string; message?: string } }
interface Meta { status: number; statusText: string; ok: boolean; ms: number; charged: string | null; remaining: string | null }
type Out = { kind: 'empty' } | { kind: 'error'; status: number; body: ErrorBody } | { kind: 'result'; result: Result; offset: number };
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

function ErrorBox({ status, body }: { status: number; body: ErrorBody }) {
  const e = body.error || {};
  const hint = e.code ? HINTS[e.code] : undefined;
  return (
    <div className="pg-error">
      <b>{status ? `${status} · ` : ''}{e.code || 'error'}</b>
      <p>{e.message || 'Something went wrong.'}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
      {e.code === 'no_key' ? (
        <div className="row"><Link className="btn btn-primary btn-sm" to="/login?next=/playground">Log in</Link><Link className="btn btn-ghost btn-sm" to="/signup">Get a free key</Link></div>
      ) : null}
    </div>
  );
}

export function Playground() {
  useTitle('Playground — Nutrikit');
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const me = useMe();

  // ------------------------------------------------------------ endpoint + form state
  const initial = findEndpoint(location.hash.slice(1) || 'text');
  const [current, setCurrent] = useState<Endpoint>(initial);
  const [vals, setVals] = useState<RawValues>(() => defaults(initial));
  const [hints, setHints] = useState<Record<string, string>>(() => defaultHints(initial));
  const [images, setImages] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentIdRef = useRef(initial.id);

  // ------------------------------------------------------------ response state
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<Meta | 'sending' | null>(null);
  const [out, setOut] = useState<Out>({ kind: 'empty' });
  const [json, setJson] = useState<string | null>(null);
  const [curl, setCurl] = useState(() => curlFor(buildRequest(initial, convert(initial, defaults(initial), {})), window.location.origin));
  const [view, setView] = useState<View>('preview');
  const inflight = useRef(0);

  // ------------------------------------------------------------ credentials
  const auth = useRef<{ value: string | null; mode: 'session' | 'manual' | null }>({ value: null, mode: null });
  const [authView, setAuthView] = useState<AuthView>('checking');
  const [authLabel, setAuthLabel] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const keyInput = useRef<HTMLInputElement>(null);

  const mintSessionToken = useCallback(async () => {
    const data = await api.playgroundToken();
    auth.current = { value: data.access_token, mode: 'session' };
    setAuthLabel(data.key.name);
    return data;
  }, []);

  /** The key form (anonymous / manual): a key saved earlier in this tab is used right away. */
  const showKeyForm = useCallback((state: 'anonymous' | 'manual') => {
    const saved = store.get(KEY_STORE);
    if (saved) auth.current = { value: saved, mode: 'manual' };
    setSavedKey(saved || '');
    setAuthView(state);
  }, []);

  const authStarted = useRef(false);
  useEffect(() => {
    if (me.isPending || authStarted.current) return;
    authStarted.current = true;
    if (!me.data) { showKeyForm('anonymous'); return; }
    mintSessionToken().then(
      () => setAuthView('session'),
      (err: unknown) => {
        if (err instanceof ApiError && err.code === 'no_active_key') setAuthView('no-key');
        else showKeyForm('anonymous');
      },
    );
  }, [me.isPending, me.data, mintSessionToken, showKeyForm]);

  const onKeySubmit = (e: FormEvent) => {
    e.preventDefault();
    const v = (keyInput.current?.value ?? '').trim();
    auth.current = v ? { value: v, mode: 'manual' } : { value: null, mode: null };
    store.set(KEY_STORE, v || null);
    toast(v ? 'Key saved for this tab' : 'Key cleared');
  };

  // ------------------------------------------------------------ selecting an endpoint
  const select = useCallback((id: string) => {
    const ep = findEndpoint(id);
    const v = defaults(ep);
    currentIdRef.current = ep.id;
    setCurrent(ep);
    setVals(v);
    setHints(defaultHints(ep));
    setImages({});
    setDragOver(null);
    // resetResponse()
    setMeta(null);
    setOut({ kind: 'empty' });
    setJson(null);
    setCurl(curlFor(buildRequest(ep, convert(ep, v, {})), window.location.origin));
    if (location.hash.slice(1) !== ep.id) navigate({ hash: ep.id }, { replace: true });
    return { ep, v };
  }, [location.hash, navigate]);

  // Boot from the hash, and follow later hash changes (back/forward, edited URL).
  useEffect(() => {
    const h = location.hash.slice(1);
    if (h !== currentIdRef.current) select(h);
  }, [location.hash]);

  // ------------------------------------------------------------ sending
  const showError = useCallback((status: number, body: ErrorBody) => {
    setOut({ kind: 'error', status, body });
    if (!status) setMeta(null);
    setView('preview');
  }, []);

  const send = useCallback(async (ep: Endpoint, raw: RawValues, imgs: Record<string, string>) => {
    const v = convert(ep, raw, imgs);
    const req = buildRequest(ep, v);
    setCurl(curlFor(req, window.location.origin));
    if (!auth.current.value) {
      showError(0, { error: { code: 'no_key', message: 'Add an API key above (or log in) to send requests.' } });
      return;
    }
    const mine = ++inflight.current;
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
    try {
      let result = await attempt();
      // Session tokens last an hour; renew transparently once.
      if (!result && cap.last?.status === 401 && errorBody(cap.last.body).error?.code === 'token_expired' && auth.current.mode === 'session') {
        await mintSessionToken();
        result = await attempt();
      }
      if (mine !== inflight.current) return;
      const c = cap.last;
      if (!c) throw new Error('no response');
      setMeta({ status: c.status, statusText: c.statusText, ok: c.ok, ms: Math.round(performance.now() - t0), charged: c.charged, remaining: c.remaining });
      setJson(JSON.stringify(c.body, null, 2));
      if (!c.ok || !result) { showError(c.status, errorBody(c.body)); return; }
      const offset = Number(new URLSearchParams(req.path.split('?')[1] ?? '').get('offset') || 0);
      setOut({ kind: 'result', result, offset });
      setView('preview');
    } catch {
      if (mine === inflight.current) showError(0, NETWORK);
    } finally {
      if (mine === inflight.current) setBusy(false);
    }
  }, [mintSessionToken, showError]);

  // Latest state for handlers that outlive a render (Ctrl+Enter, speech, camera).
  const latest = useRef({ current, vals, images });
  useEffect(() => { latest.current = { current, vals, images }; }, [current, vals, images]);
  const sendLatest = useCallback(() => {
    const l = latest.current;
    void send(l.current, l.vals, l.images);
  }, [send]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendLatest(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sendLatest]);

  // ------------------------------------------------------------ form helpers
  const setValue = (name: string, value: string | boolean) => setVals((v) => ({ ...v, [name]: value }));

  const pickExample = (name: string, value: string) => {
    const next = { ...vals, [name]: value };
    setVals(next);
    latest.current = { current, vals: next, images };
    void send(current, next, images);
  };

  const loadImage = (name: string, file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Images must be 5 MB or less'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const url = reader.result;
        setImages((i) => ({ ...i, [name]: url }));
      }
    };
    reader.readAsDataURL(file);
  };

  const clearImage = (name: string) => setImages((i) => {
    const next = { ...i };
    delete next[name];
    return next;
  });

  const listen = async () => {
    setListening(true);
    try {
      const transcript = await Nutrikit.listen();
      const l = latest.current;
      const next = { ...l.vals, transcript };
      setVals(next);
      latest.current = { ...l, vals: next };
      void send(l.current, next, l.images);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setListening(false);
    }
  };

  const scanBarcode = async () => {
    flushSync(() => setScanning(true));
    const video = videoRef.current;
    let stream: MediaStream | undefined;
    try {
      if (!video) throw new Error('Camera unavailable');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      const code = await Nutrikit.scanBarcode(video);
      const l = latest.current;
      const next = { ...l.vals, code };
      setVals(next);
      latest.current = { ...l, vals: next };
      void send(l.current, next, l.images);
    } catch (err) {
      toast((err instanceof Error && err.message) || 'Camera unavailable');
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setScanning(false);
    }
  };

  const pickFood = (id: number, name: string) => {
    const { ep, v } = select('nutrients');
    const next = { ...v, id: String(id), quantity: '100', unit: 'g' };
    setVals(next);
    setHints((h) => ({ ...h, id: name }));
    latest.current = { current: ep, vals: next, images: {} };
    void send(ep, next, {});
  };

  function fieldControl(f: Field): ReactNode {
    const id = `f-${current.id}-${f.name}`;
    const raw = vals[f.name];
    const text = typeof raw === 'string' ? raw : '';
    const examples = f.examples ? (
      <div className="demo-chips">
        {f.examples.map((x) => <button key={x} className="chip" type="button" onClick={() => pickExample(f.name, x)}>{x}</button>)}
      </div>
    ) : null;
    let control: ReactNode;
    switch (f.type) {
      case 'textarea':
        control = <textarea id={id} name={f.name} rows={f.rows || 3} value={text} onChange={(e) => setValue(f.name, e.target.value)} />;
        break;
      case 'checkbox':
        return (
          <label key={f.name} className="pg-check">
            <input type="checkbox" id={id} name={f.name} checked={raw === true} onChange={(e) => setValue(f.name, e.target.checked)} /> {f.label}
          </label>
        );
      case 'select':
        control = (
          <select id={id} name={f.name} value={text} onChange={(e) => setValue(f.name, e.target.value)}>
            {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
          </select>
        );
        break;
      case 'image': {
        const src = images[f.name];
        return (
          <div key={f.name} className="field">
            <span className="label">{f.label}</span>
            <label
              className={`pg-drop${dragOver === f.name ? ' over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(f.name); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); loadImage(f.name, e.dataTransfer.files[0]); }}
            >
              <input
                type="file" accept="image/jpeg,image/png,image/webp,image/gif" id={id} name={f.name} hidden
                onChange={(e) => loadImage(f.name, e.target.files?.[0])}
                // Clearing the photo also clears the chosen file, so the same file can be picked again.
                ref={(el) => { if (el && !src) el.value = ''; }}
              />
              <img alt="" hidden={!src} src={src || undefined} />
              <span hidden={!!src}><Icon name="camera" /><b>Drop an image</b> or click to choose · JPEG, PNG, WebP ≤ 5 MB</span>
            </label>
            {f.optional ? <button className="btn btn-ghost btn-sm" type="button" hidden={!src} onClick={() => clearImage(f.name)}>Remove photo</button> : null}
          </div>
        );
      }
      default:
        control = (
          <input
            id={id} name={f.name} type={f.type === 'number' ? 'number' : 'text'} value={text}
            placeholder={f.placeholder} min={f.min} max={f.max} step={f.step} inputMode={f.inputmode}
            onChange={(e) => {
              setValue(f.name, e.target.value);
              // Picking a food id elsewhere clears the stale name hint.
              if (f.name === 'id') setHints((h) => ({ ...h, id: '' }));
            }}
          />
        );
    }
    const extra = f.mic ? (
      <button className="btn btn-ghost btn-sm" type="button" disabled={listening} onClick={listen}><Icon name="mic" />{listening ? 'Listening…' : 'Speak'}</button>
    ) : f.scan ? (
      <button className="btn btn-ghost btn-sm" type="button" onClick={scanBarcode}><Icon name="barcode" />Scan</button>
    ) : null;
    return (
      <div key={f.name} className="field">
        <div className="pg-label-row"><label htmlFor={id}>{f.label}</label>{f.hint ? <span className="muted small">{hints[f.name] ?? ''}</span> : null}</div>
        <div className="pg-control">{control}{extra}</div>
        {examples}
      </div>
    );
  }

  // ------------------------------------------------------------ render
  let group = '';
  const rail: ReactNode[] = [];
  for (const e of ENDPOINTS) {
    if (e.group !== group) { group = e.group; rail.push(<h4 key={`g-${group}`}>{group}</h4>); }
    rail.push(
      <a key={e.id} href={`#${e.id}`} aria-current={e.id === current.id ? 'true' : undefined} onClick={(ev) => { ev.preventDefault(); select(e.id); }}>
        <Icon name={e.icon} /><span>{e.title}</span>
      </a>,
    );
  }

  return (
    <main className="wrap pg">
      <div className="pg-head">
        <div>
          <span className="kicker">Playground</span>
          <h1>Try every endpoint.</h1>
        </div>
        <div className="pg-auth" aria-live="polite">
          {authView === 'checking' ? <span className="muted small">Checking sign-in…</span>
            : authView === 'session' ? (
              <>
                <span className="pg-chip ok"><Icon name="check" />Signed in · key “{authLabel}”</span>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => showKeyForm('manual')}>Use another key</button>
              </>
            ) : authView === 'no-key' ? (
              <>
                <span className="pg-chip warn">You have no active API keys</span>
                <Link className="btn btn-primary btn-sm" to="/dashboard">Create one <span className="arrow">→</span></Link>
              </>
            ) : (
              <>
                <form className="pg-keyform" onSubmit={onKeySubmit} key={authView}>
                  <label className="sr-only" htmlFor="pg-key">API key or access token</label>
                  <input ref={keyInput} className="input" id="pg-key" type="password" autoComplete="off" placeholder="Paste nk_… or nkat_…" defaultValue={savedKey} />
                  <button className="btn btn-primary btn-sm" type="submit">Use key</button>
                </form>
                {authView === 'manual' ? null : (
                  <span className="small muted"><Link to="/login?next=/playground">Log in</Link> to skip this, or <Link to="/signup">get a free key</Link>.</span>
                )}
              </>
            )}
        </div>
      </div>

      <div className="pg-layout">
        <nav className="pg-rail" aria-label="Endpoints">{rail}</nav>

        <section className="pg-panel pg-request" aria-labelledby="req-title">
          <div className="pg-panel-head">
            <div>
              <h2 id="req-title">{current.title}</h2>
              <p className="pg-endpoint"><span className={`method ${current.method.toLowerCase()}`}>{current.method}</span><code>{current.path}</code></p>
            </div>
            <span className="badge">{current.cost}</span>
          </div>
          <p className="muted small">{current.desc}</p>
          <form noValidate onSubmit={(e) => { e.preventDefault(); void send(current, vals, images); }}>
            {scanning ? <video ref={videoRef} className="pg-video" playsInline muted /> : null}
            {current.fields.map(fieldControl)}
            <div className="pg-send">
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Sending… ' : 'Send request '}<span className="arrow">→</span></button>
              <span className="muted small">{current.method} · {current.cost}</span>
            </div>
          </form>
        </section>

        <section className="pg-panel pg-response" aria-labelledby="res-title" aria-live="polite">
          <div className="pg-panel-head">
            <h2 id="res-title">Response</h2>
            <div className="pg-meta">
              {meta === 'sending' ? <span className="pg-chip">Sending…</span> : meta ? (
                <>
                  <span className={`pg-chip ${meta.ok ? 'ok' : 'bad'}`}>{meta.status} {meta.statusText || (meta.ok ? 'OK' : 'Error')}</span>
                  <span className="pg-chip">{meta.ms} ms</span>
                  {meta.charged != null ? <span className="pg-chip">{meta.charged} token{meta.charged === '1' ? '' : 's'}</span> : null}
                  {meta.remaining != null ? <span className="pg-chip">{fmtN(meta.remaining)} left</span> : null}
                </>
              ) : null}
            </div>
          </div>
          <div className="pg-tabs" role="tablist">
            {(['preview', 'json', 'curl'] as const).map((t) => (
              <button key={t} className="pg-tab" role="tab" aria-selected={view === t} onClick={() => setView(t)}>
                {t === 'preview' ? 'Preview' : t === 'json' ? 'JSON' : 'cURL'}
              </button>
            ))}
          </div>
          <div className="pg-out" hidden={view !== 'preview'}>
            {out.kind === 'empty' ? (
              <div className="pg-empty">
                <Icon name={current.icon} />
                <p>Send the request to see the result.<br /><span className="muted small">Tip: <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd> sends from anywhere.</span></p>
              </div>
            ) : out.kind === 'error' ? <ErrorBox status={out.status} body={out.body} /> : (
              <PreviewBoundary key={json ?? ''} fallback={<ErrorBox status={0} body={NETWORK} />}>
                <Preview result={out.result} offset={out.offset} onUseFood={pickFood} />
              </PreviewBoundary>
            )}
          </div>
          <div className="pg-out" hidden={view !== 'json'}>
            <CodeBlock><code>{json == null ? '// No response yet' : <JsonText text={json} />}</code></CodeBlock>
          </div>
          <div className="pg-out" hidden={view !== 'curl'}>
            <CodeBlock><code>{curl}</code></CodeBlock>
            <p className="small muted">Uses <code>$NUTRIKIT_KEY</code> — export your API key first. Your real key or token is never shown here.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
