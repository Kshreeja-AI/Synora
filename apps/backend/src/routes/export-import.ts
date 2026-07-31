import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { exportService } from '../services/export.service';
import { importService } from '../services/import.service';
import { db } from '../db';

const router: Router = Router({ mergeParams: true });

const exportSchema = z.object({
  format: z.enum(['json', 'markdown']),
});

const importSchema = z.object({
  format: z.enum(['json', 'markdown']),
});

// Export conversation
router.post('/:workspaceId/conversations/:conversationId/export', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const { format } = exportSchema.parse(req.body);

    // Verify conversation exists and user has access
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, workspace: { id: workspaceId } },
    });

    if (!conversation) {
      return res.status(404).json(createApiResponse({ error: 'Conversation not found' }));
    }

    // Generate export based on format
    let content: string;
    if (format === 'json') {
      content = await exportService.exportToJSON(conversationId);
    } else {
      content = await exportService.exportToMarkdown(conversationId);
    }

    // Create job
    const job = await exportService.createExportJob(conversationId, format);

    // Save file (in production, would be async job)
    const filepath = await exportService.saveExportToFile(job.id, content, format);

    res.json(
      createApiResponse({
        jobId: job.id,
        conversationId,
        format,
        status: 'complete',
        filepath,
      })
    );
  } catch (error) {
    next(error);
  }
});

// Download export
router.get('/:workspaceId/export/:jobId/download', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { jobId } = req.params;

    // In production, fetch from S3 or file storage
    // For now, return placeholder
    res.json(
      createApiResponse({
        message: 'Download endpoint - implement S3 integration',
        jobId,
      })
    );
  } catch (error) {
    next(error);
  }
});

// Import conversation
router.post('/:workspaceId/import', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { format, content } = importSchema.partial().parse(req.body);

    if (!content) {
      return res.status(400).json(createApiResponse({ error: 'Content required' }));
    }

    // Parse content based on format
    let importData;
    if (format === 'json' || !format) {
      importData = importService.parseJSON(content);
    } else {
      importData = importService.parseMarkdown(content);
    }

    // Check for duplicates
    const duplicates = await importService.detectDuplicates(workspaceId, importData);

    // Import conversation
    const conversationId = await importService.importConversation(req.userId!, workspaceId, importData);

    res.status(201).json(
      createApiResponse({
        conversationId,
        messageCount: importData.messages.length,
        duplicatesDetected: duplicates.length > 0,
        duplicateConversationIds: duplicates,
      })
    );
  } catch (error) {
    next(error);
  }
});

export default router;
