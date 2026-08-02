import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess } from '../middleware/requireWorkspaceAccess';
import { createApiResponse } from '@synora/shared';
import { exportService } from '../services/export.service';
import { importService } from '../services/import.service';
import { prisma } from '@synora/database';

const router: Router = Router({ mergeParams: true });

const exportQuerySchema = z.object({
  format: z.enum(['json', 'markdown']),
});

const importSchema = z.object({
  format: z.enum(['json', 'markdown']).optional(),
  content: z.string().optional(),
});

const EXPORT_MIME: Record<'json' | 'markdown', string> = {
  json: 'application/json',
  markdown: 'text/markdown',
};

/**
 * GET /api/workspaces/:workspaceId/conversations/:conversationId/export?format=json|markdown
 *
 * Streams the export directly as an attachment. A single conversation
 * is bounded, so the export is generated synchronously — no job
 * indirection, nothing written to server disk, nothing to clean up.
 * The filename is derived from the conversation title, RFC 5987
 * encoded so user-supplied titles can't break out of the header.
 */
router.get('/:workspaceId/conversations/:conversationId/export', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, conversationId } = req.params;
    const { format } = exportQuerySchema.parse(req.query);

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspace: { id: workspaceId } },
    });

    if (!conversation) {
      return res.status(404).json(createApiResponse({ error: 'Conversation not found' }));
    }

    const content =
      format === 'json'
        ? await exportService.exportToJSON(conversationId)
        : await exportService.exportToMarkdown(conversationId);

    const extension = format === 'markdown' ? 'md' : 'json';
    const encodedName = encodeURIComponent(`${conversation.title}.${extension}`);
    res.setHeader('Content-Type', `${EXPORT_MIME[format]}; charset=utf-8`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    res.send(content);
  } catch (error) {
    next(error);
  }
});

// Import conversation
router.post('/:workspaceId/import', authMiddleware, requireWorkspaceAccess(), async (req: AuthRequest, res, next) => {
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
