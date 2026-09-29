import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireMembership } from '../services/checks';
import { FileService } from '../files/file.service';
import { LocalStorageProvider } from '../files/storageProviders';
import { enqueueFileProcessing } from '../workers/queue';
import { createApiResponse } from '@synora/shared';
import { logger } from '../utils/logger';

const router: Router = Router({ mergeParams: true });

// Initialize file service with local storage (production uses S3)
const fileService = new FileService(new LocalStorageProvider());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname || !file.mimetype) {
      return cb(new Error('Invalid file'));
    }
    cb(null, true);
  },
});

/**
 * POST /api/workspaces/:workspaceId/conversations/:conversationId/files
 * Upload file to conversation
 */
router.post(
  '/:workspaceId/conversations/:conversationId/files',
  authMiddleware,
  upload.single('file'),
  async (req: AuthRequest, res: Response, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      if (!req.file) {
        return res.status(400).json(createApiResponse({ error: 'No file provided' }));
      }

      // Validate workspace membership
      await requireMembership(req.userId!, workspaceId);

      // Upload file
      const result = await fileService.uploadFile({
        conversationId,
        workspaceId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        uploadedBy: req.userId!,
      });

      // Kick off virus scan + content extraction in the background.
      // Non-fatal on enqueue failure: the file stays PENDING and can
      // be re-enqueued; failing the upload over a queue hiccup would
      // lose the user's work for no benefit.
      try {
        await enqueueFileProcessing({ fileId: result.id, conversationId, workspaceId });
      } catch (queueError) {
        logger.error('[files] Failed to enqueue file processing', {
          fileId: result.id,
          error: queueError instanceof Error ? queueError.message : String(queueError),
        });
      }

      res.status(201).json(createApiResponse(result));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/conversations/:conversationId/files/:fileId/download
 * Download a file's raw bytes.
 *
 * Served as an attachment with nosniff so a stored HTML/SVG upload
 * can never execute in the app's origin, and refused outright (403)
 * for files whose virus scan flagged them.
 */
router.get(
  '/:workspaceId/conversations/:conversationId/files/:fileId/download',
  authMiddleware,
  async (req: AuthRequest, res: Response, next) => {
    try {
      const { workspaceId, conversationId, fileId } = req.params;

      await requireMembership(req.userId!, workspaceId);

      const { file, buffer } = await fileService.downloadFile(fileId, workspaceId, conversationId);

      // RFC 5987 encoding handles quotes/unicode in user-supplied
      // names without letting them break out of the header value.
      const encodedName = encodeURIComponent(file.fileName);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodedName}`
      );
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/workspaces/:workspaceId/conversations/:conversationId/files
 * List files in conversation
 */
router.get(
  '/:workspaceId/conversations/:conversationId/files',
  authMiddleware,
  async (req: AuthRequest, res: Response, next) => {
    try {
      const { workspaceId, conversationId } = req.params;

      // Validate workspace membership
      await requireMembership(req.userId!, workspaceId);

      const files = await fileService.getConversationFiles(conversationId, workspaceId);

      res.json(createApiResponse({ items: files }));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/workspaces/:workspaceId/conversations/:conversationId/files/:fileId
 * Delete file from conversation
 */
router.delete(
  '/:workspaceId/conversations/:conversationId/files/:fileId',
  authMiddleware,
  async (req: AuthRequest, res: Response, next) => {
    try {
      const { workspaceId, fileId } = req.params;

      // Validate workspace membership
      await requireMembership(req.userId!, workspaceId);

      await fileService.deleteFile(fileId, workspaceId);

      res.json(createApiResponse({ success: true }));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
