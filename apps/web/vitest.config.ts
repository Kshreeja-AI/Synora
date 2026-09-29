import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Next.js provides the `@/*` → `src/*` alias to application code at
// runtime via its tsconfig plugin. Vitest doesn't go through Next, so
// any test that imports (or mocks) something via `@/...` needs the
// alias mirrored here — otherwise the transformer errors before the
// test runs.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules', 'dist', '.next', 'e2e'],
    // Files run one at a time, matching apps/backend's config.
    //
    // Run in parallel this suite failed NON-DETERMINISTICALLY: a first run
    // failed two Sidebar cases and a canvas case, an immediate second run
    // passed all 108, and every failing test passed in isolation. Failures
    // that move between runs are a property of the harness, not of the code
    // under test — and a suite that cries wolf on healthy code is a suite
    // people learn to re-run instead of read.
    //
    // The cost is wall-clock on a suite that already finishes in seconds. The
    // benefit is that a red result means something.
    fileParallelism: false,
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
