import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { realtimeService } from '../services/realtime.service';
import { prisma } from '@synora/database';

const router: Router = Router({ mergeParams: true });

// Get presence for a conversation
router.get('/:workspaceId/conversations/:conversationId/presence', authMiddleware, async (req: AuthRequest, res, next) => {
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

    const presence = realtimeService.getPresence(conversationId);

    res.json(
      createApiResponse({
        conversationId,
        users: presence,
        count: presence.length,
      })
    );
  } catch (error) {
    next(error);
  }
});

export default router;
