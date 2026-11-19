// Light/dark theme: the system setting by default, or the visitor's pick from the header toggle.
// The pick is stored in localStorage and applied as html[data-theme] (also before paint, by public/theme.js).
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'nk-theme';
const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

const system = (): Theme => (media?.matches ? 'dark' : 'light');
const current = (): Theme => (document.documentElement.dataset.theme as Theme | undefined) ?? system();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) media?.addEventListener('change', emit);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) media?.removeEventListener('change', emit);
  };
}

/** Switches to the other theme. Switching back to what the system uses clears the pick, so the site follows the system again. */
export function toggleTheme() {
  const next: Theme = current() === 'dark' ? 'light' : 'dark';
  try {
    if (next === system()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* storage blocked: the switch lasts until reload */ }
  if (next === system()) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  emit();
}

/** The theme in use right now. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => 'light');
}
