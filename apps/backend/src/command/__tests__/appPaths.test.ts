/**
 * Every `appPath` the catalogue names must be a page that really exists.
 *
 * WHY THIS FILE EXISTS AT ALL. The catalogue already shipped one address
 * that led nowhere (`.../agents/runs/waiting`), and the test meant to
 * prevent it checked only that the string looked like an address. `appPath`
 * is the same hazard pointed at a person instead of a program: sending
 * someone who asked for help to a page that 404s is worse than telling them
 * nothing, because it costs them a click, a wait, and the belief that
 * Synora knows its own product.
 *
 * So this walks the Next app router on disk. It reads the FRONTEND from the
 * backend's test suite, which is unusual and deliberate: the claim being
 * checked is a cross-boundary one, and a check confined to the side that
 * makes the claim could never detect it being wrong. Route groups —
 * `(dashboard)`, `(marketing)` — are parentheses in the folder name and
 * absent from the URL, so they are stripped exactly as Next strips them.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { routesForIntent } from '../capabilities';
import type { CommandIntent } from '../types';

const APP_DIR = join(process.cwd(), '../web/src/app');

const INTENTS: CommandIntent[] = [
  'find',
  'ask',
  'create',
  'automate',
  'plan',
  'decide',
  'monitor',
  'communicate',
  'control',
];

/** URL paths served by a `page.tsx`, with route groups removed. */
function collectPages(dir: string, urlPrefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  if (existsSync(join(dir, 'page.tsx'))) found.push(urlPrefix || '/');

  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    if (!statSync(child).isDirectory()) continue;
    // Private folders and dynamic/catch-all segments are not literal paths.
    if (entry.startsWith('_') || entry.startsWith('[') || entry === '__tests__') continue;
    // A route group contributes nothing to the URL.
    const segment = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
    found.push(...collectPages(child, urlPrefix + segment));
  }
  return found;
}

describe('capability app paths', () => {
  const pages = new Set(collectPages(APP_DIR));

  it('finds the app’s pages at all, so an empty set can never pass this file', () => {
    // Without this, moving the web app would turn every assertion below into
    // a comparison against nothing — green, and proving the opposite.
    expect(pages.size).toBeGreaterThan(10);
    expect(pages.has('/dashboard')).toBe(true);
  });

  it('names only pages a person can actually open', () => {
    const missing = INTENTS.flatMap((intent) => routesForIntent(intent))
      .filter((route) => route.appPath)
      .filter((route) => !pages.has(route.appPath!))
      .map((route) => `${route.capabilityId} -> ${route.appPath}`);

    expect(missing).toEqual([]);
  });
});
