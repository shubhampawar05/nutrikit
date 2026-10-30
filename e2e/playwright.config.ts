import { defineConfig, devices } from '@playwright/test';

// Runs against a live stack: `docker compose up -d --build --wait` (http://localhost:8787) or any
// deployment via E2E_BASE_URL. Browsers are installed inside node_modules (PLAYWRIGHT_BROWSERS_PATH=0).
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8787',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
