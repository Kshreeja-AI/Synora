import { FileKeyedStore, InMemoryKeyedStore, type KeyedStore } from '../agents/agent-stores.js';
import { validatePlan } from '../agents/run-engine.js';
import type { Template } from '../agents/templates.js';
import {
  EXECUTION_PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  PLUGIN_LIMITS,
  type InstalledPlugin,
  type PluginManifest,
  type PluginPermission,
} from './types.js';

/**
 * Installing, enabling and removing plugins.
 *
 * VALIDATION REFUSES WHAT IT DOES NOT FULLY UNDERSTAND, the same
 * discipline the scheduler applies to schedule shapes and the model
 * planner applies to model output. A manifest with an unrecognised
 * permission is not installed with that permission quietly dropped —
 * silently narrowing what someone asked for produces a plugin that
 * half-works in a way nobody can debug. It is refused, by name.
 *
 * THE PERMISSION GRANT IS EXACTLY WHAT WAS DECLARED, captured at install
 * time onto the installed record. An update that wants more permissions
 * must be a new install decision, because a permission set that can widen
 * after the fact is not consent.
 *
 * CONTRIBUTED TEMPLATES ARE VALIDATED LIKE AUTHORED ONES. A template that
 * could never produce a runnable workflow is refused at INSTALL time
 * rather than discovered by whoever tries to use it — the same
 * authoring-time rule that stops a workflow being saved unrunnable.
 */

const installed = new Map<string, InstalledPlugin>();
let store: KeyedStore<InstalledPlugin> = new InMemoryKeyedStore();

export function setPluginStore(next: KeyedStore<InstalledPlugin>): void {
  store = next;
}
export function createFilePluginStore(filePath: string): KeyedStore<InstalledPlugin> {
  return new FileKeyedStore<InstalledPlugin>(filePath);
}

/** Composite so the same plugin can be installed in two workspaces. */
function keyOf(workspaceId: string, pluginId: string): string {
  return `${workspaceId}::${pluginId}`;
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`a plugin manifest needs a ${field}`);
  }
  if (value.length > max) throw new Error(`plugin ${field} exceeds ${max} characters`);
  return value.trim();
}

export function validateManifest(manifest: PluginManifest): void {
  requireString(manifest.id, 'id', PLUGIN_LIMITS.maxIdLength);
  requireString(manifest.name, 'name', PLUGIN_LIMITS.maxNameLength);
  requireString(manifest.version, 'version', 50);
  requireString(manifest.publisher, 'publisher', PLUGIN_LIMITS.maxNameLength);
  requireString(manifest.description, 'description', PLUGIN_LIMITS.maxDescriptionLength);

  // `publisher.name` — a flat namespace means the first plugin called
  // "summariser" owns the word forever.
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(manifest.id)) {
    throw new Error('a plugin id must look like "publisher.name", lowercase');
  }

  if (manifest.entryPoint !== undefined) {
    // The refusal this whole design exists to make. Specific, so nobody
    // reads it as a validation quirk.
    throw new Error(
      'this plugin wants to run code, which Synora cannot do safely yet: running third-party ' +
        'code needs a real isolate (separate process, VM or WASM) with resource limits, and ' +
        'calling an unisolated function a "sandbox" would claim a protection that does not exist',
    );
  }

  if (!Array.isArray(manifest.permissions)) {
    throw new Error('a plugin manifest needs a permissions list, even if empty');
  }
  for (const permission of manifest.permissions) {
    if (EXECUTION_PERMISSIONS.includes(permission)) {
      throw new Error(
        `the permission "${permission}" cannot be granted yet: it requires an execution isolate ` +
          'that does not exist, and granting it would mean nothing while sounding like it meant something',
      );
    }
    if (!GRANTABLE_PERMISSIONS.includes(permission)) {
      // Refused, not dropped. A quietly narrowed permission set produces a
      // plugin that half-works for reasons nobody can see.
      throw new Error(`unknown plugin permission ${JSON.stringify(String(permission))}`);
    }
  }

  const templates = manifest.contributions?.templates ?? [];
  if (!Array.isArray(templates)) throw new Error('plugin template contributions must be a list');
  if (templates.length > PLUGIN_LIMITS.maxTemplatesPerPlugin) {
    throw new Error(`a plugin contributes at most ${PLUGIN_LIMITS.maxTemplatesPerPlugin} templates`);
  }
  if (templates.length > 0 && !manifest.permissions.includes('templates:contribute')) {
    // Fail closed: contributing without declaring it would make the
    // permission list a description rather than a control.
    throw new Error(
      'this plugin contributes templates without asking for the "templates:contribute" permission',
    );
  }

  for (const template of templates) {
    requireString(template.id, 'template id', PLUGIN_LIMITS.maxIdLength);
    requireString(template.name, 'template name', PLUGIN_LIMITS.maxNameLength);
    // Widened deliberately: a manifest arrives from outside the type
    // system, so the compiler's belief that `kind` is one of two values is
    // an assumption about well-behaved input, not a fact to validate past.
    const kind: string = template.kind;
    if (kind !== 'agent' && kind !== 'workflow') {
      throw new Error(`plugin template ${template.id} has an unknown kind`);
    }
    if (Array.isArray(template.suggestedTools)) {
      for (const suggestion of template.suggestedTools) {
        if (typeof suggestion === 'string' && suggestion.startsWith('tool_')) {
          // Same rule as the built-in catalogue: ids are per-workspace, so
          // a named one would point at something that may not exist here.
          throw new Error(
            `plugin template ${template.id} names a tool id; suggestions must be plain capability names`,
          );
        }
      }
    }
    if (template.kind === 'workflow') {
      const rejection = validatePlan(
        { steps: template.steps ?? [], origin: 'authored' },
        { allowedTools: [], limits: { maxSteps: 20 } },
      );
      if (rejection) {
        throw new Error(`plugin template ${template.id} could never run: ${rejection}`);
      }
    }
  }
}

export function installPlugin(input: {
  workspaceId: string;
  manifest: PluginManifest;
  installedBy: string;
}): InstalledPlugin {
  validateManifest(input.manifest);

  const key = keyOf(input.workspaceId, input.manifest.id);
  if (installed.has(key)) throw new Error('this plugin is already installed in this workspace');

  const count = [...installed.values()].filter((p) => p.workspaceId === input.workspaceId).length;
  if (count >= PLUGIN_LIMITS.maxPerWorkspace) {
    throw new Error(`a workspace holds at most ${PLUGIN_LIMITS.maxPerWorkspace} plugins`);
  }

  const now = Date.now();
  const plugin: InstalledPlugin = {
    id: key,
    workspaceId: input.workspaceId,
    manifest: input.manifest,
    state: 'enabled',
    // Exactly what was declared, frozen at this moment.
    grantedPermissions: [...input.manifest.permissions],
    installedBy: input.installedBy,
    installedAt: now,
    updatedAt: now,
  };
  installed.set(key, plugin);
  return plugin;
}

/** Workspace scoping is part of the lookup, as everywhere else. */
export function getPlugin(pluginId: string, workspaceId: string): InstalledPlugin | null {
  return installed.get(keyOf(workspaceId, pluginId)) ?? null;
}

export function listPlugins(workspaceId: string): InstalledPlugin[] {
  return [...installed.values()]
    .filter((p) => p.workspaceId === workspaceId)
    .sort((a, b) => b.installedAt - a.installedAt);
}

export function setPluginState(
  pluginId: string,
  workspaceId: string,
  state: 'enabled' | 'disabled',
): InstalledPlugin {
  const plugin = getPlugin(pluginId, workspaceId);
  if (!plugin) throw new Error('plugin not found');
  plugin.state = state;
  plugin.updatedAt = Date.now();
  return plugin;
}

export function uninstallPlugin(pluginId: string, workspaceId: string): boolean {
  return installed.delete(keyOf(workspaceId, pluginId));
}

/**
 * Whether a plugin may do a thing, right now. Both conditions matter: a
 * disabled plugin keeps its granted permissions on the record but may act
 * on none of them, which is what "disabled" has to mean or the switch is
 * decorative.
 */
export function pluginHasPermission(
  plugin: InstalledPlugin,
  permission: PluginPermission,
): boolean {
  if (plugin.state !== 'enabled') return false;
  return plugin.grantedPermissions.includes(permission);
}

/**
 * Templates contributed by enabled plugins with the permission to
 * contribute them. Checked at read time rather than trusted from install,
 * so disabling a plugin takes effect immediately.
 */
export function contributedTemplates(workspaceId: string): Template[] {
  const out: Template[] = [];
  for (const plugin of listPlugins(workspaceId)) {
    if (!pluginHasPermission(plugin, 'templates:contribute')) continue;
    out.push(...(plugin.manifest.contributions.templates ?? []));
  }
  return out;
}

export async function persistPlugin(pluginId: string, workspaceId: string): Promise<boolean> {
  const plugin = getPlugin(pluginId, workspaceId);
  if (!plugin) return false;
  await store.save(plugin.id, plugin);
  return true;
}

export async function forgetPlugin(pluginId: string, workspaceId: string): Promise<void> {
  await store.delete(keyOf(workspaceId, pluginId));
}

/**
 * Loads installed plugins at boot. A stored record whose manifest no
 * longer validates is DISCARDED, not repaired — unlike a canvas, where
 * dropping one bad block preserves the surface around it. A plugin is a
 * permission grant: loading a partially-understood one would mean acting
 * on a grant nobody made.
 */
export async function hydratePlugins(): Promise<{ loaded: number; discarded: number }> {
  const stored = await store.loadAll();
  let loaded = 0;
  let discarded = 0;

  for (const plugin of Object.values(stored)) {
    try {
      if (!plugin?.id || !plugin.workspaceId || !plugin.manifest) throw new Error('incomplete');
      validateManifest(plugin.manifest);
      installed.set(plugin.id, plugin);
      loaded += 1;
    } catch {
      discarded += 1;
    }
  }
  return { loaded, discarded };
}

/** Test-only. */
export function resetPlugins(): void {
  installed.clear();
}
