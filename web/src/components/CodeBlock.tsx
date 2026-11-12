// A <pre> with a copy button (the legacy pre[data-copy]). `copyText` copies something other than what is shown,
// e.g. a snippet whose secret is masked on screen.
import { useRef, useState, type ReactNode } from 'react';

export function CodeBlock({ children, className, lang, copyText }: { children: ReactNode; className?: string; lang?: string; copyText?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [label, setLabel] = useState('Copy');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? pre.current?.innerText ?? '');
      setLabel('Copied ✓');
    } catch {
      setLabel('Select to copy');
    }
    setTimeout(() => setLabel('Copy'), 1600);
  };
  return (
    <div className="code-wrap">
      <pre ref={pre} className={className} data-lang={lang}>{children}</pre>
      <button className="copy-btn" type="button" onClick={copy}>{label}</button>
    </div>
  );
}
