// API reference: the legacy heading and intro, then Scalar rendering /openapi.json.
import { Link } from 'react-router';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import '../styles/reference.css';

export function Reference() {
  return (
    <main className="reference-page">
      <div className="wrap reference-head">
        <article className="docs-content">
          <h1>API reference</h1>
          <p className="lead">Generated from the <a href="/openapi.json">OpenAPI 3.1 spec</a>. Base URL: <code>{window.location.origin}</code>. Authenticate with <code>Authorization: Bearer nk_…</code> or an access token — see <Link to="/docs#authentication">Authentication</Link>.</p>
        </article>
      </div>
      <div className="reference-scalar">
        <ApiReferenceReact
          configuration={{
            url: '/openapi.json',
            // Like the legacy page, examples and "Test request" target this origin.
            servers: [{ url: window.location.origin, description: 'This server' }],
            showDeveloperTools: 'never',
            hideDarkModeToggle: true, // follow the system theme, as site.css does
            withDefaultFonts: false,
          }}
        />
      </div>
    </main>
  );
}
