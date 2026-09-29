import { Router, type Response } from 'express';
import { z } from 'zod';
import { createApiResponse } from '@synora/shared';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/apiKey.service';

/**
 * Developer-portal endpoints for workspace-scoped API keys.
 *
 * Every route is workspace-scoped and gated by requireWorkspaceAccess so a
 * user can only manage keys inside a workspace they're a member of. Keys
 * grant scope to the workspace, not to the individual — the createdById is
 * for audit attribution only.
 */
const router: Router = Router({ mergeParams: true });

router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  // Nullable so a caller can explicitly send { expiresAt: null } to mean
  // "no expiry". Days-from-now is a UI concept; the API takes a real date.
  expiresAt: z.string().datetime().optional().nullable(),
});

router.get(
  '/:workspaceId/api-keys',
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.params;
    const keys = await listApiKeys(workspaceId);
    res.json(createApiResponse({ keys }));
  }
);

router.post(
  '/:workspaceId/api-keys',
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.params;
    const parsed = createSchema.parse(req.body);
    const result = await createApiKey({
      workspaceId,
      createdById: req.user!.id,
      name: parsed.name,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
    });
    // rawKey is intentionally included exactly once — the response body from
    // creation is the only place a user ever sees the full secret. Every
    // subsequent list call returns just the prefix.
    res.status(201).json(createApiResponse({ apiKey: result.apiKey, rawKey: result.rawKey }));
  }
);

router.post(
  '/:workspaceId/api-keys/:keyId/revoke',
  requireWorkspaceAccess(),
  async (req: AuthRequest, res: Response) => {
    const { workspaceId, keyId } = req.params;
    await revokeApiKey(keyId, workspaceId);
    res.json(createApiResponse({ id: keyId, revokedAt: new Date().toISOString() }));
  }
);

export default router;
