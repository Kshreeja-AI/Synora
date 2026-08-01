import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // getByRole('link') on the marketing landing page computes accessible
    // names/roles across a large DOM tree; that's cheap locally but on a
    // shared, CPU-constrained CI runner it can exceed vitest's 5s default,
    // so this suite gets a longer ceiling than the default.
    testTimeout: 15000,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
});
