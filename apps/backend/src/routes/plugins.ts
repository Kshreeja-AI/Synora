import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse, NotFoundException, ValidationException } from '@synora/shared';
import {
  forgetPlugin,
  getPlugin,
  installPlugin,
  listPlugins,
  persistPlugin,
  setPluginState,
  uninstallPlugin,
} from '../plugins/plugin-registry';
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
    message.includes('must be a list')
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

router.post('/:workspaceId/plugins', async (req: AuthRequest, res, next) => {
  try {
    const { manifest } = installSchema.parse(req.body ?? {});
    const plugin = installPlugin({
      workspaceId: req.params.workspaceId,
      manifest: manifest as unknown as PluginManifest,
      installedBy: req.userId!,
    });
    await persistPlugin(plugin.manifest.id, req.params.workspaceId);
    res.status(201).json(createApiResponse(plugin));
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
    await persistPlugin(plugin.manifest.id, req.params.workspaceId);
    res.json(createApiResponse(plugin));
  } catch (error) {
    next(toHttpError(error));
  }
});

router.delete('/:workspaceId/plugins/:pluginId', async (req: AuthRequest, res, next) => {
  try {
    const plugin = getPlugin(req.params.pluginId, req.params.workspaceId);
    if (!plugin) return next(new NotFoundException('Plugin'));
    uninstallPlugin(req.params.pluginId, req.params.workspaceId);
    // Removed from the store too, or the plugin returns on the next
    // restart carrying permissions nobody re-granted.
    await forgetPlugin(req.params.pluginId, req.params.workspaceId);
    res.json(createApiResponse({ uninstalled: true }));
  } catch (error) {
    next(toHttpError(error));
  }
});

export default router;
