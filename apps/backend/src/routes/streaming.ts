import { Router, type Response } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth'
import { logger } from '../utils/logger'
import { conversationGenerationService } from '../services/conversationGeneration.service'
import { prisma } from '@synora/database'

const router: Router = Router({ mergeParams: true })

router.get(
  '/:workspaceId/conversations/:conversationId/stream',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { conversationId } = req.params
      const { messageId } = req.query

      if (!messageId || typeof messageId !== 'string') {
        res.status(400).json({ error: 'messageId query parameter is required' })
        return
      }

      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('X-Accel-Buffering', 'no')

      const sendEvent = (eventType: string, data: unknown) => {
        try {
          res.write(`event: ${eventType}\n`)
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        } catch (err) {
          logger.error('Error writing SSE event', { eventType, error: err })
        }
      }

      try {
        logger.info(`[streaming] Starting stream for message ${messageId} in conversation ${conversationId}`)

        // Fetch the user message that triggered this generation
        const userMessage = await prisma.message.findUniqueOrThrow({
          where: { id: messageId as string },
        })

        // Call the conversation generation service (creates new ASSISTANT message with parentId)
        const { assistantMessage, usage } = await conversationGenerationService.generateReply(
          conversationId,
          userMessage
        )

        // Stream the response content word-by-word to simulate token streaming
        const words = assistantMessage.content.split(/(\s+)/)
        for (const word of words) {
          if (word && word.trim()) {
            sendEvent('token', { token: word })
            // Small delay to prevent overwhelming the client
            await new Promise(resolve => setTimeout(resolve, 5))
          } else if (word === ' ') {
            sendEvent('token', { token: ' ' })
          }
        }

        // Send completion event with usage data
        sendEvent('done', {
          messageId: assistantMessage.id,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          completedAt: new Date().toISOString(),
        })

        logger.info(`[streaming] Completed stream for message ${assistantMessage.id}`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Generation failed'
        logger.error(`[streaming] Stream error for message ${messageId}`, { error })
        sendEvent('error', { error: errorMessage })
      }

      res.end()
    } catch (error) {
      logger.error('[streaming] SSE handler error', { error })
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' })
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`)
        res.end()
      }
    }
  }
)

export default router
