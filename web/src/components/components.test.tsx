import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs } from './Tabs.tsx';
import { ToastProvider, useToast } from './Toast.tsx';
import { Layout } from './Layout.tsx';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Toast', () => {
  it('puts every toast in one live region, stacked', () => {
    vi.useFakeTimers();
    function Two() {
      const toast = useToast();
      useEffect(() => { toast('Key revoked'); toast('Key created'); }, [toast]);
      return null;
    }
    render(<ToastProvider><Two /></ToastProvider>);
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.getAttribute('aria-live')).toBe('polite');
    expect(regions[0]!.textContent).toContain('Key revoked');
    expect(regions[0]!.textContent).toContain('Key created');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'js', label: 'JavaScript', panel: <p>js panel</p> },
    { id: 'curl', label: 'curl', panel: <p>curl panel</p> },
    { id: 'res', label: 'response', panel: <p>response panel</p> },
  ];

  it('is a labelled tablist with tabs paired to panels and one tab in the Tab order', () => {
    render(<Tabs label="Code samples" tabs={tabs} />);
    expect(screen.getByRole('tablist', { name: 'Code samples' })).toBeTruthy();
    const [first, second] = screen.getAllByRole('tab');
    expect(first!.getAttribute('tabindex')).toBe('0');
    expect(second!.getAttribute('tabindex')).toBe('-1');
    const panel = screen.getByRole('tabpanel');
    expect(first!.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(first!.id);
  });

  it('moves with the arrow, Home and End keys', () => {
    render(<Tabs label="Code samples" tabs={tabs} />);
    const [first, , third] = screen.getAllByRole('tab');
    first!.focus();
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('curl');
    expect(document.activeElement?.textContent).toBe('curl');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('JavaScript');
    expect(screen.getByText('js panel')).toBeTruthy();
  });
});

describe('Layout', () => {
  function page() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"unauthorized"}}', { status: 401, headers: { 'Content-Type': 'application/json' } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ element: <Layout />, children: [{ path: '/', element: <main>home</main> }] }], { initialEntries: ['/'] });
    return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  }

  it('starts with a skip link to the content', () => {
    const { container } = page();
    const first = container.querySelector('a, button');
    expect(first?.textContent).toBe('Skip to content');
    expect(first?.getAttribute('href')).toBe('#content');
    expect(document.getElementById('content')).toBeTruthy();
  });

  it('closes the mobile menu on Escape and returns focus to its button', () => {
    page();
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button.getAttribute('aria-controls')).toBe('site-nav');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });
});
