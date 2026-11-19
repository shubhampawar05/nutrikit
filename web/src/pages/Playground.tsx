// API playground: pick an endpoint, fill the form, send, inspect the result.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { Nutrikit } from '../sdk.ts';
import { errorText, sentence } from '../api/client.ts';
import { useMe } from '../hooks.ts';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Icon } from '../components/Icon.tsx';
import { TabList, tabIds } from '../components/Tabs.tsx';
import { useToast } from '../components/Toast.tsx';
import { ENDPOINTS, HINTS, defaultHints, defaults, findEndpoint, fmtN, type Endpoint, type Field, type RawValues } from './playground/endpoints.ts';
import { JsonText, Preview, PreviewBoundary } from './playground/previews.tsx';
import { usePlaygroundAuth, type AuthView } from './playground/usePlaygroundAuth.ts';
import { useSend, type ErrorBody, type View } from './playground/useSend.ts';
import { PasswordInput } from '../components/PasswordInput.tsx';
import { Select } from '../components/Select.tsx';

const VIEWS: { id: View; label: string }[] = [{ id: 'preview', label: 'Preview' }, { id: 'json', label: 'JSON' }, { id: 'curl', label: 'cURL' }];
const VIEW_PREFIX = 'pg-view';

function ErrorBox({ status, body, authView }: { status: number; body: ErrorBody; authView: AuthView }) {
  const e = body.error || {};
  const hint = e.code ? HINTS[e.code] : undefined;
  let actions: ReactNode = null;
  if (e.code === 'no_key') {
    // Signed in without a key: the dashboard is the way forward. A pasted-key user just needs the field above.
    if (authView === 'no-key') actions = <Link className="btn btn-primary btn-sm" to="/dashboard">Create a key in your dashboard <span className="arrow">→</span></Link>;
    else if (authView === 'anonymous') actions = <><Link className="btn btn-primary btn-sm" to="/login?next=/playground">Log in</Link><Link className="btn btn-ghost btn-sm" to="/signup">Get a free key</Link></>;
  } else if (e.code === 'quota_exceeded') {
    actions = <Link className="btn btn-primary btn-sm" to="/dashboard">Open dashboard <span className="arrow">→</span></Link>;
  }
  return (
    <div className={e.code === 'no_key' ? 'pg-gate' : 'pg-error'}>
      <b>{status ? `${status} · ` : ''}{e.code || 'error'}</b>
      <p>{sentence(e.message)}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

function Unpreviewable({ status, onShowJson }: { status: number; onShowJson: () => void }) {
  return (
    <div className="pg-error">
      <b>{status} · preview unavailable</b>
      <p>Couldn’t display this response — see the JSON tab.</p>
      <div className="row"><button className="btn btn-ghost btn-sm" type="button" onClick={onShowJson}>Show JSON</button></div>
    </div>
  );
}

export function Playground() {
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
  // The camera in use while scanning; stopped when the scan ends or the page is left mid-scan.
  const cameraRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cameraRef.current?.getTracks().forEach((t) => t.stop());
      cameraRef.current = null;
    };
  }, []);
  const currentIdRef = useRef(initial.id);

  // ------------------------------------------------------------ credentials and sending
  const { auth, authView, authViewRef, switching, authLabel, savedKey, keyInput, mintSessionToken, showKeyForm, backToAccount, onKeySubmit } =
    usePlaygroundAuth({ isPending: me.isPending, signedIn: Boolean(me.data) });
  const { busy, busyRef, meta, out, json, curl, view, setView, send, reset } =
    useSend({ auth, authViewRef, signedIn: Boolean(me.data), mintSessionToken, initial });

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
    reset(ep, v);
    if (location.hash.slice(1) !== ep.id) navigate({ hash: ep.id }, { replace: true });
    return { ep, v };
  }, [location.hash, navigate, reset]);

  // Boot from the hash, and follow later hash changes (back/forward, edited URL).
  useEffect(() => {
    const h = location.hash.slice(1);
    if (h !== currentIdRef.current) select(h);
  }, [location.hash]);

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
    if (busyRef.current) return;
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
      toast(errorText(err));
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
      if (!mountedRef.current) return; // left the page while the camera was starting
      cameraRef.current = stream;
      video.srcObject = stream;
      await video.play();
      const code = await Nutrikit.scanBarcode(video);
      const l = latest.current;
      const next = { ...l.vals, code };
      setVals(next);
      latest.current = { ...l, vals: next };
      void send(l.current, next, l.images);
    } catch (err) {
      toast(errorText(err, 'Camera unavailable'));
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      if (cameraRef.current === stream) cameraRef.current = null;
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
          <Select id={id} name={f.name} value={text} onChange={(v) => setValue(f.name, v)} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
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
                // Visually hidden, not `hidden`: keyboard users tab to it and open the picker with Enter or Space.
                type="file" accept="image/jpeg,image/png,image/webp,image/gif" id={id} name={f.name} className="sr-only"
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
  const panel = (id: View) => {
    const ids = tabIds(VIEW_PREFIX, id);
    return { id: ids.panel, role: 'tabpanel', 'aria-labelledby': ids.tab, tabIndex: 0, hidden: view !== id };
  };
  const statusLine = meta === 'sending' ? 'Sending…' : meta
    ? `${meta.status} ${meta.statusText || (meta.ok ? 'OK' : 'Error')}${meta.charged != null ? ` · ${meta.charged} token${meta.charged === '1' ? '' : 's'}` : ''}`
    : '';
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

  const sendButton = (
    <button className="btn btn-primary pg-send-btn" type="submit" form="pg-form" disabled={busy}>
      {busy ? 'Sending… ' : 'Send request '}<span className="arrow">→</span>
    </button>
  );

  return (
    <main className="wrap pg">
      <div className="pg-head">
        <div>
          <h1>Try every endpoint.</h1>
          <p className="muted">Pick an endpoint, send a request, inspect the result.</p>
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
                  <PasswordInput noun="key" ref={keyInput} className="input" id="pg-key" autoComplete="off" placeholder="Paste nk_… or nkat_…" defaultValue={savedKey} />
                  <button className="btn btn-ghost btn-sm" type="submit">Use key</button>
                </form>
                {me.data ? (
                  <button className="btn btn-ghost btn-sm" type="button" disabled={switching} onClick={backToAccount}>{switching ? 'Switching…' : 'Use my account'}</button>
                ) : null}
              </>
            )}
        </div>
      </div>

      <div className="pg-layout">
        <nav className="pg-rail" aria-label="Endpoints">{rail}</nav>

        <div className="pg-bench">
          <div className="pg-reqbar">
            <p className="pg-endpoint"><span className={`method ${current.method.toLowerCase()}`}>{current.method}</span><code>{current.path}</code></p>
            <span className="pg-cost">{current.cost}</span>
            {sendButton}
          </div>

          <div className="pg-split">
            <section className="pg-pane pg-request" aria-labelledby="req-title">
              <h2 id="req-title">{current.title}</h2>
              <p className="pg-desc">{current.desc}</p>
              <form id="pg-form" noValidate onSubmit={(e) => { e.preventDefault(); void send(current, vals, images); }}>
                {scanning ? <video ref={videoRef} className="pg-video" playsInline muted /> : null}
                {current.fields.map(fieldControl)}
              </form>
              <p className="pg-shortcut muted small"><kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> sends from anywhere</p>
            </section>

            <section className="pg-pane pg-response" aria-labelledby="res-title">
              <div className="pg-response-inner">
                <div className="pg-response-head">
                  <h2 id="res-title" className="sr-only">Response</h2>
                  <TabList tabs={VIEWS} current={view} onChange={(id) => setView(id as View)} label="Response view" prefix={VIEW_PREFIX} className="pg-tabs" tabClassName="pg-tab" />
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
                {/* The only live region in the panel: a short status, not the whole response. */}
                <p className="sr-only" role="status" aria-live="polite">{statusLine}</p>
                <div className="pg-out" {...panel('preview')}>
                  {out.kind === 'empty' ? (
                    <div className="pg-empty">
                      <Icon name={current.icon} />
                      <p>Send the request to see the result.</p>
                      {authView === 'anonymous' ? (
                        <>
                          <p className="muted small">Requests run on your API key. Log in and the playground uses your account — no copying keys.</p>
                          <div className="row"><Link className="btn btn-primary btn-sm" to="/login?next=/playground">Log in</Link><Link className="btn btn-ghost btn-sm" to="/signup">Get a free key</Link></div>
                        </>
                      ) : null}
                    </div>
                  ) : out.kind === 'error' ? <ErrorBox status={out.status} body={out.body} authView={authView} />
                    : out.kind === 'unpreviewable' ? <Unpreviewable status={out.status} onShowJson={() => setView('json')} /> : (
                    <PreviewBoundary key={json ?? ''} fallback={<Unpreviewable status={meta && meta !== 'sending' ? meta.status : 200} onShowJson={() => setView('json')} />}>
                      <Preview result={out.result} offset={out.offset} onUseFood={pickFood} />
                    </PreviewBoundary>
                  )}
                </div>
                <div className="pg-out" {...panel('json')}>
                  <CodeBlock><code>{json == null ? '// No response yet' : <JsonText text={json} />}</code></CodeBlock>
                </div>
                <div className="pg-out" {...panel('curl')}>
                  <CodeBlock><code>{curl}</code></CodeBlock>
                  <p className="small muted">Uses <code>$NUTRIKIT_KEY</code> — export your API key first. Your real key or token is never shown here.</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
