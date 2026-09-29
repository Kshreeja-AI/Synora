/**
 * Every surface the capability catalogue claims must be a route the app
 * ACTUALLY REGISTERS.
 *
 * WHY THIS TEST EXISTS, WRITTEN HONESTLY. `capabilities.ts` opens by saying
 * a command layer's characteristic failure is confidently routing a request
 * to a capability that was only ever a plan — and then claims a test keeps
 * it honest. The test that existed only checked the surface STRING SHAPE
 * (`^(GET|POST|...) /api/`). It passed happily for
 * `GET /api/workspaces/:workspaceId/agents/runs/waiting`, a route that has
 * never existed in this repository.
 *
 * So the file's own stated discipline was not enforced, and the gap was
 * found by trying to bind the capability rather than by the test meant to
 * prevent it. This walks the real Express router instead.
 *
 * Parameter NAMES are normalized away (`:workspaceId` and `:id` compare
 * equal). What matters is that a route with that shape is mounted; what a
 * handler happens to call its parameter is not a fact about the platform.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { initConfig } from '../../config';
import { allClaimedSurfaces } from '../capabilities';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
}

/** `/api/workspaces/:workspaceId/search` -> `/api/workspaces/:/search` */
function normalize(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, ':');
}

function mountPrefix(layer: Layer): string {
  const source = layer.regexp?.source ?? '';
  return source
    .replace('^\\', '')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');
}

function collectRoutes(stack: Layer[], prefix = ''): string[] {
  const found: string[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push(`${method.toUpperCase()} ${normalize(prefix + layer.route.path)}`);
      }
    } else if (layer.handle?.stack) {
      found.push(...collectRoutes(layer.handle.stack, prefix + mountPrefix(layer)));
    }
  }
  return found;
}

describe('capability catalogue surfaces', () => {
  let registered: Set<string>;

  beforeAll(async () => {
    const config = await initConfig();
    const app = createApp(config) as Express & { _router: { stack: Layer[] } };
    registered = new Set(collectRoutes(app._router.stack));
  });

  it('finds the app’s routes at all, so an empty set can never pass this file', () => {
    // Without this, a change to Express internals would silently turn every
    // assertion below into a comparison against nothing — a green test
    // proving the opposite of what it claims.
    expect(registered.size).toBeGreaterThan(50);
  });

  it('claims only surfaces the app actually mounts', () => {
    const missing = allClaimedSurfaces().filter(
      (surface) => !registered.has(normalize(surface))
    );
    // Named individually: "3 surfaces are wrong" sends someone hunting,
    // while the list sends them straight to the line to fix.
    expect(missing).toEqual([]);
  });
});
