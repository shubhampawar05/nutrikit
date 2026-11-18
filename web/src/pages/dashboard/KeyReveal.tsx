// The one-time reveal of a new API key: masked until asked for, with Copy.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '../../components/Icon.tsx';

/** A key shown once. `teamId`: the team it belongs to; it is only shown while that team is in use. */
export interface Reveal { key: string; title: string; teamId?: string }

/** "nk_Ab3d••••••••••••wXyz": enough to recognise the key, not enough to use it. */
export function maskKey(key: string): string {
  const head = key.indexOf('_') + 5;
  return key.length <= head + 4 ? '•'.repeat(key.length) : `${key.slice(0, head)}${'•'.repeat(12)}${key.slice(-4)}`;
}

export function KeyReveal({ reveal, onDismiss }: { reveal: Reveal; onDismiss: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  // The key is masked until asked for, so it isn't exposed on a shared or recorded screen; Copy works either way.
  const [shown, setShown] = useState(false);
  // A new key is not read aloud: focus moves to the heading instead (the toast region says "New key created").
  useEffect(() => {
    setCopied(false);
    setManual(false);
    setShown(false);
    heading.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    heading.current?.focus({ preventScroll: true });
  }, [reveal.key]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.key);
      setCopied(true);
      setManual(false);
    } catch {
      // Manual copy needs the real characters on screen.
      flushSync(() => setShown(true));
      input.current?.focus();
      input.current?.select();
      setManual(true);
    }
  };
  const dismiss = () => {
    if (!copied && !window.confirm("You haven't copied this key. It won't be shown again. Dismiss it anyway?")) return;
    onDismiss();
  };
  return (
    <div className="key-reveal">
      <h2 className="key-reveal-title" tabIndex={-1} ref={heading}>{reveal.title}</h2>
      <div className="key-reveal-field">
        <input
          ref={input}
          className="key-reveal-key"
          id="new-key"
          readOnly
          value={shown ? reveal.key : maskKey(reveal.key)}
          aria-label={shown ? 'New API key' : 'New API key, hidden'}
          onFocus={(e) => { if (shown) e.currentTarget.select(); }}
          onCopy={(e) => { if (!shown) { e.preventDefault(); void copy(); } else setCopied(true); }}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={shown ? 'Hide key' : 'Show key'}
          title={shown ? 'Hide key' : 'Show key'}
          aria-controls="new-key"
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <Icon name={shown ? 'eye-off' : 'eye'} />
        </button>
      </div>
      <div className="row">
        <button className="btn btn-primary btn-sm" type="button" onClick={copy}><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy key'}</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={dismiss}>I've saved it</button>
      </div>
      {manual ? <p className="small" style={{ margin: '8px 0 0' }}>Couldn't copy automatically. The key is selected: copy it manually (Ctrl+C or ⌘C).</p> : null}
      <p className="small" style={{ margin: '8px 0 0' }}>This is the only time you can copy this key. Store it somewhere safe, like your server's environment variables. Lost it? Choose Regenerate next to the key below.</p>
    </div>
  );
}
