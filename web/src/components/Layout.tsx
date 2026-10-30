// Shared chrome for every page: header (with a dashboard shortcut once signed in) and footer.
import { useEffect, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation, type Location } from 'react-router';
import { Icon, Logo } from './Icon.tsx';
import { useMe } from '../hooks.ts';

const NAV: [string, string][] = [
  ['/docs', 'Docs'],
  ['/docs/reference', 'API reference'],
  ['/pricing', 'Pricing'],
  ['/playground', 'Playground'],
];

function Header() {
  const { pathname } = useLocation();
  const here = pathname.replace(/\/+$/, '') || '/';
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const me = useMe();

  useEffect(() => setOpen(false), [pathname]);
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
        <nav className="nav" aria-label="Main">
          {NAV.map(([href, label]) => (
            <Link key={href} to={href} aria-current={here === href ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          {me.data ? (
            <Link className="btn btn-primary btn-sm" to="/dashboard">Dashboard <span className="arrow">→</span></Link>
          ) : (
            <>
              <Link className="btn btn-ghost btn-sm" to="/login">Log in</Link>
              <Link className="btn btn-primary btn-sm" to="/signup">Get an API key</Link>
            </>
          )}
        </div>
        <button className="menu-btn" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="menu" />
        </button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Link className="logo" to="/"><Logo lines="#141412" />nutrikit</Link>
            <p style={{ marginTop: 16, maxWidth: '30ch' }}>Nutrition data and food logging for developers. One key, one SDK, honest pricing.</p>
          </div>
          <div><h4>Product</h4><ul><li><Link to="/#how">How it works</Link></li><li><Link to="/pricing">Pricing</Link></li><li><Link to="/playground">Playground</Link></li></ul></div>
          <div><h4>Developers</h4><ul><li><Link to="/docs">Documentation</Link></li><li><Link to="/docs/reference">API reference</Link></li><li><a href="/openapi.json">OpenAPI spec</a></li><li><a href="/sdk/nutrikit.mjs">JavaScript SDK</a></li></ul></div>
          <div><h4>Account</h4><ul><li><Link to="/signup">Sign up</Link></li><li><Link to="/login">Log in</Link></li><li><Link to="/dashboard">Dashboard</Link></li></ul></div>
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
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
      <ScrollRestoration getKey={scrollKey} />
      <HashScroll />
    </>
  );
}
