import { describe, expect, it, vi } from 'vitest';
import {
  DuplicatePluginError,
  MissingPluginDependencyError,
  PluginDependencyCycleError,
  PluginRegistry,
} from './plugin-registry.js';
import type { Plugin, PluginContext } from './plugin.js';

const fakeContext = {} as PluginContext;

function makePlugin(id: string, dependsOn: string[] = [], onRegister?: () => void): Plugin {
  return {
    id,
    version: '0.0.0',
    dependsOn,
    register: vi.fn(async () => {
      onRegister?.();
    }),
  };
}

describe('PluginRegistry', () => {
  it('loads independent plugins', async () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin('a');
    registry.register(plugin);

    await registry.loadAll(fakeContext);

    expect(plugin.register).toHaveBeenCalledWith(fakeContext);
  });

  it('loads dependencies before dependents', async () => {
    const registry = new PluginRegistry();
    const order: string[] = [];
    const a = makePlugin('a', [], () => order.push('a'));
    const b = makePlugin('b', ['a'], () => order.push('b'));
    registry.register(b);
    registry.register(a);

    await registry.loadAll(fakeContext);

    expect(order).toEqual(['a', 'b']);
  });

  it('rejects duplicate plugin ids', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('a'));
    expect(() => registry.register(makePlugin('a'))).toThrow(DuplicatePluginError);
  });

  it('rejects a dependency on an unregistered plugin', async () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('a', ['missing']));
    await expect(registry.loadAll(fakeContext)).rejects.toThrow(MissingPluginDependencyError);
  });

  it('detects dependency cycles', async () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('a', ['b']));
    registry.register(makePlugin('b', ['a']));
    await expect(registry.loadAll(fakeContext)).rejects.toThrow(PluginDependencyCycleError);
  });
});
