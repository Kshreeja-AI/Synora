import { defineConfig } from 'tsup';

/**
 * Production build for the backend.
 *
 * tsc alone is not usable here: the project is ESM (`"type": "module"`), and
 * tsc emits relative imports without the `.js` extension that Node's ESM
 * loader requires, so `node dist/index.js` fails with ERR_MODULE_NOT_FOUND.
 * Bundling with esbuild (via tsup) resolves every internal import at build
 * time, producing a single runnable entrypoint.
 *
 * Workspace packages (@synora/*) are bundled in (`noExternal`) because they
 * are private and share the same ESM-extension issue; all real npm
 * dependencies — including the argon2 native addon and @prisma/client with
 * its generated engine — stay external and are resolved from node_modules at
 * runtime, exactly as they are today.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@synora\//],
  skipNodeModulesBundle: true,
  // A single self-contained entry; no split chunks to reason about at deploy.
  splitting: false,
});
