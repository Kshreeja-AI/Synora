import { prisma } from '@synora/database'
import { Message, MessageRole, StreamingJobStatus } from '@prisma/client'
import { ServiceUnavailableException } from '@synora/shared'
import { logger } from '../utils/logger'
import { resolveProvider, type ConversationMessage, type TextGenerationProvider } from '../ai/index.js'
import { conversationUsageService } from './conversationUsage.service'

/** 1 initial attempt + 2 retries. See M2_IMPLEMENTATION_PLAN.md §7 for why
 * this is a blanket bounded retry rather than a transient/permanent error
 * taxonomy: AIProviderError carries no such classification today across
 * ten providers, and inventing one is out of this milestone's scope. */
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [500, 1500]

/** How many prior messages (oldest-first) are sent as context alongside
 * the new user turn. A fixed window, not the full history — an unbounded
 * history would eventually exceed every provider's context length and
 * silently make requests slower and more expensive as a conversation grows. */
const PROMPT_HISTORY_WINDOW = 50

export interface GenerateReplyResult {
  assistantMessage: Message
  usage: { inputTokens: number; outputTokens: number }
}

/**
 * The one place that turns a user message into an assistant reply: builds
 * prompt context, resolves the conversation's own provider (not just
 * whatever AI_PROVIDER happens to be globally set to), retries on
 * transient failure, and drives StreamingJob's state machine end to end.
 *
 * Deliberately synchronous with its caller (the message route handler) —
 * no queue, no worker. See M2_IMPLEMENTATION_PLAN.md §12 for the future
 * compatibility path to an async/streamed version; this service's retry
 * loop and StreamingJob bookkeeping do not change when that's built, only
 * who calls it does.
 */
export class ConversationGenerationService {
  async generateReply(conversationId: string, userMessage: Message): Promise<GenerateReplyResult> {
    logger.info(`[generateReply] Starting generation for conversation ${conversationId}, user message ${userMessage.id}`)

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    })

    const job = await prisma.streamingJob.create({
      data: { conversationId, status: StreamingJobStatus.RUNNING },
    })
    logger.debug(`[generateReply] Created StreamingJob ${job.id} for attempt tracking`)

    const history = await this.buildPromptContext(conversationId, userMessage.id)
    logger.debug(`[generateReply] Built prompt context with ${history.length} prior messages`)

    let provider: TextGenerationProvider
    try {
      provider = await resolveProvider('text-generation', {
        explicitProviderId: conversation.provider,
      })
      logger.debug(`[generateReply] Resolved provider ${provider.id} for conversation`)
    } catch (error) {
      logger.error(`[generateReply] Failed to resolve provider ${conversation.provider}`, { error })
      await this.failJob(job.id, error)
      throw new ServiceUnavailableException(this.describeFailure(job.id, error, 0))
    }

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await prisma.streamingJob.update({ where: { id: job.id }, data: { attempt } })

      try {
        logger.debug(`[generateReply] Attempt ${attempt} of ${MAX_ATTEMPTS}`)
        const result = await provider.generateText({
          prompt: userMessage.content,
          messages: history,
          model: conversation.model,
        })

        logger.info(`[generateReply] Generation succeeded on attempt ${attempt}`, {
          jobId: job.id,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        })
        return await this.completeJob(job.id, conversationId, userMessage.id, result)
      } catch (error) {
        lastError = error
        logger.warn(`[generateReply] Attempt ${attempt} failed`, {
          jobId: job.id,
          error: this.errorMessage(error),
        })
        await prisma.streamingJob.update({
          where: { id: job.id },
          data: { lastError: this.errorMessage(error) },
        })

        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = RETRY_BACKOFF_MS[attempt - 1]
          logger.debug(`[generateReply] Retrying after ${backoffMs}ms`)
          await internals.sleep(backoffMs)
        }
      }
    }

    logger.error(`[generateReply] Generation exhausted all ${MAX_ATTEMPTS} attempts`, {
      jobId: job.id,
      error: this.errorMessage(lastError),
    })
    await this.failJob(job.id, lastError)
    throw new ServiceUnavailableException(this.describeFailure(job.id, lastError, MAX_ATTEMPTS))
  }

  private async completeJob(
    jobId: string,
    conversationId: string,
    parentMessageId: string,
    result: { text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number } }
  ): Promise<GenerateReplyResult> {
    const inputTokens = result.usage?.inputTokens ?? 0
    const outputTokens = result.usage?.outputTokens ?? 0

    try {
      // Transaction: create message, update job, update conversation atomically
      // Ensures that either all operations succeed or all rollback on error
      const assistantMessage = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
          data: {
            conversationId,
            content: result.text,
            role: MessageRole.ASSISTANT,
            parentId: parentMessageId,
          },
        })

        // Update job with reference to created message
        await tx.streamingJob.update({
          where: { id: jobId },
          data: {
            status: StreamingJobStatus.COMPLETED,
            messageId: msg.id,
            completedAt: new Date(),
          },
        })

        // Update conversation's lastMessageAt
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: msg.createdAt },
        })

        return msg
      })

      // Record usage separately (outside transaction to avoid long locks)
      await conversationUsageService.recordGeneration({
        conversationId,
        model: result.model,
        inputTokens,
        outputTokens,
      })

      logger.debug(`[completeJob] Completed job ${jobId} with message ${assistantMessage.id}`)
      return { assistantMessage, usage: { inputTokens, outputTokens } }
    } catch (error) {
      logger.error(`[completeJob] Failed to complete job ${jobId}`, { error })
      throw error
    }
  }

  private async failJob(jobId: string, error: unknown): Promise<void> {
    await prisma.streamingJob.update({
      where: { id: jobId },
      data: {
        status: StreamingJobStatus.FAILED,
        lastError: this.errorMessage(error),
        completedAt: new Date(),
      },
    })
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private describeFailure(jobId: string, error: unknown, attempts: number): string {
    const attemptsNote = attempts > 0 ? ` after ${attempts} attempt${attempts === 1 ? '' : 's'}` : '';
    return `Failed to generate a response${attemptsNote} (job ${jobId}): ${this.errorMessage(error)}`
  }

  /**
   * The most recent messages before `excludeMessageId` (the new user
   * turn, already persisted by the caller), oldest-first — the shape
   * `ConversationMessage[]`/`resolveConversationTurns` expects. Queried
   * newest-first with a `take` limit, then reversed, so a long
   * conversation contributes its most recent window, not its oldest.
   */
  private async buildPromptContext(
    conversationId: string,
    excludeMessageId: string
  ): Promise<ConversationMessage[]> {
    const recentMessages = await prisma.message.findMany({
      where: { conversationId, deletedAt: null, id: { not: excludeMessageId } },
      orderBy: { createdAt: 'desc' },
      take: PROMPT_HISTORY_WINDOW,
    })

    return recentMessages.reverse().map((message) => ({
      role:
        message.role === MessageRole.ASSISTANT
          ? 'assistant'
          : message.role === MessageRole.SYSTEM
            ? 'system'
            : 'user',
      content: message.content,
    }))
  }
}

/**
 * Retry backoff delay as a mutable, spy-able seam. Faking global timers
 * (vi.useFakeTimers) proved unsafe here — it also reaches into Prisma's own
 * internal timer usage and hangs real DB calls indefinitely, and spying on a
 * plain named export doesn't intercept same-module calls under ESM. Routing
 * the call through this object gives tests something they can actually
 * override (see conversationGeneration.service.test.ts).
 */
export const internals = {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },
}

export const conversationGenerationService = new ConversationGenerationService()
