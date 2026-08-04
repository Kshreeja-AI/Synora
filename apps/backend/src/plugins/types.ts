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
 * lifecycle (install → enable/disable → uninstall) that persists, template
 * contributions that genuinely appear in the workspace, and tool
 * contributions that genuinely execute — through Synora's own HTTP engine,
 * from a description the plugin supplies. That last one is the line worth
 * being precise about: the plugin provides DATA describing a request, and
 * the platform makes the request. No plugin code is loaded or called, so
 * "the plugin can reach the network" and "the plugin runs" remain
 * different claims, and only the first is true.
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
  /**
   * Contribute HTTP/Webhook tool DEFINITIONS the platform's own engine
   * executes. Distinct from `network:outbound`, which would mean the
   * plugin's own code opening a socket — see `EXECUTION_PERMISSIONS`.
   */
  | 'tools:contribute'
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
  'tools:contribute',
  'workspace:read',
];

/**
 * A tool a plugin contributes.
 *
 * WHY THIS IS NOT CODE EXECUTION. The platform already executes HTTP and
 * Webhook tools itself — an SSRF-guarded outbound request built from the
 * tool's config, with the tool's timeout, retry budget and circuit
 * breaker. A contributed tool is a DESCRIPTION of such a request. The
 * plugin supplies data; Synora's own engine, unchanged, does the work.
 * Nothing from the plugin is ever called.
 *
 * WHY ONLY HTTP AND WEBHOOK. They are the only types the engine actually
 * executes. Accepting a Database or Python contribution would install a
 * tool that can never run, which is the ready-looking-and-broken trap this
 * codebase refuses everywhere else.
 *
 * WHY SECRET PLACEHOLDERS ARE REFUSED HERE, though a person may use them
 * in a tool they write themselves. A `{{secret:NAME}}` in a URL or header
 * makes the engine substitute a workspace secret before sending. When you
 * write that yourself you are choosing to send your own credential to a
 * destination you typed. A manifest is written by someone else: a plugin
 * declaring `Authorization: {{secret:OPENAI_API_KEY}}` against its own host
 * would exfiltrate that key on the first execution, and the install screen
 * would have said only "contributes 1 tool". Consent that specific needs a
 * per-secret decision this version does not have, so the answer is no.
 */
export interface PluginToolContribution {
  /** Unique within the plugin; namespaced by plugin id when installed. */
  name: string;
  displayName: string;
  description: string;
  category: string;
  /** Only the two the engine can genuinely execute. */
  type: 'HTTP' | 'Webhook';
  /** JSON Schema for the tool's input, same as an authored tool. */
  inputSchema: Record<string, unknown>;
  /** Must carry an absolute http/https `url`. */
  config: Record<string, unknown>;
  /** Both clamped to platform ceilings; a manifest cannot raise them. */
  timeout?: number;
  maxRetries?: number;
}

/**
 * There is deliberately no `requiresApproval` above. Every contributed
 * tool is created requiring human approval, and the manifest gets no say:
 * whether a workspace wants a human to see the first call to a publisher's
 * host is the workspace's decision, and letting the publisher set it to
 * false would let them waive the review of their own tool. A workspace
 * admin can lower it afterwards through the normal tool-editing path,
 * which is audited and local.
 */
export const CONTRIBUTED_TOOL_CEILINGS = {
  /** Milliseconds. Matches the platform default; a manifest cannot exceed it. */
  maxTimeout: 60_000,
  /** The engine's own attempt cap. */
  maxRetries: 5,
} as const;

/** What a plugin adds. Data only — no functions, nothing callable. */
export interface PluginContributions {
  /**
   * Templates, in the same shape the built-in catalogue uses, so a
   * contributed template is not a second-class thing with its own
   * rendering path.
   */
  templates?: Template[];
  /**
   * Tool definitions, materialised as real rows on install so they run
   * through the same engine, permissions, audit trail and execution
   * records as any other tool.
   */
  tools?: PluginToolContribution[];
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
  /**
   * Lower than the template limit on purpose. A template is inert until
   * someone builds from it; a tool is a live outbound capability, and a
   * manifest contributing dozens of them is asking for more trust than an
   * install screen can meaningfully present.
   */
  maxToolsPerPlugin: 10,
  maxIdLength: 100,
  maxNameLength: 100,
  maxDescriptionLength: 1_000,
} as const;
