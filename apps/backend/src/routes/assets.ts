import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse, ValidationException } from '@synora/shared';
import { uploadAsset, listAssets, deleteAsset } from '../services/asset.service';

const router: Router = Router();

// Same generous module-scope ceiling as the avatar upload route — the real
// configured limit (`storage.maxAssetUploadBytes`) is enforced inside the
// service, where getConfig() is safe to call.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/:workspaceId/assets', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const folderId =
      req.query.folderId === 'null' ? null : typeof req.query.folderId === 'string' ? req.query.folderId : undefined;
    const assets = await listAssets(req.userId!, req.params.workspaceId, { projectId, folderId });
    res.json(createApiResponse(assets));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/assets', authMiddleware, upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      throw new ValidationException('No file provided.');
    }

    const schema = z.object({
      projectId: z.string().optional(),
      folderId: z.string().optional(),
    })
    const input = schema.parse(req.body)

    const asset = await uploadAsset(req.userId!, req.params.workspaceId, {
      buffer: file.buffer,
      contentType: file.mimetype,
      filename: file.originalname,
      projectId: input.projectId,
      folderId: input.folderId,
    });

    res.status(201).json(createApiResponse(asset));
  } catch (error) {
    next(error);
  }
});

router.delete('/:workspaceId/assets/:assetId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    await deleteAsset(req.userId!, req.params.workspaceId, req.params.assetId);
    res.json(createApiResponse({ message: 'Asset deleted.' }));
  } catch (error) {
    next(error);
  }
});

export default router;
