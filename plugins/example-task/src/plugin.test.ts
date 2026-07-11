import { describe, expect, it } from 'vitest';
import { exampleTaskPlugin } from './plugin.js';

// register() needs a live Postgres connection resolved from the DI container (see
// apps/api-gateway's composition root for the full wiring) — covered by an e2e smoke test
// there instead of a unit test here. This just locks down the plugin's identity contract.
describe('exampleTaskPlugin', () => {
  it('declares a stable id and version', () => {
    expect(exampleTaskPlugin.id).toBe('example-task');
    expect(exampleTaskPlugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has no unresolved plugin dependencies', () => {
    expect(exampleTaskPlugin.dependsOn ?? []).toEqual([]);
  });
});
