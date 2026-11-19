// Shared chrome for every page: header (with a dashboard shortcut once signed in) and footer.
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation, type Location } from 'react-router';
import { Icon, Logo } from './Icon.tsx';
import { useMe } from '../hooks.ts';
import { usePageMeta } from '../seo.ts';
import { PAYMENTS_VISIBLE } from '../features.ts';

const NAV: [string, string][] = [
  ['/docs', 'Docs'],
  ['/docs/reference', 'API reference'],
  ...(PAYMENTS_VISIBLE ? [['/pricing', 'Pricing'] as [string, string]] : []),
  ['/playground', 'Playground'],
];

function Header() {
  const { pathname } = useLocation();
  const here = pathname.replace(/\/+$/, '') || '/';
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const me = useMe();

  useEffect(() => setOpen(false), [pathname]);
  // Escape closes the mobile menu and returns focus to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`site-header${open ? ' open' : ''}${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap">
        <Link className="logo" to="/"><Logo />nutrikit</Link>
        <nav className="nav" id="site-nav" aria-label="Main">
          {NAV.map(([href, label]) => (
            <Link key={href} to={href} aria-current={here === href ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          {me.data ? (
            <Link className="btn btn-primary btn-sm" to="/dashboard">Dashboard <span className="arrow">→</span></Link>
          ) : (
            <>
              <Link className="header-link" to="/login">Log in</Link>
              <Link className="btn btn-primary btn-sm" to="/signup">Get an API key</Link>
            </>
          )}
        </div>
        <button ref={menuButton} className="menu-btn" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(!open)}>
          <Icon name="menu" />
        </button>
      </div>
    </header>
  );
}

const FOOTER_LINKS: [string, string, boolean][] = [
  ['/docs', 'Documentation', false],
  ['/docs/reference', 'API reference', false],
  ...(PAYMENTS_VISIBLE ? [['/pricing', 'Pricing', false] as [string, string, boolean]] : []),
  ['/openapi.json', 'OpenAPI', true],
  ['https://www.npmjs.com/package/@nutrikit/sdk', 'SDK', true],
  ['https://github.com/shubhampawar05/nutrikit', 'GitHub', true],
  ['/privacy', 'Privacy', false],
  ['/terms', 'Terms', false],
];

function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-top">
          <Link className="logo" to="/"><Logo />nutrikit</Link>
          <nav className="footer-links" aria-label="Footer">
            {FOOTER_LINKS.map(([href, label, external]) => external
              ? <a key={href} href={href} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}>{label}</a>
              : <Link key={href} to={href}>{label}</Link>)}
          </nav>
        </div>
        <div className="footer-bottom">
          <span>Food data: USDA FoodData Central (public domain) · Open Food Facts (ODbL)</span>
          <span>Nutrition values are estimates, not medical advice.</span>
        </div>
      </div>
    </footer>
  );
}

// Pages load lazily, after the browser's own jump to #section, and the router's scroll handling runs
// around the same time. So wait (up to ~2 s) for the section to exist and jump to it (/#how,
// /docs#errors). Smooth scrolling (site.css) is paused meanwhile, so no animated scroll started
// by the router can carry the page somewhere else; like the browser's own anchor jump, this is instant.
function HashScroll() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const root = document.documentElement;
    root.style.scrollBehavior = 'auto';
    let timer = 0;
    let tries = 0;
    const done = () => { root.style.scrollBehavior = ''; };
    // Timers rather than animation frames, which a background tab may never run.
    const jump = () => {
      const el = document.getElementById(id);
      if (!el) {
        if (++tries < 100) timer = window.setTimeout(jump, 20);
        else done();
        return;
      }
      el.scrollIntoView?.();
      timer = window.setTimeout(() => { el.scrollIntoView?.(); done(); }, 150);
    };
    timer = window.setTimeout(jump, 0);
    return () => { clearTimeout(timer); done(); };
  }, [pathname, hash]);
  return null;
}

// Every fresh page load has the location key 'default', so the router would restore whatever position
// any earlier load saved under it. A fresh load of /page#section must go to the section instead.
const scrollKey = (location: Location) =>
  location.hash && location.key === 'default' ? `fresh-${Math.random()}` : location.key;

export function Layout() {
  usePageMeta();
  return (
    <>
      <a className="skip-link" href="#content">Skip to content</a>
      <Header />
      <div id="content" tabIndex={-1}>
        <Outlet />
      </div>
      <Footer />
      <ScrollRestoration getKey={scrollKey} />
      <HashScroll />
    </>
  );
}
