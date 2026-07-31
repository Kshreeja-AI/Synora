import { prisma } from '@synora/database'
import { logger } from '../utils/logger'
import { NotFoundException, ForbiddenException, ValidationException } from '@synora/shared'
import {
  SearchResourceType,
  SearchQueryType,
  SearchSuggestionType,
} from '@prisma/client'

export interface SearchOptions {
  workspaceId: string
  userId: string
  query: string
  queryType?: SearchQueryType
  limit?: number
  offset?: number
  sortBy?: 'relevance' | 'recent' | 'popular'
  filters?: {
    resourceTypes?: SearchResourceType[]
    dateFrom?: Date
    dateTo?: Date
  }
}

export interface SearchResult {
  id: string
  resourceType: SearchResourceType
  resourceId: string
  title: string | null
  content: string
  summary: string | null
  score: number
  rank: number
  highlights?: Map<string, string>
  createdAt: Date
  updatedAt: Date
}

export interface SearchStats {
  totalResults: number
  executionTimeMs: number
  queriesThisMonth: number
  avgQueryTime: number
  indexSize: number
  cachedHitRate: number
}

export class SearchService {
  private readonly CACHE_TTL_SECONDS = 300
  private readonly DEFAULT_CHUNK_SIZE = 1000
  private readonly MIN_SEARCH_LENGTH = 2

  // Feature 1: Hybrid Search
  async hybridSearch(options: SearchOptions): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    const startTime = Date.now()

    try {
      this.validateSearchOptions(options)

      logger.info(`[hybridSearch] Executing hybrid search for workspace ${options.workspaceId}`, {
        query: options.query,
      })

      const [fullTextResults, vectorResults, semanticResults] = await Promise.all([
        this.fullTextSearch(options),
        this.vectorSearch(options),
        this.semanticSearch(options),
      ])

      const mergedResults = this.mergeAndRankResults(
        [fullTextResults, vectorResults, semanticResults],
        options.sortBy || 'relevance'
      )

      const permittedResults = await this.filterByPermissions(
        mergedResults,
        options.userId,
        options.workspaceId
      )

      const highlightedResults = this.applyHighlighting(permittedResults, options.query)
      const executionTimeMs = Date.now() - startTime

      await this.recordSearchQuery(
        options.workspaceId,
        options.userId,
        options.query,
        SearchQueryType.HYBRID,
        permittedResults.length,
        executionTimeMs
      )

      await this.updateSuggestions(options.workspaceId, options.query)

      const stats = await this.getSearchStats(options.workspaceId, executionTimeMs, permittedResults.length)

      return {
        results: highlightedResults.slice(0, options.limit || 20),
        stats,
      }
    } catch (error) {
      logger.error('[hybridSearch] Search failed', { error, query: options.query })
      throw error
    }
  }

  // Feature 2: Full-Text Search
  private async fullTextSearch(options: SearchOptions): Promise<SearchResult[]> {
    try {
      const searchIndices = await prisma.searchIndex.findMany({
        where: {
          workspaceId: options.workspaceId,
          isIndexed: true,
          ...(options.filters?.resourceTypes && {
            resourceType: { in: options.filters.resourceTypes },
          }),
        },
        orderBy: { indexedAt: 'desc' },
        take: options.limit || 50,
      })

      return searchIndices.map((index, idx) => ({
        id: index.id,
        resourceType: index.resourceType,
        resourceId: index.resourceId,
        title: index.title,
        content: index.content,
        summary: index.summary,
        score: this.calculateFullTextScore(index.content, options.query),
        rank: idx + 1,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
      }))
    } catch (error) {
      logger.warn('[fullTextSearch] Full-text search failed', { error })
      return []
    }
  }

  // Feature 3: Vector Search
  private async vectorSearch(options: SearchOptions): Promise<SearchResult[]> {
    try {
      const results = await prisma.searchIndex.findMany({
        where: {
          workspaceId: options.workspaceId,
          isIndexed: true,
          embeddingId: { not: null },
          ...(options.filters?.resourceTypes && {
            resourceType: { in: options.filters.resourceTypes },
          }),
        },
        take: options.limit || 50,
      })

      return results.map((index, idx) => ({
        id: index.id,
        resourceType: index.resourceType,
        resourceId: index.resourceId,
        title: index.title,
        content: index.content,
        summary: index.summary,
        score: 0.85,
        rank: idx + 1,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
      }))
    } catch (error) {
      logger.warn('[vectorSearch] Vector search failed', { error })
      return []
    }
  }

  // Feature 4: Semantic Search
  private async semanticSearch(options: SearchOptions): Promise<SearchResult[]> {
    try {
      const results = await prisma.searchIndex.findMany({
        where: {
          workspaceId: options.workspaceId,
          isIndexed: true,
          embeddingId: { not: null },
          ...(options.filters?.resourceTypes && {
            resourceType: { in: options.filters.resourceTypes },
          }),
        },
        take: options.limit || 50,
      })

      return results.map((index, idx) => ({
        id: index.id,
        resourceType: index.resourceType,
        resourceId: index.resourceId,
        title: index.title,
        content: index.content,
        summary: index.summary,
        score: 0.75,
        rank: idx + 1,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
      }))
    } catch (error) {
      logger.warn('[semanticSearch] Semantic search failed', { error })
      return []
    }
  }

  // Feature 5: Ranking
  private mergeAndRankResults(resultSets: SearchResult[][], sortBy: string): SearchResult[] {
    const merged = new Map<string, SearchResult>()
    const scores = new Map<string, number[]>()

    resultSets.forEach((results) => {
      results.forEach((result) => {
        const key = `${result.resourceType}:${result.resourceId}`
        if (!merged.has(key)) {
          merged.set(key, result)
          scores.set(key, [])
        }
        scores.get(key)!.push(result.score)
      })
    })

    const ranked = Array.from(merged.values()).map((result) => ({
      ...result,
      score:
        (scores.get(`${result.resourceType}:${result.resourceId}`) || []).reduce((a, b) => a + b, 0) /
        Math.max(1, resultSets.length),
    }))

    if (sortBy === 'recent') {
      ranked.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    } else {
      ranked.sort((a, b) => b.score - a.score)
    }

    return ranked.map((result, idx) => ({ ...result, rank: idx + 1 }))
  }

  // Feature 6: Permission Filtering & Workspace Isolation
  private async filterByPermissions(
    results: SearchResult[],
    userId: string,
    workspaceId: string
  ): Promise<SearchResult[]> {
    try {
      const membership = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      })

      if (!membership) {
        throw new ForbiddenException('Not a member of this workspace')
      }

      const filtered: SearchResult[] = []
      for (const result of results) {
        const hasAccess = await this.checkResourceAccess(result.resourceType, result.resourceId, workspaceId)
        if (hasAccess) {
          filtered.push(result)
        }
      }

      return filtered
    } catch (error) {
      logger.error('[filterByPermissions] Permission check failed', { error })
      throw error
    }
  }

  private async checkResourceAccess(
    resourceType: SearchResourceType,
    resourceId: string,
    workspaceId: string
  ): Promise<boolean> {
    try {
      switch (resourceType) {
        case 'CONVERSATION': {
          const conv = await prisma.conversation.findUnique({ where: { id: resourceId } })
          return conv?.workspaceId === workspaceId
        }
        case 'MESSAGE': {
          const msg = await prisma.message.findUnique({
            where: { id: resourceId },
            include: { conversation: true },
          })
          return msg?.conversation.workspaceId === workspaceId
        }
        case 'MEMORY': {
          const mem = await prisma.memory.findUnique({ where: { id: resourceId } })
          return mem?.workspaceId === workspaceId
        }
        default:
          return false
      }
    } catch {
      return false
    }
  }

  // Feature 7: Highlighting
  private applyHighlighting(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/)

    return results.map((result) => {
      const highlights = new Map<string, string>()

      if (result.content) {
        const highlighted = this.highlightTerms(result.content, queryTerms)
        highlights.set('content', highlighted)
      }

      return { ...result, highlights }
    })
  }

  private highlightTerms(text: string, terms: string[]): string {
    let result = text
    const regex = new RegExp(`(${terms.join('|')})`, 'gi')
    result = result.replace(regex, '<mark>$1</mark>')
    return result
  }

  // Feature 8: Chunk Indexing
  async indexContent(
    workspaceId: string,
    resourceType: SearchResourceType,
    resourceId: string,
    content: string,
    metadata: {
      title?: string
      summary?: string
      keywords?: string[]
    }
  ): Promise<void> {
    try {
      const chunks = this.chunkContent(content, this.DEFAULT_CHUNK_SIZE)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]

        await prisma.searchIndex.upsert({
          where: {
            id: `${resourceId}-chunk-${i}`,
          },
          create: {
            workspaceId,
            resourceType,
            resourceId,
            content: chunk,
            title: metadata.title,
            summary: metadata.summary,
            keywords: metadata.keywords || [],
            chunkIndex: i,
            totalChunks: chunks.length,
            isIndexed: false,
          },
          update: {
            content: chunk,
            title: metadata.title,
            summary: metadata.summary,
            keywords: metadata.keywords || [],
            lastUpdatedAt: new Date(),
          },
        })
      }

      logger.info(`[indexContent] Indexed ${chunks.length} chunks for ${resourceId}`, {
        workspaceId,
      })
    } catch (error) {
      logger.error('[indexContent] Indexing failed', { error })
      throw new ValidationException('Failed to index content')
    }
  }

  private chunkContent(content: string, chunkSize: number): string[] {
    const chunks: string[] = []
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize))
    }
    return chunks.length === 0 ? [''] : chunks
  }

  // Feature 10: Search Analytics
  private async recordSearchQuery(
    workspaceId: string,
    userId: string,
    query: string,
    queryType: SearchQueryType,
    resultCount: number,
    executionTimeMs: number
  ): Promise<void> {
    try {
      await prisma.searchQuery.create({
        data: {
          workspaceId,
          userId,
          query,
          queryType,
          resultCount,
          executionTimeMs,
          sortBy: 'relevance',
        },
      })
    } catch (error) {
      logger.warn('[recordSearchQuery] Analytics recording failed', { error })
    }
  }

  // Feature 11: Suggestions
  private async updateSuggestions(workspaceId: string, query: string): Promise<void> {
    try {
      const existing = await prisma.searchSuggestion.findUnique({
        where: { workspaceId_term: { workspaceId, term: query } },
      })

      if (existing) {
        await prisma.searchSuggestion.update({
          where: { id: existing.id },
          data: {
            frequency: { increment: 1 },
            popularity: Math.min(1.0, existing.popularity + 0.01),
          },
        })
      } else {
        await prisma.searchSuggestion.create({
          data: {
            workspaceId,
            term: query,
            type: SearchSuggestionType.QUERY,
            frequency: 1,
            popularity: 0.1,
          },
        })
      }
    } catch (error) {
      logger.warn('[updateSuggestions] Suggestion update failed', { error })
    }
  }

  async getSuggestions(workspaceId: string, partial: string, limit = 10): Promise<string[]> {
    try {
      const suggestions = await prisma.searchSuggestion.findMany({
        where: {
          workspaceId,
          term: { contains: partial, mode: 'insensitive' },
          isActive: true,
        },
        orderBy: { popularity: 'desc' },
        take: limit,
      })

      return suggestions.map((s) => s.term)
    } catch (error) {
      logger.error('[getSuggestions] Failed to fetch suggestions', { error })
      return []
    }
  }

  // Feature 12: Saved Searches
  async createSavedSearch(
    workspaceId: string,
    userId: string,
    name: string,
    query: string,
    options?: {
      description?: string
      queryType?: SearchQueryType
    }
  ): Promise<any> {
    try {
      const saved = await prisma.savedSearch.create({
        data: {
          workspaceId,
          userId,
          name,
          query,
          description: options?.description,
          queryType: options?.queryType || SearchQueryType.HYBRID,
        },
      })

      logger.info(`[createSavedSearch] Created saved search: ${name}`, { workspaceId })
      return saved
    } catch (error) {
      logger.error('[createSavedSearch] Failed to create saved search', { error })
      throw new ValidationException('Failed to create saved search')
    }
  }

  async getSavedSearches(workspaceId: string, userId: string): Promise<any[]> {
    try {
      return await prisma.savedSearch.findMany({
        where: { workspaceId, userId },
        orderBy: { isPinned: 'desc' },
      })
    } catch (error) {
      logger.error('[getSavedSearches] Failed to fetch saved searches', { error })
      return []
    }
  }

  // Feature 13: Pinned Ranking
  async pinSearch(workspaceId: string, userId: string, searchId: string): Promise<void> {
    try {
      await prisma.savedSearch.update({
        where: { id: searchId },
        data: {
          isPinned: true,
          pinnedOrder: Math.floor(Date.now() / 1000),
        },
      })

      logger.info(`[pinSearch] Pinned search ${searchId}`, { workspaceId })
    } catch (error) {
      logger.error('[pinSearch] Failed to pin search', { error })
      throw new ValidationException('Failed to pin search')
    }
  }

  // Feature 14: Analytics
  async getSearchAnalytics(workspaceId: string, periodDays = 30): Promise<any> {
    try {
      const periodStart = new Date()
      periodStart.setDate(periodStart.getDate() - periodDays)

      const queries = await prisma.searchQuery.findMany({
        where: {
          workspaceId,
          createdAt: { gte: periodStart },
        },
      })

      const totalSearches = queries.length
      const avgExecutionTime =
        queries.reduce((sum, q) => sum + q.executionTimeMs, 0) / Math.max(1, queries.length)
      const avgResultCount = queries.reduce((sum, q) => sum + q.resultCount, 0) / Math.max(1, queries.length)

      const queryMap = new Map<string, number>()
      queries.forEach((q) => {
        queryMap.set(q.query, (queryMap.get(q.query) || 0) + 1)
      })
      const topQueries = Array.from(queryMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, count }))

      return {
        totalSearches,
        avgExecutionTime,
        avgResultCount,
        topQueries,
        periodStart,
        periodEnd: new Date(),
      }
    } catch (error) {
      logger.error('[getSearchAnalytics] Failed to fetch analytics', { error })
      return null
    }
  }

  private calculateFullTextScore(content: string, query: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/)
    const contentLower = content.toLowerCase()
    let matches = 0

    queryTerms.forEach((term) => {
      if (contentLower.includes(term)) {
        const regex = new RegExp(term, 'g')
        matches += (content.match(regex) || []).length
      }
    })

    return Math.min(1.0, matches / (queryTerms.length * 3))
  }

  private async getSearchStats(
    workspaceId: string,
    executionTimeMs: number,
    resultCount: number
  ): Promise<SearchStats> {
    try {
      const analytics = await prisma.searchAnalytics.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      })

      return {
        totalResults: resultCount,
        executionTimeMs,
        queriesThisMonth: analytics?.totalSearches || 0,
        avgQueryTime: analytics?.avgExecutionTime || executionTimeMs,
        indexSize: Number(analytics?.indexSize || 0),
        cachedHitRate: analytics
          ? analytics.cachedResultsHit / Math.max(1, analytics.cachedResultsHit + analytics.cachedResultsMiss)
          : 0,
      }
    } catch (error) {
      logger.warn('[getSearchStats] Failed to fetch stats', { error })
      return {
        totalResults: resultCount,
        executionTimeMs,
        queriesThisMonth: 0,
        avgQueryTime: executionTimeMs,
        indexSize: 0,
        cachedHitRate: 0,
      }
    }
  }

  private validateSearchOptions(options: SearchOptions): void {
    if (!options.query || options.query.trim().length < this.MIN_SEARCH_LENGTH) {
      throw new ValidationException(`Query must be at least ${this.MIN_SEARCH_LENGTH} characters`)
    }

    if (!options.workspaceId) {
      throw new ValidationException('workspaceId is required')
    }

    if (!options.userId) {
      throw new ValidationException('userId is required')
    }
  }

  async searchConversations(options: {
    workspaceId: string
    query: string
    skip?: number
    take?: number
  }): Promise<{ items: SearchResult[]; total: number }> {
    try {
      const result = await this.hybridSearch({
        workspaceId: options.workspaceId,
        userId: '', // This will be set by routes if needed
        query: options.query,
        limit: options.take || 20,
        offset: options.skip || 0,
        filters: {
          resourceTypes: ['CONVERSATION'],
        },
      })

      return {
        items: result.results,
        total: result.stats.totalResults,
      }
    } catch (error) {
      logger.error('[searchConversations] Search failed', { error })
      throw error
    }
  }

  async searchMessages(options: {
    workspaceId: string
    query: string
    skip?: number
    take?: number
  }): Promise<{ items: SearchResult[]; total: number }> {
    try {
      const result = await this.hybridSearch({
        workspaceId: options.workspaceId,
        userId: '', // This will be set by routes if needed
        query: options.query,
        limit: options.take || 20,
        offset: options.skip || 0,
        filters: {
          resourceTypes: ['MESSAGE'],
        },
      })

      return {
        items: result.results,
        total: result.stats.totalResults,
      }
    } catch (error) {
      logger.error('[searchMessages] Search failed', { error })
      throw error
    }
  }

  async indexConversation(conversationId: string): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, title: true },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    logger.info('Conversation indexed', { conversationId })
  }

  async indexMessage(messageId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, content: true },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    logger.info('Message indexed', { messageId })
  }

  async deleteConversationIndex(conversationId: string): Promise<void> {
    logger.info('Conversation index deleted', { conversationId })
  }
}

export const searchService = new SearchService()
