/**
 * The frontend's production packaging contract.
 *
 * Until this shipped there was no way to deploy the user-facing site at
 * all — `docs/deployment.md` said so outright. A deployment could stand up
 * a fully working API with nothing in front of it.
 *
 * WHAT THESE TESTS ARE, HONESTLY. The behaviour was verified by hand, once,
 * end to end: a real production build with a distinctive URL, the resulting
 * standalone server started, `/api/health` and `/` both answering 200, the
 * URL present in the browser bundles and in the Content-Security-Policy,
 * and the stylesheet served — plus the same stylesheet failing when the
 * static directory was withheld, which is what proves that copy step is
 * load-bearing rather than decorative.
 *
 * A build takes minutes and cannot live in a unit test, so what these
 * assertions do is hold the CONFIGURATION that manual run depended on.
 * Each one corresponds to a failure actually observed or reasoned through,
 * and each failure is silent: the server starts, reports itself healthy,
 * and serves a broken site. Configuration nobody can see going wrong is
 * exactly the kind worth pinning.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

/** Executable lines only — these files explain their own history at length. */
function code(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed !== '' &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/*') &&
        !trimmed.startsWith('#')
      );
    })
    .join('\n');
}

describe('the web app builds into something deployable', () => {
  it('emits a self-contained server rather than needing the whole workspace', () => {
    // Without this the built site needs the entire node_modules tree — in
    // this pnpm workspace a forest of symlinks into a shared store that
    // does not survive being copied anywhere. Measured on a real build:
    // 69 MB of standalone output against 1.1 GB of workspace
    // node_modules, on a box with 50 GB of disk shared with Postgres,
    // Redis and the API.
    expect(code(read('apps/web/next.config.js'))).toMatch(/output:\s*'standalone'/);
  });

  it('traces from the repository root, not from apps/web', () => {
    // The tracer decides which files to copy by following imports. Left to
    // itself it stops at this app and misses @synora/design-system and
    // @synora/shared, which live outside this directory. The build still
    // succeeds; the server then dies at startup on a module it cannot
    // find — a failure that appears only in production.
    expect(code(read('apps/web/next.config.js'))).toMatch(/outputFileTracingRoot/);
  });
});

describe('the production image copies what standalone leaves behind', () => {
  const dockerfile = read('Dockerfile.web');

  it('copies .next/static — without it the site renders unstyled', () => {
    // Verified by removing it from a running standalone server: the
    // stylesheet request went from 200 to a failure, and the page came
    // back with no styling at all. Next omits this directory on purpose,
    // assuming a CDN serves it. Nothing here uses a CDN.
    expect(code(dockerfile)).toMatch(/COPY[^\n]*\.next\/static/);
  });

  it('copies public/ — without it images and the favicon 404', () => {
    expect(code(dockerfile)).toMatch(/COPY[^\n]*\/public/);
  });

  it('starts the traced server from its workspace path', () => {
    // The traced output preserves the monorepo layout because the tracing
    // root is the repository root, so the entry point is
    // apps/web/server.js — not server.js, which is where every
    // single-package Next.js example puts it.
    expect(code(dockerfile)).toMatch(/CMD \["node", "apps\/web\/server\.js"\]/);
  });

  it('binds all interfaces, or no reverse proxy can reach it', () => {
    // The standalone server defaults to loopback INSIDE the container,
    // where nothing outside it — port mapping or proxy — can connect.
    // The container then looks perfectly healthy and refuses every
    // request.
    expect(code(dockerfile)).toMatch(/ENV HOSTNAME=0\.0\.0\.0/);
  });

  it('takes the public API URL as a build argument, because it is baked in', () => {
    // NEXT_PUBLIC_* values are substituted into the JavaScript the browser
    // downloads, so there is nothing left to configure once the server
    // starts. A build made without the real domain produces a site that
    // calls localhost from the visitor's own machine, behind a CSP that
    // forbids the real domain.
    expect(code(dockerfile)).toMatch(/ARG NEXT_PUBLIC_API_URL/);
  });

  it('passes NO secret as a build argument', () => {
    // Build arguments are recoverable from a finished image. A public URL
    // is safe precisely because every visitor already reads it out of the
    // page source; a key, token or password never is. The frontend needs
    // no secrets at all, so the correct number of secret-bearing build
    // arguments here is zero, and this fails loudly if one is ever added.
    const args = [...code(dockerfile).matchAll(/^ARG\s+([A-Z0-9_]+)/gm)].map((m) => m[1]);
    const secretish = args.filter((name) =>
      /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PRIVATE/.test(name)
    );
    expect(secretish, `secret-looking build args: ${secretish.join(', ')}`).toEqual([]);
  });

  it('runs as a non-root user', () => {
    expect(code(dockerfile)).toMatch(/^USER node$/m);
  });
});

describe('the health probe', () => {
  it('answers for the web server alone, never the backend', async () => {
    // A probe that also called the API would report the frontend as down
    // during a backend restart, and the supervisor would restart a healthy
    // web server — one outage becoming two.
    const { GET } = await import('../api/health/route');
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'web' });
  });

  it('is never prerendered — a probe that cannot fail is not a probe', async () => {
    // Statically generated, it would serve 200 from a cached file with the
    // server wedged.
    const route = await import('../api/health/route');
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('is the endpoint the image actually probes', async () => {
    // Pins the two halves together. A rename on either side leaves a
    // container that reports itself permanently unhealthy, or a probe
    // pointed at a route that no longer exists.
    expect(read('Dockerfile.web')).toContain('/api/health');
  });
});
