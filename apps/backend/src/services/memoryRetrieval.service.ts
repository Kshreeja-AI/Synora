import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { memoryEmbeddingService, isSemanticSearchAvailable } from './memoryEmbedding.service'
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
    /**
     * Vector similarity. Always 0 — and excluded from the weighting —
     * when semantic search is disabled for the deployment; check
     * `semanticSearchUsed` rather than reading 0 as "not similar".
     */
    semanticScore: number
    /** Fraction of query terms found in the memory's own text. */
    lexicalScore: number
    importanceScore: number
    recencyScore: number
    accessScore: number
    overallScore: number
    semanticSearchUsed: boolean
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
      const terms = this.tokenize(query.query)
      const hasQuery = Boolean(query.query && query.query.trim())

      // Step 1: Semantic search — only when a real embedding provider is
      // configured. When it isn't, the semantic signal is genuinely
      // absent and is dropped from the ranking rather than contributing
      // a fabricated (or uniformly zero) score.
      const semanticUsed = hasQuery && (await isSemanticSearchAvailable())
      let semanticResults: Array<{ memoryId: string; score: number }> = []
      if (semanticUsed) {
        semanticResults = await this.semanticSearch(query.query, query.workspaceId, limit * 3)
      }

      // Step 2: Lexical search over stored content — the always-available
      // retrieval path.
      let lexicalResults: Memory[] = []
      if (hasQuery) {
        lexicalResults = await this.lexicalSearch(terms, query.workspaceId, limit * 3)
      }

      // Step 3: Build candidate pool
      const candidateIds = new Set<string>()
      semanticResults.forEach((r) => candidateIds.add(r.memoryId))
      lexicalResults.forEach((m) => candidateIds.add(m.id))

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
        const lexicalScore = this.calculateLexicalScore(memory, terms)
        const importanceScore = memory.importance // 0-1
        const recencyScore = this.calculateRecencyScore(memory.createdAt)
        const accessScore = this.calculateAccessScore(memory.accessCount || 0)

        const overallScore = this.calculateOverallScore(
          {
            semantic: semanticScore,
            lexical: lexicalScore,
            importance: importanceScore,
            recency: recencyScore,
            access: accessScore,
          },
          semanticUsed,
        )

        return {
          memory,
          relevanceScore: overallScore,
          rankingDetails: {
            semanticScore,
            lexicalScore,
            importanceScore,
            recencyScore,
            accessScore,
            overallScore,
            semanticSearchUsed: semanticUsed,
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
   * Split a query into searchable terms. Single- and two-character
   * tokens are dropped: they match almost everything and would flatten
   * the lexical score.
   */
  private tokenize(query: string | undefined): string[] {
    if (!query) return []
    return [
      ...new Set(
        query
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length > 2),
      ),
    ]
  }

  /**
   * Case-insensitive term matching over a memory's own text and tags.
   * Every term is searched (the previous implementation only queried
   * the first one, so "docker compose config" retrieved on "docker"
   * alone), and the candidate pool is intentionally an OR — per-term
   * precision is what the lexical score below is for.
   */
  private async lexicalSearch(terms: string[], workspaceId: string, limit: number): Promise<Memory[]> {
    if (terms.length === 0) {
      return []
    }

    try {
      return await db.memory.findMany({
        where: {
          workspaceId,
          OR: [
            ...terms.flatMap((term) => [
              { content: { contains: term, mode: 'insensitive' as const } },
              { summary: { contains: term, mode: 'insensitive' as const } },
            ]),
            { tags: { hasSome: terms } },
          ],
        },
        take: limit,
      })
    } catch (error) {
      logger.warn('Lexical memory search failed', { error })
      return []
    }
  }

  /**
   * Fraction of query terms present in the memory's text or tags — a
   * real measurement of overlap, not a similarity estimate. 0 when
   * there is no query, so query-less context retrieval ranks purely on
   * importance/recency/access.
   */
  private calculateLexicalScore(memory: Memory, terms: string[]): number {
    if (terms.length === 0) {
      return 0
    }

    const haystack = `${memory.content} ${memory.summary ?? ''} ${memory.tags.join(' ')}`.toLowerCase()
    const matched = terms.filter((term) => haystack.includes(term)).length

    return matched / terms.length
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
  private calculateOverallScore(
    scores: {
      semantic: number
      lexical: number
      importance: number
      recency: number
      access: number
    },
    semanticAvailable: boolean,
  ): number {
    // Signals are weighted over what's actually measurable. When no
    // embedding provider is configured the semantic weight is dropped
    // and the remainder renormalized, so scores stay on a comparable
    // 0-1 scale instead of being uniformly deflated by the missing 0.3.
    const weights: Array<[number, number]> = [
      [scores.lexical, 0.3],
      [scores.importance, 0.25],
      [scores.recency, 0.2],
      [scores.access, 0.1],
    ]
    if (semanticAvailable) {
      weights.push([scores.semantic, 0.3])
    }

    const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0)
    const weighted = weights.reduce((sum, [value, w]) => sum + value * w, 0)

    return totalWeight > 0 ? weighted / totalWeight : 0
  }

  /**
   * Record memory retrieval for analytics
   */
  private recordRetrieval(memoryId: string, userId?: string): void {
    if (!userId) return
    memoryCacheService.recordMemoryAccess(memoryId, userId).catch((error) => {
      logger.warn('Failed to record memory access', { error, memoryId })
    })
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
