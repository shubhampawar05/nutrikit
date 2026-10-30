import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies the API to Fastify (npm run dev -w server), so the
// portal's session cookie stays same-origin. In production Fastify serves dist/ itself.
const API = process.env.NUTRIKIT_API || 'http://localhost:8787';
const proxied = ['/v1', '/portal', '/webhooks', '/openapi.json', '/sdk'];

export default defineConfig({
  plugins: [react()],
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
