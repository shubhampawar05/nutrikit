import { Link } from 'react-router';

export function NotFound() {
  return (
    <main className="wrap" style={{ padding: '96px 0' }}>
      <span className="kicker">404</span>
      <h1>This page isn't on the menu.</h1>
      <p className="lead">The link may be old, or the page has moved.</p>
      <div className="cta-row"><Link className="btn btn-primary" to="/">Back to the homepage</Link><Link className="btn btn-ghost" to="/docs">Read the docs</Link></div>
    </main>
  );
}
