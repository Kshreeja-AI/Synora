import { prisma as db } from '@synora/database'
import { logger } from '../utils/logger'
import { memoryRetrievalService } from './memoryRetrieval.service'

export interface ContextBuildRequest {
  conversationId: string
  userId: string
  workspaceId: string
  maxMemories?: number
  maxTokens?: number
  includeSystemContext?: boolean
}

export interface ConversationContext {
  conversationId: string
  relevantMemories: Array<{
    id: string
    content: string
    category?: string
    importance: number
  }>
  conversationHistory: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  systemPrompt: string
  metadata: {
    memoriesInContext: number
    tokensUsed: number
    context: string
  }
}

export interface ContextInjectionConfig {
  memoryLimit?: number // max memories to include
  tokenBudget?: number // max tokens for memories
  includeMetadata?: boolean
  prioritizeRecent?: boolean
  preferHighImportance?: boolean
}

/**
 * Conversation Context Building Service
 * Builds conversation context with relevant memories for AI models
 * Integrates with AIOrchestrator for prompt injection
 */
export class ConversationContextService {
  private readonly DEFAULT_MEMORY_LIMIT = 5
  private readonly DEFAULT_TOKEN_BUDGET = 2000
  private readonly TOKEN_ESTIMATE_RATIO = 4 // 1 word ≈ 1 token (conservative)

  /**
   * Build complete conversation context with memories
   */
  async buildContext(request: ContextBuildRequest, config?: ContextInjectionConfig): Promise<ConversationContext> {
    try {
      logger.info(`Building context for conversation ${request.conversationId}`)

      const memoryLimit = config?.memoryLimit ?? this.DEFAULT_MEMORY_LIMIT
      const tokenBudget = config?.tokenBudget ?? this.DEFAULT_TOKEN_BUDGET

      // Step 1: Fetch conversation
      const conversation = await db.conversation.findUnique({
        where: { id: request.conversationId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 20, // last 20 messages
          },
        },
      })

      if (!conversation) {
        return this.buildEmptyContext(request)
      }

      // Step 2: Extract conversation history (format for AI)
      const conversationHistory = conversation.messages.map((msg) => ({
        role: msg.role.toLowerCase() as 'user' | 'assistant',
        content: msg.content,
      }))

      // Step 3: Build query from recent messages to find relevant memories
      const recentContext = conversation.messages
        .slice(-5)
        .map((m) => m.content)
        .join(' ')

      // Step 4: Retrieve relevant memories
      const relevantMemories = await this.retrieveRelevantMemories(
        request.workspaceId,
        request.userId,
        recentContext,
        memoryLimit,
        tokenBudget,
        config,
      )

      // Step 5: Build system prompt
      const systemPrompt = this.buildSystemPrompt(
        conversation.title || 'Conversation',
        relevantMemories,
        config?.includeMetadata,
      )

      // Step 6: Calculate token usage
      const tokensUsed = this.estimateTokens(relevantMemories, systemPrompt)

      return {
        conversationId: request.conversationId,
        relevantMemories,
        conversationHistory,
        systemPrompt,
        metadata: {
          memoriesInContext: relevantMemories.length,
          tokensUsed,
          context: `${relevantMemories.length} memories, ${tokensUsed} tokens`,
        },
      }
    } catch (error) {
      logger.error('Failed to build context', { error, conversationId: request.conversationId })
      return this.buildEmptyContext(request)
    }
  }

  /**
   * Retrieve relevant memories for conversation
   */
  private async retrieveRelevantMemories(
    workspaceId: string,
    userId: string,
    query: string,
    limit: number,
    tokenBudget: number,
    config?: ContextInjectionConfig,
  ): Promise<ConversationContext['relevantMemories']> {
    try {
      // Retrieve memories using retrieval service (no caching for context memories)
      const retrieved = await memoryRetrievalService.retrieveMemories({
        query,
        workspaceId,
        userId,
        limit: limit * 2, // fetch more, filter by token budget
        filters: {
          minImportance: config?.preferHighImportance ? 0.4 : 0.1,
        },
      })

      // Filter by token budget
      const result: ConversationContext['relevantMemories'] = []
      let tokensUsed = 0

      for (const item of retrieved) {
        const contentTokens = this.estimateTokens([item.memory], '')

        if (tokensUsed + contentTokens <= tokenBudget) {
          result.push({
            id: item.memory.id,
            content: item.memory.content,
            category: item.memory.category || undefined,
            importance: item.memory.importance,
          })

          tokensUsed += contentTokens

          if (result.length >= limit) {
            break
          }
        }
      }

      return result
    } catch (error) {
      logger.warn('Failed to retrieve relevant memories', { error })
      return []
    }
  }

  /**
   * Build system prompt with memory context
   */
  private buildSystemPrompt(
    conversationTitle: string,
    memories: ConversationContext['relevantMemories'],
    includeMetadata: boolean = false,
  ): string {
    let prompt = `You are having a conversation titled "${conversationTitle}".`

    if (memories.length > 0) {
      prompt += '\n\nRelevant context from previous interactions:\n'

      memories.forEach((memory, index) => {
        prompt += `\n${index + 1}. `

        if (memory.category) {
          prompt += `[${memory.category}] `
        }

        prompt += memory.content

        if (includeMetadata && memory.importance) {
          prompt += ` (Relevance: ${(memory.importance * 100).toFixed(0)}%)`
        }
      })

      prompt += '\n\nUse this context to provide more relevant and personalized responses.'
    }

    return prompt
  }

  /**
   * Estimate token usage for content
   */
  private estimateTokens(
    memories: Array<{ content: string } | ConversationContext['relevantMemories'][0]>,
    additionalText: string = '',
  ): number {
    let totalTokens = 0

    // Estimate from memories
    memories.forEach((item) => {
      const content = 'content' in item ? item.content : ''
      const words = content.split(/\s+/).length
      totalTokens += Math.ceil(words / this.TOKEN_ESTIMATE_RATIO)
    })

    // Add additional text
    const additionalWords = additionalText.split(/\s+/).length
    totalTokens += Math.ceil(additionalWords / this.TOKEN_ESTIMATE_RATIO)

    return totalTokens
  }

  /**
   * Build empty context fallback
   */
  private buildEmptyContext(request: ContextBuildRequest): ConversationContext {
    return {
      conversationId: request.conversationId,
      relevantMemories: [],
      conversationHistory: [],
      systemPrompt: 'You are a helpful assistant in a conversation.',
      metadata: {
        memoriesInContext: 0,
        tokensUsed: 0,
        context: 'No previous context',
      },
    }
  }

  /**
   * Format context for AI model (prompt injection)
   */
  formatForAI(context: ConversationContext): string {
    let formatted = context.systemPrompt + '\n\n'

    if (context.conversationHistory.length > 0) {
      formatted += '=== Conversation History ===\n'
      context.conversationHistory.forEach((msg) => {
        formatted += `${msg.role.toUpperCase()}: ${msg.content}\n`
      })
      formatted += '\n'
    }

    return formatted
  }

  /**
   * Get context metadata for analytics
   */
  getMetadata(context: ConversationContext): {
    hasMemories: boolean
    memoryCount: number
    estimatedTokens: number
    contextScope: string
  } {
    return {
      hasMemories: context.relevantMemories.length > 0,
      memoryCount: context.relevantMemories.length,
      estimatedTokens: context.metadata.tokensUsed,
      contextScope: context.metadata.context,
    }
  }

  /**
   * Clear context cache (on memory updates)
   */
  clearContextCache(_workspaceId: string): void {
    try {
      // Context memories are not cached currently (retrieved fresh for each conversation)
      // This method is a placeholder for future caching implementation
      logger.debug(`Context cache invalidation requested`)
    } catch (error) {
      logger.warn('Failed to clear context cache', { error })
    }
  }

  /**
   * Validate context before sending to AI model
   */
  validateContext(context: ConversationContext): { valid: boolean; issues: string[] } {
    const issues: string[] = []

    if (!context.conversationId) {
      issues.push('Missing conversationId')
    }

    if (!context.systemPrompt || context.systemPrompt.length === 0) {
      issues.push('Empty system prompt')
    }

    if (context.metadata.tokensUsed > 4000) {
      issues.push('Context exceeds recommended token limit')
    }

    if (context.conversationHistory.length === 0) {
      issues.push('No conversation history')
    }

    return {
      valid: issues.length === 0,
      issues,
    }
  }

  async getContextStats(workspaceId: string): Promise<{
    avgMemoriesPerContext: number
    avgTokensPerContext: number
    cacheHitRate: number
  }> {
    try {
      const recentContexts = await db.memory.aggregate({
        where: { workspaceId, isArchived: false },
        _count: { id: true },
        _avg: { importance: true },
      })

      const totalMemories = recentContexts._count.id
      const conversations = await db.conversation.count({
        where: { workspaceId, status: { not: 'DELETED' } },
      })
      const avgMemoriesPerContext = conversations > 0 ? totalMemories / conversations : 0

      return {
        avgMemoriesPerContext: Math.round(avgMemoriesPerContext * 100) / 100,
        avgTokensPerContext: 0,
        cacheHitRate: 0,
      }
    } catch (error) {
      logger.warn('Failed to compute context stats, returning zeros', { workspaceId, error })
      return {
        avgMemoriesPerContext: 0,
        avgTokensPerContext: 0,
        cacheHitRate: 0,
      }
    }
  }
}

export const conversationContextService = new ConversationContextService()
