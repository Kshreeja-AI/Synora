import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { memoryEmbeddingService } from './memoryEmbedding.service'
import { memoryCacheService } from './memoryCache.service'
import { logger } from '../utils/logger'

export interface RetrievalQuery {
  query: string
  workspaceId: string
  userId?: string
  conversationId?: string
  limit?: number
  filters?: {
    type?: string
    category?: string
    tags?: string[]
    minImportance?: number
    maxAge?: number // days
    onlyPinned?: boolean
  }
}

export interface RetrievedMemory {
  memory: Memory
  relevanceScore: number
  rankingDetails: {
    semanticScore: number
    importanceScore: number
    recencyScore: number
    accessScore: number
    overallScore: number
  }
}

/**
 * Memory Retrieval Service
 * Handles memory retrieval with advanced ranking and relevance scoring
 * Combines semantic search, importance, recency, and access patterns
 */
export class MemoryRetrievalService {
  private readonly DEFAULT_LIMIT = 10

  /**
   * Retrieve memories with multi-signal ranking
   * Combines semantic similarity, importance, recency, and access frequency
   */
  async retrieveMemories(query: RetrievalQuery): Promise<RetrievedMemory[]> {
    try {
      const limit = query.limit || this.DEFAULT_LIMIT

      // Step 1: Semantic search (if query provided)
      let semanticResults: Array<{ memoryId: string; score: number }> = []
      if (query.query && query.query.trim()) {
        semanticResults = await this.semanticSearch(query.query, query.workspaceId, limit * 3)
      }

      // Step 2: Full-text search fallback (mock for now - Elasticsearch later)
      let fullTextResults: Memory[] = []
      if (query.query && query.query.trim()) {
        fullTextResults = await this.fullTextSearch(query.query, query.workspaceId, limit * 3)
      }

      // Step 3: Build candidate pool
      const candidateIds = new Set<string>()
      semanticResults.forEach((r) => candidateIds.add(r.memoryId))
      fullTextResults.forEach((m) => candidateIds.add(m.id))

      // Step 4: Fetch full memory records for candidates
      const candidates = await db.memory.findMany({
        where: {
          id: { in: Array.from(candidateIds) },
          workspaceId: query.workspaceId,
        },
        include: {
          metadata: true,
        },
      })

      // Step 5: Apply access control filters
      let filtered = await this.applyAccessControl(candidates, query.userId)

      // Step 6: Apply user-provided filters
      if (query.filters) {
        filtered = this.applyFilters(filtered, query.filters)
      }

      // Step 7: Calculate ranking scores for each memory
      const scored = filtered.map((memory) => {
        const semanticScore = this.getSemanticScore(memory.id, semanticResults)
        const importanceScore = memory.importance // 0-1
        const recencyScore = this.calculateRecencyScore(memory.createdAt)
        const accessScore = this.calculateAccessScore(memory.accessCount || 0)

        const overallScore = this.calculateOverallScore({
          semantic: semanticScore,
          importance: importanceScore,
          recency: recencyScore,
          access: accessScore,
        })

        return {
          memory,
          relevanceScore: overallScore,
          rankingDetails: {
            semanticScore,
            importanceScore,
            recencyScore,
            accessScore,
            overallScore,
          },
        }
      })

      // Step 8: Sort by overall score and return top N
      const results = scored
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit)

      // Step 9: Record retrieval for analytics
      results.forEach((r) => {
        this.recordRetrieval(r.memory.id, query.userId)
      })

      return results
    } catch (error) {
      logger.error('Memory retrieval failed', { error, query })
      throw new ValidationException('Memory retrieval failed')
    }
  }

  /**
   * Retrieve memories for conversation context (no query, ranked by relevance)
   */
  async retrieveContextMemories(
    conversationId: string,
    userId: string,
    workspaceId: string,
    limit: number = 5,
  ): Promise<RetrievedMemory[]> {
    try {
      // Get conversation to extract key topics
      const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            select: { content: true },
            orderBy: { createdAt: 'desc' },
            take: 5, // Last 5 messages for context
          },
        },
      })

      if (!conversation) {
        return []
      }

      // Build query from conversation context
      const contextText = conversation.messages.map((m) => m.content).join(' ')

      // Retrieve memories relevant to conversation
      return this.retrieveMemories({
        query: contextText,
        workspaceId,
        userId,
        conversationId,
        limit,
        filters: {
          minImportance: 0.2, // Only relevant memories
        },
      })
    } catch (error) {
      logger.error('Context memory retrieval failed', { error, conversationId })
      return []
    }
  }

  /**
   * Semantic search via vector DB
   */
  private async semanticSearch(
    query: string,
    workspaceId: string,
    limit: number,
  ): Promise<Array<{ memoryId: string; score: number }>> {
    try {
      const results = await memoryEmbeddingService.semanticSearch(query, workspaceId, limit)
      return results.map((r) => ({
        memoryId: r.memoryId,
        score: r.score,
      }))
    } catch (error) {
      logger.warn('Semantic search failed', { error })
      return []
    }
  }

  /**
   * Full-text search (mock - Elasticsearch integration later)
   */
  private async fullTextSearch(query: string, workspaceId: string, limit: number): Promise<Memory[]> {
    try {
      const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)

      if (terms.length === 0) {
        return []
      }

      // For now, use simple contains matching (full-text search via Elasticsearch in production)
      const memories = await db.memory.findMany({
        where: {
          workspaceId,
          OR: [
            {
              content: {
                contains: terms[0] || '',
                mode: 'insensitive',
              },
            },
            {
              summary: {
                contains: terms[0] || '',
                mode: 'insensitive',
              },
            },
            {
              tags: {
                hasSome: terms,
              },
            },
          ],
        },
        take: limit,
      })

      return memories
    } catch (error) {
      logger.warn('Full-text search failed', { error })
      return []
    }
  }

  /**
   * Apply access control (PRIVATE, WORKSPACE, SHARED, PUBLIC)
   */
  private async applyAccessControl(memories: Memory[], userId?: string): Promise<Memory[]> {
    if (!userId) {
      // Unauthenticated: only PUBLIC
      return memories.filter((m) => m.permission === 'PUBLIC')
    }

    // Authenticated user: own + workspace + shared + public
    return memories.filter((m) => {
      if (m.permission === 'PUBLIC') return true
      if (m.permission === 'WORKSPACE') return true
      if (m.permission === 'PRIVATE' && m.userId === userId) return true
      if (m.permission === 'SHARED' && m.sharedWith?.includes(userId)) return true
      return false
    })
  }

  /**
   * Apply user-provided filters
   */
  private applyFilters(memories: Memory[], filters: RetrievalQuery['filters']): Memory[] {
    let result = [...memories]

    if (filters?.type) {
      result = result.filter((m) => m.type === filters.type)
    }

    if (filters?.category) {
      result = result.filter((m) => m.category === filters.category)
    }

    if (filters?.tags && filters.tags.length > 0) {
      result = result.filter((m) => filters.tags!.some((tag) => m.tags.includes(tag)))
    }

    if (filters?.minImportance !== undefined) {
      result = result.filter((m) => m.importance >= filters.minImportance!)
    }

    if (filters?.maxAge) {
      const threshold = new Date(Date.now() - filters.maxAge * 24 * 60 * 60 * 1000)
      result = result.filter((m) => m.createdAt >= threshold)
    }

    if (filters?.onlyPinned) {
      result = result.filter((m) => m.isPinned)
    }

    return result
  }

  /**
   * Get semantic score from search results
   */
  private getSemanticScore(memoryId: string, semanticResults: Array<{ memoryId: string; score: number }>): number {
    const result = semanticResults.find((r) => r.memoryId === memoryId)
    return result?.score || 0
  }

  /**
   * Calculate recency score (0-1)
   * Higher score for recent memories, exponential decay
   */
  private calculateRecencyScore(createdAt: Date): number {
    const now = Date.now()
    const created = createdAt.getTime()
    const ageMs = now - created
    const ageDays = ageMs / (24 * 60 * 60 * 1000)

    // Exponential decay: score = e^(-ageDays/30)
    // At 30 days: 0.37, at 60 days: 0.14, at 90 days: 0.05
    return Math.exp(-ageDays / 30)
  }

  /**
   * Calculate access score (0-1)
   * Higher score for frequently accessed memories
   */
  private calculateAccessScore(accessCount: number): number {
    // Logarithmic scaling: log(accessCount + 1) / log(maxCount)
    // At 1 access: 0.1, at 10: 0.41, at 100: 0.67, at 1000: 0.91
    const maxCount = 1000
    if (accessCount === 0) return 0
    return Math.log(accessCount + 1) / Math.log(maxCount + 1)
  }

  /**
   * Calculate overall ranking score (0-1)
   * Weighted combination of multiple signals
   */
  private calculateOverallScore(scores: {
    semantic: number
    importance: number
    recency: number
    access: number
  }): number {
    // Weights: semantic(0.4) + importance(0.3) + recency(0.2) + access(0.1)
    const weight = {
      semantic: 0.4,
      importance: 0.3,
      recency: 0.2,
      access: 0.1,
    }

    return (
      scores.semantic * weight.semantic +
      scores.importance * weight.importance +
      scores.recency * weight.recency +
      scores.access * weight.access
    )
  }

  /**
   * Record memory retrieval for analytics
   */
  private recordRetrieval(memoryId: string, userId?: string): void {
    try {
      if (userId) {
        memoryCacheService.recordMemoryAccess(memoryId, userId)
      }
    } catch (error) {
      logger.warn('Failed to record memory access', { error, memoryId })
    }
  }

  /**
   * Get similar memories (for deduplication/clustering)
   */
  async findSimilarMemories(
    memoryId: string,
    threshold: number = 0.85,
    limit: number = 5,
  ): Promise<Array<{ memory: Memory; similarity: number }>> {
    try {
      const memory = await db.memory.findUnique({
        where: { id: memoryId },
      })

      if (!memory) {
        throw new NotFoundException('Memory not found')
      }

      if (!memory.embeddingId) {
        return []
      }

      // Semantic search for similar memories
      const results = await memoryEmbeddingService.semanticSearch(
        memory.content,
        memory.workspaceId,
        limit + 1, // +1 to exclude self
      )

      // Filter self and by threshold
      return results
        .filter((r) => r.memoryId !== memoryId && r.score >= threshold)
        .slice(0, limit)
        .map((r) => ({
          memory: r.memory,
          similarity: r.score,
        }))
    } catch (error) {
      logger.error('Failed to find similar memories', { error, memoryId })
      return []
    }
  }

  /**
   * Get memory statistics for workspace
   */
  async getRetrievalStats(workspaceId: string): Promise<{
    totalMemories: number
    avgRetrievalScore: number
    mostRetrieved: Memory[]
    leastRetrieved: Memory[]
  }> {
    try {
      const memories = await db.memory.findMany({
        where: { workspaceId },
        orderBy: { accessCount: 'desc' },
        take: 100,
      })

      const avgRetrievalScore = memories.reduce((sum, m) => sum + (m.importance || 0), 0) / memories.length

      return {
        totalMemories: memories.length,
        avgRetrievalScore,
        mostRetrieved: memories.slice(0, 5),
        leastRetrieved: memories.slice(-5).reverse(),
      }
    } catch (error) {
      logger.error('Failed to get retrieval stats', { error, workspaceId })
      return {
        totalMemories: 0,
        avgRetrievalScore: 0,
        mostRetrieved: [],
        leastRetrieved: [],
      }
    }
  }
}

export const memoryRetrievalService = new MemoryRetrievalService()
