// A <pre> with a copy button (the legacy pre[data-copy]).
import { useRef, useState, type ReactNode } from 'react';

export function CodeBlock({ children, className, lang }: { children: ReactNode; className?: string; lang?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [label, setLabel] = useState('Copy');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pre.current?.innerText ?? '');
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
