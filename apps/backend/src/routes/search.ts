import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { searchService } from '../services/search.service';
import { prisma } from '@synora/database';

const router: Router = Router({ mergeParams: true });

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  skip: z.string().optional().transform((val) => (val ? parseInt(val) : 0)),
  take: z.string().optional().transform((val) => (val ? parseInt(val) : 20)),
  type: z.enum(['full-text', 'semantic']).default('full-text').optional(),
});

router.get('/:workspaceId/search', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { q, skip, take } = searchQuerySchema.parse(req.query);

    if (!q || q.trim().length === 0) {
      return res.status(400).json(
        createApiResponse({
          error: 'Search query required',
          items: [],
          total: 0,
        })
      );
    }

    const result = await searchService.searchConversations({
      workspaceId,
      query: q,
      skip,
      take,
    });

    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

router.get('/:workspaceId/search/messages', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId } = req.params;
    const { q, skip, take } = searchQuerySchema.parse(req.query);

    if (!q || q.trim().length === 0) {
      return res.status(400).json(
        createApiResponse({
          error: 'Search query required',
          items: [],
          total: 0,
        })
      );
    }

    const result = await searchService.searchMessages({
      workspaceId,
      query: q,
      skip,
      take,
    });

    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

router.post('/:workspaceId/search/index/:conversationId', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { workspaceId, conversationId } = req.params;

    // Verify user has access to conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        workspace: { id: workspaceId },
      },
    });

    if (!conversation) {
      return res.status(404).json(createApiResponse({ error: 'Conversation not found' }));
    }

    // Index conversation and messages
    await searchService.indexConversation(conversationId);

    const messages = await prisma.message.findMany({
      where: { conversationId },
      select: { id: true },
    });

    for (const msg of messages) {
      await searchService.indexMessage(msg.id);
    }

    res.json(
      createApiResponse({
        success: true,
        conversationId,
        messagesIndexed: messages.length,
      })
    );
  } catch (error) {
    next(error);
  }
});

export default router;
