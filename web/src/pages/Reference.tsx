// API reference: Scalar rendering /openapi.json, themed with the site's own tokens (styles/reference.css).
// Scalar's header already shows the title, server, auth and an OpenAPI download, so the page adds no intro of its own.
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import '../styles/reference.css';
import { useTheme } from '../theme.ts';

export function Reference() {
  const theme = useTheme();
  return (
    <main className="reference-page">
      <h1 className="sr-only">API reference</h1>
      <div className="reference-scalar">
        <ApiReferenceReact
          key={theme} // Scalar reads forceDarkModeState once, so a theme switch remounts it
          configuration={{
            url: '/openapi.json',
            // Examples and "Test request" target this origin.
            servers: [{ url: window.location.origin, description: 'This server' }],
            showDeveloperTools: 'never',
            hideDarkModeToggle: true, // the site header has the toggle
            forceDarkModeState: theme,
            withDefaultFonts: false,
            theme: 'none', // colours, fonts and radii come from the site (reference.css)
          }}
        />
      </div>
    </main>
  );
}
