// Tabs following the WAI-ARIA tabs pattern: a labelled tablist, each tab paired with its panel, arrow keys
// (Left/Right/Home/End) to move, and only the selected tab in the Tab order.
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem { id: string; label: ReactNode }

/** Ids for a tab and its panel, so a page that renders its own panels can pair them. */
export const tabIds = (prefix: string, id: string) => ({ tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` });

export function TabList({ tabs, current, onChange, label, prefix, className = 'tabs', tabClassName = 'tab' }: {
  tabs: TabItem[];
  current: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab set ("Code samples", "Endpoints"). */
  label: string;
  /** Id prefix shared with the panels (see tabIds). */
  prefix: string;
  className?: string;
  tabClassName?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const ids = tabIds(prefix, t.id);
        const selected = t.id === current;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            id={ids.tab}
            className={tabClassName}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A tab set that owns its panels (the legacy .code-card[data-tabs]). */
export function Tabs({ tabs, label, className = 'code-card', listClassName = 'tabs' }: { tabs: (TabItem & { panel: ReactNode })[]; label: string; className?: string; listClassName?: string }) {
  const [current, setCurrent] = useState(tabs[0]?.id ?? '');
  const prefix = useId().replace(/:/g, '');
  return (
    <div className={className}>
      <TabList tabs={tabs} current={current} onChange={setCurrent} label={label} prefix={prefix} className={listClassName} />
      {tabs.map((t) => {
        const ids = tabIds(prefix, t.id);
        return <div key={t.id} id={ids.panel} role="tabpanel" aria-labelledby={ids.tab} tabIndex={0} hidden={t.id !== current}>{t.panel}</div>;
      })}
    </div>
  );
}
