// API reference: Scalar rendering /openapi.json, themed with the site's own tokens (styles/reference.css).
// Scalar's header already shows the title, server, auth and an OpenAPI download, so the page adds no intro of its own.
import { useEffect, useMemo } from 'react';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import '../styles/reference.css';
import { useTheme } from '../theme.ts';

export function Reference() {
  const theme = useTheme();

  // Built once: a new configuration object makes Scalar re-apply it, and remounting it would drop what the
  // visitor typed into its auth panel and test requests.
  const configuration = useMemo(() => ({
    url: '/openapi.json',
    // Examples and "Test request" target this origin.
    servers: [{ url: window.location.origin, description: 'This server' }],
    showDeveloperTools: 'never' as const,
    hideDarkModeToggle: true, // the site header has the toggle
    forceDarkModeState: theme,
    withDefaultFonts: false,
    theme: 'none' as const, // colours, fonts and radii come from the site (reference.css)
  }), []); // the initial theme only: later switches are followed below, not by re-configuring

  // Scalar reads forceDarkModeState only when it mounts, then expresses the mode as a body class.
  // Follow later theme switches by swapping that class the same way Scalar does.
  useEffect(() => {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    document.body.classList.toggle('light-mode', theme === 'light');
  }, [theme]);

  return (
    <main className="reference-page">
      <h1 className="sr-only">API reference</h1>
      <div className="reference-scalar">
        <ApiReferenceReact configuration={configuration} />
      </div>
    </main>
  );
}
