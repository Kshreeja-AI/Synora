import type { Template } from '../agents/templates.js';

/**
 * The plugin system foundation.
 *
 * WHAT THIS IS AND, MORE IMPORTANTLY, WHAT IT IS NOT.
 *
 * A plugin here is a DECLARATIVE package: a manifest that describes what
 * it contributes and what permissions it needs. Installing one adds its
 * contributions to a workspace. That is the whole model, deliberately.
 *
 * IT DOES NOT RUN THIRD-PARTY CODE, and pretending otherwise would be the
 * most dangerous thing in this codebase. Executing untrusted code safely
 * needs real isolation — a separate process, a VM, or a WASM runtime with
 * an explicit host interface — plus resource limits, a syscall policy, and
 * a threat model. None of that exists yet. A "sandbox" that is really just
 * a function call in the same process is not a sandbox; it is arbitrary
 * code execution with reassuring naming, and it would be worse than having
 * no plugin system at all, because the word implies a protection that is
 * not there.
 *
 * So this file defines the boundary rather than crossing it. A manifest
 * that declares an executable entry point is REFUSED, with a message
 * saying why, until a real isolate exists behind `PluginRuntime`. The
 * capability matrix records that refusal as the honest state.
 *
 * WHAT IS REAL TODAY: manifest validation that refuses what it does not
 * fully understand, an explicit permission model that fails closed, a
 * lifecycle (install → enable/disable → uninstall) that persists, and
 * template contributions that genuinely appear in the workspace.
 */

/**
 * What a plugin may do. Each is checked at the point of use, never
 * assumed from installation alone.
 *
 * There is deliberately no `*` or `all`. A permission set that can grow
 * without the granting user seeing what it grew to is not consent.
 */
export type PluginPermission =
  /** Contribute agent/workflow templates to the workspace. */
  | 'templates:contribute'
  /** Read workspace metadata (name, id). Not its contents. */
  | 'workspace:read'
  /** Reserved and NOT grantable yet — see `EXECUTION_PERMISSIONS`. */
  | 'code:execute'
  | 'network:outbound';

/**
 * Permissions that require an isolate the platform does not have. Declared
 * here rather than omitted, so a manifest asking for one gets a specific
 * refusal instead of a confusing "unknown permission".
 */
export const EXECUTION_PERMISSIONS: readonly PluginPermission[] = ['code:execute', 'network:outbound'];

export const GRANTABLE_PERMISSIONS: readonly PluginPermission[] = [
  'templates:contribute',
  'workspace:read',
];

/** What a plugin adds. Data only — no functions, nothing callable. */
export interface PluginContributions {
  /**
   * Templates, in the same shape the built-in catalogue uses, so a
   * contributed template is not a second-class thing with its own
   * rendering path.
   */
  templates?: Template[];
}

export interface PluginManifest {
  /** Stable identifier, namespaced by publisher: `publisher.name`. */
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  /** Every permission the plugin needs, declared up front. */
  permissions: PluginPermission[];
  contributions: PluginContributions;
  /**
   * Present only on plugins that want to run code. Its presence is what
   * this version REFUSES — the field exists so the refusal can be
   * specific about what was asked for.
   */
  entryPoint?: string;
}

export type PluginState = 'enabled' | 'disabled';

export interface InstalledPlugin {
  /** Unique per workspace+plugin. */
  id: string;
  workspaceId: string;
  manifest: PluginManifest;
  state: PluginState;
  /** Exactly the permissions granted at install, never widened later. */
  grantedPermissions: PluginPermission[];
  installedBy: string;
  installedAt: number;
  updatedAt: number;
}

export const PLUGIN_LIMITS = {
  maxPerWorkspace: 50,
  maxTemplatesPerPlugin: 25,
  maxIdLength: 100,
  maxNameLength: 100,
  maxDescriptionLength: 1_000,
} as const;
