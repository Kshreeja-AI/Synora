const path = require('path');

/**
 * THE BACKEND ADDRESS IS BAKED IN AT BUILD TIME, NOT READ AT RUN TIME.
 *
 * `NEXT_PUBLIC_*` values are substituted into the JavaScript the browser
 * downloads, so by the time the server starts there is nothing left to
 * configure — the address is already inside the bundle. The same value also
 * ends up in the Content-Security-Policy below, which tells the browser
 * which hosts the page is allowed to contact.
 *
 * The practical consequence, and the one that silently ruins deployments:
 * a build made without the real domain produces a site that tries to reach
 * `localhost:3001` from the visitor's own machine, and a CSP that forbids
 * the real domain. It looks perfectly healthy on the server and is
 * completely broken in the browser. Whatever builds this MUST pass the
 * production URL in — see the `NEXT_PUBLIC_API_URL` build argument in
 * Dockerfile.web, and the test that pins the inlining.
 *
 * This is PUBLIC configuration, never a secret: it is a URL every visitor
 * can read straight out of the page source. Passing it as a build argument
 * is correct precisely because it is public — a real secret must never be
 * a build argument, since build arguments are recoverable from the image.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const apiWsUrl = apiUrl.replace(/^http/, 'ws');

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  /**
   * Ship a self-contained server instead of the whole workspace.
   *
   * Without this, running the built site in production needs the entire
   * `node_modules` tree present — which in this pnpm workspace is a forest
   * of symlinks into a shared store that does not survive being copied
   * anywhere. The backend image ran into the same wall and settled for
   * shipping every dev dependency (see the long comment in `Dockerfile`);
   * that is an accepted cost for one image, not something to repeat.
   *
   * `standalone` makes Next trace the files actually reached at run time
   * and copy the real ones into `.next/standalone`, symlinks resolved. The
   * result starts with plain `node server.js` and is a small fraction of
   * the size — which matters on a 1-vCPU / 4 GB / 50 GB machine, where the
   * frontend shares the box with Postgres, Redis and the API.
   *
   * TWO THINGS IT DOES NOT COPY, by design: `public/` and `.next/static`.
   * Next assumes a CDN usually serves them. Nothing here uses a CDN, so
   * Dockerfile.web copies both explicitly. Forgetting that produces a site
   * that renders with no styling and no images — a failure that looks like
   * a broken app rather than a missing copy step, which is why it is
   * called out here as well as there.
   */
  output: 'standalone',
  /**
   * Trace from the REPOSITORY root, not from `apps/web`.
   *
   * The tracer follows imports to decide which files to copy. Left to
   * itself it infers the root from the nearest lockfile and would stop at
   * this app, missing `@synora/design-system` and `@synora/shared` — which
   * live outside this directory and are imported by nearly every page. The
   * build would succeed and the server would then fail at startup on a
   * module it could not find.
   */
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['@synora/design-system', '@synora/shared'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'via.placeholder.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
  },
  /**
   * SAME-ORIGIN API PROXY.
   *
   * The browser calls `/api/*` and `/socket.io/*` on the website's own
   * origin and this forwards them to the backend. Without it the site and
   * the API are two different SITES, and the `SameSite=Strict` session and
   * CSRF cookies are neither sent nor readable across that boundary — login
   * appears to succeed and every later request is anonymous.
   *
   * These are fallback-phase rewrites on purpose: a route this app really
   * serves (`/api/health`, the web server's own probe) is matched first and
   * never forwarded.
   *
   * The destination is the same public URL already baked into the bundle,
   * so there is nothing new to configure — and nothing secret here.
   */
  async rewrites() {
    return {
      fallback: [
        { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
        { source: '/socket.io/:path*', destination: `${apiUrl}/socket.io/:path*` },
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ${apiUrl} ${apiWsUrl} https://api.stripe.com; frame-src 'self'; object-src 'none'`,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
