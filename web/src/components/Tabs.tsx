// Tab group: a row of .tab buttons and the selected panel (the legacy .code-card[data-tabs]).
import { useState, type ReactNode } from 'react';

export function Tabs({ tabs, className = 'code-card', listClassName = 'tabs' }: { tabs: { id: string; label: ReactNode; panel: ReactNode }[]; className?: string; listClassName?: string }) {
  const [current, setCurrent] = useState(tabs[0]?.id);
  return (
    <div className={className}>
      <div className={listClassName} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} className="tab" type="button" role="tab" aria-selected={t.id === current} onClick={() => setCurrent(t.id)}>{t.label}</button>
        ))}
      </div>
      {tabs.map((t) => <div key={t.id} role="tabpanel" hidden={t.id !== current}>{t.panel}</div>)}
    </div>
  );
}
