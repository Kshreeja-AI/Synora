import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/** runs under Playwright (`pnpm test:e2e`), not Vitest — see playwright.config.ts.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
