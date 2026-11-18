// Renders a component inside the app's providers (router, React Query, toasts) for Vitest.
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './components/Toast.tsx';

export function renderPage(ui: ReactNode, { path = '/' }: { path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Opens a <Select> dropdown (components/Select.tsx) by its trigger and returns its list. */
export function openSelect(trigger: HTMLElement) {
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return screen.getByRole('listbox');
}

/** Picks an option of a <Select> by its visible label. */
export function choose(trigger: HTMLElement, label: string) {
  openSelect(trigger);
  fireEvent.click(screen.getByRole('option', { name: label }));
}

/** The labels of a <Select>'s options, opening it if needed. */
export function optionLabels(trigger: HTMLElement) {
  return within(openSelect(trigger)).getAllByRole('option').map((o) => o.textContent);
}
