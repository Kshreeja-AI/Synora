import { prisma } from '@synora/database';
import { ToolType } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';
import { logger } from '../utils/logger';
import { requireMembership } from '../services/checks';
import { requirePermission } from '../services/permissions';
import { recordAuditEvent } from '../services/audit.service';
import { pluginHasPermission } from './plugin-registry.js';
import { CONTRIBUTED_TOOL_CEILINGS, type InstalledPlugin, type PluginToolContribution } from './types.js';

/**
 * Turning a plugin's declared tools into real ones, and taking them away
 * again.
 *
 * THEY ARE REAL ROWS, NOT A PARALLEL LIST. A contributed tool is a
 * `ToolDefinition` like any other, so it runs through the same engine, the
 * same SSRF policy, the same permission checks, the same rate limits and
 * the same execution records. Keeping contributed tools in their own
 * structure and "merging at read time" — the way contributed TEMPLATES
 * work — would not have been possible honestly: an execution record points
 * at a tool row by foreign key, so a virtual tool could be listed but
 * never actually run, and listing something unrunnable is the trap this
 * codebase refuses.
 *
 * WHY UNINSTALL REMOVES TOOLS WHEN IT DOES NOT REMOVE TEMPLATES. A
 * contributed template that someone built an agent from is inert: they
 * copied it, the copy is theirs, and taking it back would delete their
 * work. A contributed tool is not inert — it reaches a host the publisher
 * chose, every time it runs. Uninstalling is the withdrawal of that
 * consent, so it has to actually withdraw it. The asymmetry is the point,
 * not an inconsistency.
 *
 * DISABLING DOES THE SAME, for the same reason. If a disabled plugin's
 * tools kept working, "disabled" would be decorative for the one
 * contribution kind where it matters most.
 *
 * REMOVAL IS A DEACTIVATION, NOT A DELETE, because executions point at the
 * tool row and history has to survive: "what did this tool do while it was
 * installed" is exactly the question someone asks after uninstalling one.
 */

/** Contributed names are namespaced so they cannot collide with authored ones. */
export function contributedToolName(pluginId: string, toolName: string): string {
  return `${pluginId}/${toolName}`;
}

export interface SyncResult {
  /** Tools now active and executable. */
  active: string[];
  /** Tools deactivated by this call. */
  deactivated: string[];
  /**
   * Contributions that could not be installed, with the reason. Reported
   * rather than swallowed — a plugin that silently contributed three of
   * its four tools would look like it worked.
   */
  skipped: { name: string; reason: string }[];
}

function clamp(value: number | undefined, fallback: number, ceiling: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), ceiling);
}

/**
 * Brings the workspace's tool rows in line with what the plugin currently
 * contributes and is currently allowed to contribute.
 *
 * Called on install, on enable and on disable, because all three are the
 * same question asked at different moments: given this plugin's state and
 * grants right now, which of its tools should exist?
 */
export async function syncPluginTools(
  plugin: InstalledPlugin,
  userId: string,
): Promise<SyncResult> {
  const { workspaceId } = plugin;
  const pluginId = plugin.manifest.id;
  const result: SyncResult = { active: [], deactivated: [], skipped: [] };

  const permitted = pluginHasPermission(plugin, 'tools:contribute');
  const contributions: PluginToolContribution[] = permitted
    ? (plugin.manifest.contributions?.tools ?? [])
    : [];

  // The membership check runs even when there is nothing to do, so a
  // caller cannot use an empty contribution list to skip authorisation.
  const membership = await requireMembership(userId, workspaceId);
  if (contributions.length > 0) {
    // Installing a tool IS managing tools. Whoever may install plugins is
    // not automatically whoever may add outbound calls to the workspace.
    requirePermission(membership.role, 'tool:manage');
  }

  const existing = await prisma.toolDefinition.findMany({ where: { workspaceId, pluginId } });
  const byName = new Map(existing.map((tool) => [tool.name, tool]));
  const wanted = new Set<string>();

  for (const contribution of contributions) {
    const name = contributedToolName(pluginId, contribution.name);
    wanted.add(name);

    const config = contribution.config as InputJsonValue;
    const shared = {
      displayName: contribution.displayName,
      description: contribution.description,
      category: contribution.category,
      type: contribution.type === 'Webhook' ? ToolType.Webhook : ToolType.HTTP,
      inputSchema: (contribution.inputSchema ?? {}) as InputJsonValue,
      config,
      timeout: clamp(contribution.timeout, 30_000, CONTRIBUTED_TOOL_CEILINGS.maxTimeout),
      maxRetries: clamp(contribution.maxRetries, 3, CONTRIBUTED_TOOL_CEILINGS.maxRetries),
      isActive: true,
    };

    const current = byName.get(name);
    if (current) {
      await prisma.toolDefinition.update({
        where: { id: current.id },
        data: { ...shared, version: current.version + 1 },
      });
      result.active.push(name);
      continue;
    }

    // A name may already be taken by a tool this plugin did not
    // contribute — an authored one, or another plugin's. Reported, never
    // overwritten: silently replacing a tool someone else relies on would
    // be the worst possible outcome of installing a plugin.
    const collision = await prisma.toolDefinition.findFirst({ where: { workspaceId, name } });
    if (collision) {
      result.skipped.push({
        name,
        reason: 'a different tool already uses this name in this workspace',
      });
      continue;
    }

    await prisma.toolDefinition.create({
      data: {
        ...shared,
        workspaceId,
        name,
        pluginId,
        // Never the publisher's choice — see CONTRIBUTED_TOOL_CEILINGS.
        requiresApproval: true,
        // Records intent: a plugin is installed for the workspace, not for
        // one person. Listing does not currently filter on this field, so
        // it is not an enforcement point today.
        permission: 'WORKSPACE',
        createdBy: userId,
      },
    });
    result.active.push(name);
  }

  // Anything this plugin used to contribute and no longer does — because
  // the manifest changed, the permission is gone, or the plugin is
  // disabled — stops working now.
  for (const tool of existing) {
    if (wanted.has(tool.name)) continue;
    if (!tool.isActive) continue;
    await prisma.toolDefinition.update({ where: { id: tool.id }, data: { isActive: false } });
    result.deactivated.push(tool.name);
  }

  if (result.active.length > 0 || result.deactivated.length > 0) {
    await recordAuditEvent(workspaceId, userId, 'plugin.tools.synced', 'plugin', pluginId, {
      active: result.active,
      deactivated: result.deactivated,
      skipped: result.skipped.map((s) => s.name),
      state: plugin.state,
    });
  }

  logger.info('[plugins] contributed tools synced', {
    workspaceId,
    pluginId,
    active: result.active.length,
    deactivated: result.deactivated.length,
    skipped: result.skipped.length,
  });

  return result;
}

/**
 * Withdraws every tool a plugin contributed. Takes ids rather than the
 * installed record, because uninstall removes that record and the tools
 * have to go whether or not it still exists.
 */
export async function removePluginTools(
  workspaceId: string,
  pluginId: string,
  userId: string,
): Promise<string[]> {
  const tools = await prisma.toolDefinition.findMany({
    where: { workspaceId, pluginId, isActive: true },
  });
  if (tools.length === 0) return [];

  await prisma.toolDefinition.updateMany({
    where: { workspaceId, pluginId, isActive: true },
    data: { isActive: false },
  });

  const names = tools.map((tool) => tool.name);
  await recordAuditEvent(workspaceId, userId, 'plugin.tools.removed', 'plugin', pluginId, {
    tools: names,
  });
  logger.info('[plugins] contributed tools withdrawn', { workspaceId, pluginId, count: names.length });
  return names;
}

/** What a plugin currently contributes and is currently allowed to. */
export async function listPluginTools(workspaceId: string, pluginId: string) {
  return prisma.toolDefinition.findMany({
    where: { workspaceId, pluginId },
    orderBy: { name: 'asc' },
  });
}
