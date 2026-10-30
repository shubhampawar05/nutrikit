// Stroke icons on a 24px grid, drawn with the site's .icon class.
const ICONS = {
  text: <><path d="M4 6h16M4 11h10M4 16h13" /><path d="M17 15.5l2 2 3-4" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.5" /></>,
  barcode: <path d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12M3 4h3M18 4h3M3 20h3M18 20h3" />,
  label: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 10.5h8M8 14h5M8 17h3" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  scale: <path d="M12 4v16M6 20h12M5 8h14M7.5 8 4.5 14a3 3 0 0 0 6 0zM16.5 8l-3 6a3 3 0 0 0 6 0z" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4M8 14h3M8 17h6" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l3 3M14 9l2 2" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  code: <path d="M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5M13.5 5l-3 14" />,
  chart: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
  leaf: <><path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15" /><path d="M5 19 13 11" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'icon' }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

/** Logo: a food label with a folded tomato corner. */
export function Logo({ lines = 'var(--paper)' }: { lines?: string }) {
  return (
    <svg className="logo-mark" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M5 3h12l6 6v16H5z" fill="currentColor" />
      <path d="M17 3v6h6z" fill="#e0462b" />
      <path d="M9 13h10M9 17h10M9 21h6" stroke={lines} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
