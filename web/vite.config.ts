import fs from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The server renders each page's <head> (title, description, canonical, Open Graph) and the sitemap from
// the same page list the app uses, so the build ships a copy next to index.html.
const seoManifest: Plugin = {
  name: 'nutrikit-seo-manifest',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'seo.json', source: fs.readFileSync(new URL('./src/seo.json', import.meta.url)) });
  },
};

// In development the Vite server proxies the API to Fastify (npm run dev -w server), so the
// portal's session cookie stays same-origin. In production Fastify serves dist/ itself.
const API = process.env.NUTRIKIT_API || 'http://localhost:8787';
const proxied = ['/v1', '/portal', '/webhooks', '/openapi.json', '/sdk'];

export default defineConfig({
  plugins: [react(), seoManifest],
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: API, changeOrigin: false }])),
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
