// Pieces the admin console's tabs share: plan names, error text, stat tiles and the debounced search box.
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, sentence } from '../../api/client.ts';

export const PLAN_OPTIONS: [string, string][] = [['free', 'Free'], ['starter', 'Starter'], ['growth', 'Growth'], ['enterprise', 'Enterprise']];
export const planName = (id: string) => PLAN_OPTIONS.find(([v]) => v === id)?.[1] ?? id;

const SEARCH_DELAY_MS = 300;

export const message = (err: unknown) => (err instanceof ApiError ? sentence(err.message) : 'Could not reach the server.');

/** The value, updated only once it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay = SEARCH_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <span className="muted small">{label}</span>
      <div className="big-number">{value}</div>
      {sub ? <span className="muted small">{sub}</span> : null}
    </div>
  );
}

export function Search({ value, onChange, placeholder, busy }: { value: string; onChange: (v: string) => void; placeholder: string; busy: boolean }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <span className="muted small" role="status">{busy ? 'Searching…' : ''}</span>
      <input className="input" type="search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A search box's text, the debounced query sent to the server, and whether results are still catching up. */
export function useSearch() {
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim());
  return { text, setText, q, pending: q !== text.trim() };
}
