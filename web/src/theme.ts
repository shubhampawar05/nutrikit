// Light/dark theme: the system setting by default, or the visitor's pick from the header toggle.
// The theme in use is always on html[data-theme] (first set before paint by public/theme.js, which must keep
// using THEME_KEY and THEME_COLORS — theme.test.tsx checks it), and the browser chrome follows via theme-color.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'nk-theme';
/** Browser chrome colours (meta theme-color): the page background of each theme. */
export const THEME_COLORS: Record<Theme, string> = { light: '#f7f2e8', dark: '#12110f' };

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

const parse = (v: string | null): Theme | null => (v === 'light' || v === 'dark' ? v : null);
function readStored(): Theme | null {
  try { return parse(localStorage.getItem(THEME_KEY)); } catch { return null; }
}

/** The visitor's pick, or null to follow the system. Kept in memory too, so the toggle works when storage is blocked. */
let choice: Theme | null = readStored();
const system = (): Theme => (media?.matches ? 'dark' : 'light');
const resolved = (): Theme => choice ?? system();

/** Puts the theme in use on the page and tells subscribers. */
function apply() {
  const theme = resolved();
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLORS[theme]));
  listeners.forEach((l) => l());
}

// Another tab toggled the theme: follow it here too.
const onStorage = (e: StorageEvent) => {
  if (e.key !== THEME_KEY && e.key !== null) return; // null: storage was cleared
  choice = parse(e.key === null ? null : e.newValue);
  apply();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    media?.addEventListener('change', apply);
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      media?.removeEventListener('change', apply);
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Switches to the other theme. Switching back to what the system uses clears the pick, so the site follows the system again. */
export function toggleTheme() {
  const next: Theme = resolved() === 'dark' ? 'light' : 'dark';
  choice = next === system() ? null : next;
  try {
    if (choice) localStorage.setItem(THEME_KEY, choice);
    else localStorage.removeItem(THEME_KEY);
  } catch { /* storage blocked: the pick lasts until reload */ }
  apply();
}

/** The theme in use right now. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, resolved, () => 'light');
}

// In case public/theme.js did not run (blocked, or a test environment), put the theme on the page now.
if (typeof document !== 'undefined') apply();
