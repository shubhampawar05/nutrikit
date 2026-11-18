// A styled dropdown that replaces the browser's <select>: a button showing the choice, and a list that opens under it
// (or above it, near the bottom of the screen). It follows the ARIA "select-only combobox" pattern, so it works the way
// a native select does from the keyboard: arrows, Home/End, Enter/Space to pick, Escape to close, and typing a few
// letters jumps to the first option that starts with them.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.tsx';

export type SelectOption<V extends string = string> = { value: V; label: string; disabled?: boolean };

type Props<V extends string> = {
  value: V;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
};

type Place = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

const GAP = 6;
const MAX_HEIGHT = 280;

export function Select<V extends string>({ value, onChange, options, id, name, disabled, className, ...aria }: Props<V>) {
  const auto = useId();
  const buttonId = id ?? `select-${auto}`;
  const listId = `${buttonId}-list`;
  const optionId = (i: number) => `${buttonId}-opt-${i}`;

  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i]!.disabled;

  /** The next enabled option from `from` in `step` direction (wrapping off), or `from` when there is none. */
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  const show = (at?: number) => {
    if (disabled) return;
    setActive(at ?? (enabled(selectedIndex) ? selectedIndex : first()));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (i: number) => {
    if (!enabled(i)) return;
    if (options[i]!.value !== value) onChange(options[i]!.value);
    close();
  };

  // Place the list against the button in viewport coordinates, so a table's scroll box or a card's overflow can't clip it.
  const measure = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const up = below < Math.min(MAX_HEIGHT, options.length * 44) && above > below;
    setPlace({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      maxHeight: Math.max(120, Math.min(MAX_HEIGHT, up ? above : below)),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A click anywhere else closes the list without taking focus away from what was clicked.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted option in view while moving through a long list.
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  /** Typeahead: letters typed within half a second build one search; a repeated single letter cycles through matches. */
  const seek = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 500 ? ch : t.text + ch;
    t.at = now;
    const query = t.text.length > 1 && [...t.text].every((c) => c === ch) ? ch : t.text;
    const from = open ? active : selectedIndex;
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + (query.length === 1 ? k : k - 1) + n) % n;
      if (enabled(i) && options[i]!.label.toLowerCase().startsWith(query.toLowerCase())) {
        if (open) setActive(i);
        else if (options[i]!.value !== value) onChange(options[i]!.value);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        e.preventDefault();
        show();
      } else if (key === 'Home') { e.preventDefault(); show(first()); }
      else if (key === 'End') { e.preventDefault(); show(last()); }
      else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) seek(key);
      return;
    }
    switch (key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => step(i, 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive((i) => step(i, -1)); break;
      case 'Home': case 'PageUp': e.preventDefault(); setActive(first()); break;
      case 'End': case 'PageDown': e.preventDefault(); setActive(last()); break;
      case 'Enter': case ' ': e.preventDefault(); pick(active); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': close(false); break;
      default: if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) seek(key);
    }
  };

  return (
    <span className={`select${className ? ` ${className}` : ''}`}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        role="combobox"
        className="input select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? ''}</span>
        <Icon name="chevron" className="icon select-chevron" />
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {open && place ? createPortal(
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-labelledby={aria['aria-label'] ? undefined : buttonId}
          aria-label={aria['aria-label']}
          className={`select-list${place.bottom != null ? ' up' : ''}`}
          style={{ left: place.left, minWidth: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
          tabIndex={-1}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={`select-option${i === active ? ' active' : ''}`}
              onPointerMove={() => { if (enabled(i) && i !== active) setActive(i); }}
              // Keep focus on the button, so the list stays open and keyboard use continues after a click.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span>{o.label}</span>
              {o.value === value ? <Icon name="check" className="icon select-check" /> : null}
            </li>
          ))}
        </ul>,
        document.body,
      ) : null}
    </span>
  );
}
