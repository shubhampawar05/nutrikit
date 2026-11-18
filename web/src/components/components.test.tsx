import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs } from './Tabs.tsx';
import { ToastProvider, useToast } from './Toast.tsx';
import { Layout } from './Layout.tsx';
import { Select } from './Select.tsx';
import { useState } from 'react';

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

describe('Select', () => {
  const FRUIT = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana', disabled: true },
    { value: 'cherry', label: 'Cherry' },
    { value: 'date', label: 'Date' },
  ];
  function Fruit({ onChange = () => {} }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState('apple');
    return (
      <>
        <label htmlFor="fruit">Fruit</label>
        <Select id="fruit" value={v} options={FRUIT} onChange={(x) => { setV(x); onChange(x); }} />
        <button type="button">Elsewhere</button>
      </>
    );
  }

  it('is labelled, shows the choice, and opens a listbox with the current option selected', () => {
    render(<Fruit />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    expect(trigger.textContent).toBe('Apple');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('option', { name: 'Apple' }).getAttribute('aria-selected')).toBe('true');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Apple' }).id);
  });

  it('moves with the arrow keys past disabled options, picks with Enter, and closes with Escape', () => {
    const onChange = vi.fn();
    render(<Fruit onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Cherry' }).id);
    fireEvent.keyDown(trigger, { key: 'End' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('date');
    expect(trigger.textContent).toBe('Date');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks on disabled options, closes on an outside click, and jumps by typing', () => {
    const onChange = vi.fn();
    render(<Fruit onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Fruit' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Banana' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(trigger, { key: 'c' });
    expect(onChange).toHaveBeenCalledWith('cherry');
  });
});
