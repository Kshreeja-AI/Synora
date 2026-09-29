import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import {
  contributedHosts,
  forgetPlugin,
  getPlugin,
  installPlugin,
  listPlugins,
  persistPlugin,
  setPluginState,
  uninstallPlugin,
  validateManifest,
} from '../plugins/plugin-registry';
import {
  contributedToolName,
  removePluginTools,
  syncPluginTools,
} from '../plugins/tool-contributions';
import { EXECUTION_PERMISSIONS, GRANTABLE_PERMISSIONS } from '../plugins/types';
import type { PluginManifest } from '../plugins/types';

/**
 * The plugin HTTP surface.
 *
 * Installing takes a manifest directly rather than a marketplace id,
 * because there is no marketplace and inventing an endpoint that pretends
 * to fetch from one would be building the façade before the thing. When a
 * registry exists it becomes another way to obtain a manifest; the install
 * path below stays the same.
 *
 * The store's validation messages are surfaced verbatim as 400s. They are
 * specific for a reason — "this plugin wants to run code, which Synora
 * cannot do safely yet" tells a publisher exactly what to change, where
 * "invalid manifest" tells them to guess.
 */

const router: ExpressRouter = Router({ mergeParams: true });

function toHttpError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'plugin not found') return new NotFoundException('Plugin');
  if (
    message.includes('manifest needs') ||
    message.includes('exceeds') ||
    message.includes('publisher.name') ||
    message.includes('wants to run code') ||
    message.includes('cannot be granted yet') ||
    message.includes('unknown plugin permission') ||
    message.includes('already installed') ||
    message.includes('at most') ||
    message.includes('without asking for') ||
    message.includes('could never run') ||
    message.includes('names a tool id') ||
    message.includes('unknown kind') ||
    message.includes('must be a list') ||
    message.includes('is contributed twice') ||
    message.includes('which the engine cannot execute') ||
    message.includes('needs a "url"') ||
    message.includes('not a valid URL') ||
    message.includes('http or https url') ||
    message.includes('workspace secret to be substituted') ||
    message.includes('inputSchema that is not an object')
  ) {
    return new ValidationException(message);
  }
  return err;
}

router.use('/:workspaceId/plugins', authMiddleware, requireWorkspaceAccess());

router.get('/:workspaceId/plugins', async (req: AuthRequest, res, next) => {
  try {
    res.json(
      createApiResponse({
        installed: listPlugins(req.params.workspaceId),
        // Surfaced so a publisher or an admin can see what is grantable
        // and what is deliberately not, without reading the source.
        grantablePermissions: GRANTABLE_PERMISSIONS,
        unavailablePermissions: EXECUTION_PERMISSIONS,
      }),
    );
  } catch (error) {
    next(error);
  }
});

// Loose on purpose: the registry is the single validator, and duplicating
// its rules in a zod schema would create two places for them to disagree.
// What zod does here is guarantee an object arrived at all.
const installSchema = z.object({ manifest: z.record(z.unknown()) });

/**
 * What a manifest WOULD do, without doing it.
 *
 * This exists because disclosure after the fact is not consent. A
 * contributed tool reaches a host the publisher chose, and being told
 * which host once the tool already exists is being informed, not asked.
 * Validation runs here in full, so a manifest that would be refused is
 * refused at the preview with the same message rather than surprising
 * someone who has already pressed install.
 *
 * Declared before `/:workspaceId/plugins/:pluginId` handlers for the usual
 * reason: a literal segment that arrives after a parameter never matches.
 */
router.post('/:workspaceId/plugins/preview', async (req: AuthRequest, res, next) => {
  try {
    const { manifest } = installSchema.parse(req.body ?? {});
    const candidate = manifest as unknown as PluginManifest;
    validateManifest(candidate);
    res.json(
      createApiResponse({
        id: candidate.id,
        name: candidate.name,
        version: candidate.version,
        publisher: candidate.publisher,
        permissions: candidate.permissions,
        templates: (candidate.contributions?.templates ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
        })),
        tools: (candidate.contributions?.tools ?? []).map((t) => ({
          name: contributedToolName(candidate.id, t.name),
          displayName: t.displayName,
          description: t.description,
          type: t.type,
          url: (t.config as { url?: unknown })?.url ?? null,
        })),
        hosts: contributedHosts(candidate),
      }),
    );
  } catch (error) {
    next(toHttpError(error));
  }
});

router.post('/:workspaceId/plugins', async (req: AuthRequest, res, next) => {
  try {
    const { manifest } = installSchema.parse(req.body ?? {});
    const plugin = installPlugin({
      workspaceId: req.params.workspaceId,
      manifest: manifest as unknown as PluginManifest,
      installedBy: req.userId!,
    });
    let tools;
    try {
      tools = await syncPluginTools(plugin, req.userId!);
    } catch (error) {
      // The install is rolled back rather than left half-done. A plugin
      // recorded as installed whose tools were refused would show as
      // working while contributing nothing, and the next enable would try
      // the same failing thing again.
      uninstallPlugin(plugin.manifest.id, req.params.workspaceId);
      throw error;
    }
    await persistPlugin(plugin.manifest.id, req.params.workspaceId);
    res.status(201).json(
      createApiResponse({
        ...plugin,
        tools,
        // The destinations, said plainly. "Contributes 1 tool" is not
        // something a person can consent to; a host name is.
        hosts: contributedHosts(plugin.manifest),
      }),
    );
  } catch (error) {
    next(toHttpError(error));
  }
});

router.patch('/:workspaceId/plugins/:pluginId', async (req: AuthRequest, res, next) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const plugin = setPluginState(
      req.params.pluginId,
      req.params.workspaceId,
      enabled ? 'enabled' : 'disabled',
    );
    // Disabling has to reach the tools, or the switch is decorative for
    // the one contribution kind that can call out of the platform.
    const tools = await syncPluginTools(plugin, req.userId!);
    await persistPlugin(plugin.manifest.id, req.params.workspaceId);
    res.json(createApiResponse({ ...plugin, tools }));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.delete('/:workspaceId/plugins/:pluginId', async (req: AuthRequest, res, next) => {
  try {
    const plugin = getPlugin(req.params.pluginId, req.params.workspaceId);
    if (!plugin) return next(new NotFoundException('Plugin'));
    // Tools first. Uninstalling is the withdrawal of consent to reach the
    // publisher's host, so it has to actually withdraw it — and doing this
    // before the record disappears means a failure here leaves the plugin
    // installed rather than leaving orphaned tools behind.
    const removedTools = await removePluginTools(
      req.params.workspaceId,
      req.params.pluginId,
      req.userId!,
    );
    uninstallPlugin(req.params.pluginId, req.params.workspaceId);
    // Removed from the store too, or the plugin returns on the next
    // restart carrying permissions nobody re-granted.
    await forgetPlugin(req.params.pluginId, req.params.workspaceId);
    res.json(createApiResponse({ uninstalled: true, removedTools }));
  } catch (error) {
    next(toHttpError(error));
  }
});

export default router;
