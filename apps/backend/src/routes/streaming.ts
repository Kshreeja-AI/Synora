import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { prisma } from '@synora/database';
import { logger } from '../utils/logger';
import { generateText } from '../ai';

const router: Router = Router({ mergeParams: true });

router.get(
  '/:workspaceId/conversations/:conversationId/stream',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { messageId } = req.query;

      if (!messageId || typeof messageId !== 'string') {
        res.status(400).json({ error: 'messageId query parameter is required' });
        return;
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // Validate user has access to workspace
      const member = await prisma.workspaceMember.findUnique({
        where: {
          userId_workspaceId: { userId: req.userId!, workspaceId: conversation.workspaceId },
        },
      });

      if (!member) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const sendEvent = (eventType: string, data: any) => {
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Get the message
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { conversation: true },
      });

      if (!message) {
        sendEvent('error', { error: 'Message not found' });
        res.end();
        return;
      }

      let inputTokens = 0;
      let outputTokens = 0;

      // Stream message content if it exists
      if (message.content) {
        // Message already has content, send it word by word
        const words = message.content.split(/\s+/);
        for (const word of words) {
          if (word) {
            sendEvent('token', { token: word + ' ' });
            // Small delay to simulate streaming
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      } else {
        // Message needs to be generated - call AI provider
        try {
          // Fetch conversation history for context
          const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              content: true,
              role: true,
            },
          });

          // Get the user message content
          const userMessage = messages.find(m => m.id === messageId);
          if (!userMessage) {
            sendEvent('error', { error: 'User message not found' });
            res.end();
            return;
          }

          // Build system prompt from conversation history
          const contextMessages = messages
            .slice(0, -1)
            .map(m => `${m.role === 'USER' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

          const systemPrompt = contextMessages
            ? `Previous conversation:\n${contextMessages}`
            : undefined;

          // Call AI provider
          const result = await generateText({
            prompt: userMessage.content,
            model: conversation.model,
            systemPrompt,
          });

          // Stream the result word by word
          const words = result.text.split(/\s+/);
          for (const word of words) {
            if (word) {
              sendEvent('token', { token: word + ' ' });
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }

          inputTokens = result.usage?.inputTokens || 0;
          outputTokens = result.usage?.outputTokens || 0;

          // Update the message with generated content
          await prisma.message.update({
            where: { id: messageId },
            data: { content: result.text },
          });

          // Update conversation usage if tracking exists
          const usage = await prisma.conversationUsage.findUnique({
            where: { conversationId },
          });

          if (usage) {
            await prisma.conversationUsage.update({
              where: { conversationId },
              data: {
                inputTokens: usage.inputTokens + inputTokens,
                outputTokens: usage.outputTokens + outputTokens,
                totalTokens: usage.totalTokens + inputTokens + outputTokens,
              },
            });
          } else {
            await prisma.conversationUsage.create({
              data: {
                conversationId,
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Generation failed';
          sendEvent('error', { error: errorMessage });
        }
      }

      // Send completion event
      sendEvent('done', {
        messageId,
        inputTokens,
        outputTokens,
        completedAt: new Date().toISOString(),
      });

      res.end();
    } catch (error) {
      logger.error('SSE stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
        res.end();
      }
    }
  }
);

export default router;
