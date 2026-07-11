import { defineConfig } from '@playwright/test';

/** DEFAULT_E2E_FRAMEWORK=playwright — API-level smoke test against the built server. */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  webServer: {
    command: 'node dist/main.js',
    url: 'http://127.0.0.1:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { PORT: '3000' },
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
});
