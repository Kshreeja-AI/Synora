/**
 * Plugin registry tests.
 *
 * The assertion this file exists for is the refusal: a manifest that wants
 * to run code is rejected, and rejected with a message that says why.
 * Everything else here protects the permission model — a grant is exactly
 * what was declared, a disabled plugin can act on none of it, and an
 * unrecognised permission is refused rather than quietly dropped, because
 * a silently narrowed grant produces a plugin that half-works for reasons
 * nobody can see.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKeyedStore } from '../../agents/agent-stores';
import {
  contributedTemplates,
  forgetPlugin,
  getPlugin,
  hydratePlugins,
  installPlugin,
  listPlugins,
  persistPlugin,
  pluginHasPermission,
  resetPlugins,
  setPluginState,
  setPluginStore,
  uninstallPlugin,
  validateManifest,
} from '../plugin-registry';
import type { InstalledPlugin, PluginManifest } from '../types';

const WS = 'ws_alpha';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'acme.summariser',
    name: 'Summariser',
    version: '1.0.0',
    description: 'Adds a summarising template.',
    publisher: 'acme',
    permissions: [],
    contributions: {},
    ...overrides,
  };
}

const contributedTemplate = {
  kind: 'agent' as const,
  id: 'tpl_acme_sum',
  name: 'Acme summariser',
  description: 'Summarises things.',
  category: 'analysis' as const,
  outcome: 'I want the short version.',
  instructions: 'Summarise faithfully and add nothing.',
  suggestedTools: [],
};

beforeEach(() => {
  resetPlugins();
  setPluginStore(new InMemoryKeyedStore<InstalledPlugin>());
});

describe('manifest validation', () => {
  it('accepts a minimal, well-formed manifest', () => {
    expect(() => validateManifest(manifest())).not.toThrow();
  });

  it('REFUSES a plugin that wants to run code, and says why', () => {
    // The central refusal. Executing untrusted code needs a real isolate;
    // calling an unisolated function a sandbox would claim a protection
    // that does not exist.
    expect(() => validateManifest(manifest({ entryPoint: 'index.js' }))).toThrow(
      /cannot do safely yet/,
    );
    expect(() => validateManifest(manifest({ entryPoint: 'index.js' }))).toThrow(/real isolate/);
  });

  it('refuses execution permissions specifically, not as "unknown"', () => {
    expect(() =>
      validateManifest(manifest({ permissions: ['code:execute'] })),
    ).toThrow(/requires an execution isolate/);
    expect(() =>
      validateManifest(manifest({ permissions: ['network:outbound'] })),
    ).toThrow(/requires an execution isolate/);
  });

  it('refuses an unknown permission rather than dropping it', () => {
    expect(() =>
      validateManifest(manifest({ permissions: ['filesystem:write' as never] })),
    ).toThrow(/unknown plugin permission/);
  });

  it('requires a namespaced id', () => {
    expect(() => validateManifest(manifest({ id: 'summariser' }))).toThrow(/publisher\.name/);
    expect(() => validateManifest(manifest({ id: 'Acme.Summariser' }))).toThrow(/publisher\.name/);
  });

  it('requires the contribute permission before accepting contributions', () => {
    // Fail closed: contributing without declaring it would make the
    // permission list a description rather than a control.
    expect(() =>
      validateManifest(
        manifest({ permissions: [], contributions: { templates: [contributedTemplate] } }),
      ),
    ).toThrow(/without asking for/);
  });

  it('refuses a contributed template that names a tool id', () => {
    expect(() =>
      validateManifest(
        manifest({
          permissions: ['templates:contribute'],
          contributions: {
            templates: [{ ...contributedTemplate, suggestedTools: ['tool_abc123'] }],
          },
        }),
      ),
    ).toThrow(/names a tool id/);
  });

  it('refuses a contributed workflow template that could never run', () => {
    expect(() =>
      validateManifest(
        manifest({
          permissions: ['templates:contribute'],
          contributions: {
            templates: [
              {
                ...contributedTemplate,
                kind: 'workflow',
                // Two steps sharing an id: the engine would reject this
                // plan, so accepting it here would ship a trap.
                steps: [
                  { id: 's1', kind: 'generate', description: 'a', input: 'a' },
                  { id: 's1', kind: 'generate', description: 'b', input: 'b' },
                ],
              },
            ],
          },
        }),
      ),
    ).toThrow(/could never run/);
  });
});

describe('the plugin lifecycle', () => {
  it('installs enabled, granting exactly what was declared', () => {
    const plugin = installPlugin({
      workspaceId: WS,
      manifest: manifest({ permissions: ['workspace:read'] }),
      installedBy: 'u1',
    });

    expect(plugin.state).toBe('enabled');
    expect(plugin.grantedPermissions).toEqual(['workspace:read']);
  });

  it('refuses a second install of the same plugin in one workspace', () => {
    installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' });
    expect(() =>
      installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' }),
    ).toThrow(/already installed/);
  });

  it('lets the same plugin be installed in a different workspace', () => {
    installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' });
    expect(() =>
      installPlugin({ workspaceId: 'ws_other', manifest: manifest(), installedBy: 'u2' }),
    ).not.toThrow();
    expect(listPlugins(WS)).toHaveLength(1);
    expect(listPlugins('ws_other')).toHaveLength(1);
  });

  it('scopes lookup to the workspace', () => {
    installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' });
    expect(getPlugin('acme.summariser', 'ws_other')).toBeNull();
    expect(getPlugin('acme.summariser', WS)).not.toBeNull();
  });

  it('disables and re-enables', () => {
    installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' });
    expect(setPluginState('acme.summariser', WS, 'disabled').state).toBe('disabled');
    expect(setPluginState('acme.summariser', WS, 'enabled').state).toBe('enabled');
  });

  it('uninstalls', () => {
    installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' });
    expect(uninstallPlugin('acme.summariser', WS)).toBe(true);
    expect(getPlugin('acme.summariser', WS)).toBeNull();
    expect(uninstallPlugin('acme.summariser', WS)).toBe(false);
  });
});

describe('permission checks', () => {
  it('grants only what was declared', () => {
    const plugin = installPlugin({
      workspaceId: WS,
      manifest: manifest({ permissions: ['workspace:read'] }),
      installedBy: 'u1',
    });
    expect(pluginHasPermission(plugin, 'workspace:read')).toBe(true);
    expect(pluginHasPermission(plugin, 'templates:contribute')).toBe(false);
  });

  it('a disabled plugin has no permissions at all', () => {
    installPlugin({
      workspaceId: WS,
      manifest: manifest({ permissions: ['workspace:read'] }),
      installedBy: 'u1',
    });
    const disabled = setPluginState('acme.summariser', WS, 'disabled');
    // Otherwise the switch is decorative: the record still says granted,
    // so the check has to consider state as well.
    expect(pluginHasPermission(disabled, 'workspace:read')).toBe(false);
    expect(disabled.grantedPermissions).toEqual(['workspace:read']);
  });
});

describe('contributed templates', () => {
  function installContributor() {
    return installPlugin({
      workspaceId: WS,
      manifest: manifest({
        permissions: ['templates:contribute'],
        contributions: { templates: [contributedTemplate] },
      }),
      installedBy: 'u1',
    });
  }

  it('surfaces templates from an enabled plugin', () => {
    installContributor();
    expect(contributedTemplates(WS).map((t) => t.id)).toEqual(['tpl_acme_sum']);
  });

  it('stops surfacing them the moment the plugin is disabled', () => {
    installContributor();
    setPluginState('acme.summariser', WS, 'disabled');
    // Checked at read time rather than cached from install, so disabling
    // takes effect now instead of at some later refresh.
    expect(contributedTemplates(WS)).toEqual([]);
  });

  it('does not leak contributions across workspaces', () => {
    installContributor();
    expect(contributedTemplates('ws_other')).toEqual([]);
  });
});

describe('durability', () => {
  it('restores an installed plugin with its grant intact', async () => {
    installPlugin({
      workspaceId: WS,
      manifest: manifest({ permissions: ['workspace:read'] }),
      installedBy: 'u1',
    });
    await persistPlugin('acme.summariser', WS);

    resetPlugins();
    expect(await hydratePlugins()).toEqual({ loaded: 1, discarded: 0 });
    expect(getPlugin('acme.summariser', WS)?.grantedPermissions).toEqual(['workspace:read']);
  });

  it('an uninstalled plugin does not come back after a restart', async () => {
    installPlugin({ workspaceId: WS, manifest: manifest(), installedBy: 'u1' });
    await persistPlugin('acme.summariser', WS);
    uninstallPlugin('acme.summariser', WS);
    await forgetPlugin('acme.summariser', WS);

    resetPlugins();
    await hydratePlugins();
    // A resurrection would restore permissions nobody re-granted.
    expect(getPlugin('acme.summariser', WS)).toBeNull();
  });

  it('discards a stored plugin whose manifest no longer validates', async () => {
    const store = new InMemoryKeyedStore<InstalledPlugin>();
    setPluginStore(store);
    await store.save(`${WS}::bad.plugin`, {
      id: `${WS}::bad.plugin`,
      workspaceId: WS,
      // An older or tampered record asking for code execution.
      manifest: manifest({ id: 'bad.plugin', entryPoint: 'index.js' }),
      state: 'enabled',
      grantedPermissions: [],
      installedBy: 'u1',
      installedAt: 1,
      updatedAt: 1,
    });

    // Discarded whole, unlike a canvas which keeps its good blocks: a
    // plugin record is a permission grant, and acting on one nobody made
    // is worse than losing the install.
    expect(await hydratePlugins()).toEqual({ loaded: 0, discarded: 1 });
    expect(getPlugin('bad.plugin', WS)).toBeNull();
  });
});
