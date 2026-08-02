import { prisma } from '@synora/database'
import { Prisma } from '@prisma/client'
import { logger } from '../utils/logger'
import { NotFoundException, ForbiddenException, ValidationException } from '@synora/shared'
import {
  SearchResourceType,
  SearchQueryType,
  SearchSuggestionType,
  SavedSearch,
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

interface FtsRow {
  id: string
  resourceType: SearchResourceType
  resourceId: string
  title: string | null
  content: string
  summary: string | null
  createdAt: Date
  updatedAt: Date
  rank: number
}

export class SearchService {
  private readonly MIN_SEARCH_LENGTH = 2

  async hybridSearch(options: SearchOptions): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    const startTime = Date.now()

    try {
      this.validateSearchOptions(options)

      logger.info(`[hybridSearch] Executing hybrid search for workspace ${options.workspaceId}`, {
        query: options.query,
      })

      const ftsResults = await this.fullTextSearch(options)

      let vectorResults: SearchResult[] = []
      try {
        vectorResults = await this.vectorSearch(options)
      } catch (err) {
        logger.debug('[hybridSearch] Vector search unavailable, continuing with FTS only', {
          reason: err instanceof Error ? err.message : 'unknown',
        })
      }

      const mergedResults = this.mergeAndRankResults(
        vectorResults.length > 0 ? [ftsResults, vectorResults] : [ftsResults],
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

  private async fullTextSearch(options: SearchOptions): Promise<SearchResult[]> {
    try {
      const resourceFilter = options.filters?.resourceTypes
      const limit = options.limit || 50

      const results = await prisma.$queryRawUnsafe<FtsRow[]>(
        `SELECT
           id,
           "resourceType"::text AS "resourceType",
           "resourceId",
           title,
           content,
           summary,
           "createdAt",
           "updatedAt",
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS rank
         FROM "SearchIndex"
         WHERE "workspaceId" = $2
           AND "isIndexed" = true
           AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
           ${resourceFilter && resourceFilter.length > 0 ? `AND "resourceType"::text = ANY($4::text[])` : ''}
         ORDER BY rank DESC
         LIMIT $3`,
        options.query,
        options.workspaceId,
        limit,
        ...(resourceFilter && resourceFilter.length > 0 ? [resourceFilter] : [])
      )

      return results.map((row, idx) => ({
        id: row.id,
        resourceType: row.resourceType as SearchResourceType,
        resourceId: row.resourceId,
        title: row.title,
        content: row.content,
        summary: row.summary,
        score: Number(row.rank),
        rank: idx + 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
    } catch (error) {
      logger.warn('[fullTextSearch] PostgreSQL FTS query failed, falling back to ILIKE', { error })
      return this.ilikeFallback(options)
    }
  }

  private async ilikeFallback(options: SearchOptions): Promise<SearchResult[]> {
    const searchIndices = await prisma.searchIndex.findMany({
      where: {
        workspaceId: options.workspaceId,
        isIndexed: true,
        content: { contains: options.query, mode: Prisma.QueryMode.insensitive },
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
      score: 0.5,
      rank: idx + 1,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
    }))
  }

  private async vectorSearch(options: SearchOptions): Promise<SearchResult[]> {
    let embed: typeof import('../embeddings').embed
    let queryVectors: typeof import('../vectordb').queryVectors

    try {
      const embeddingsModule = await import('../embeddings')
      const vectordbModule = await import('../vectordb')
      embed = embeddingsModule.embed
      queryVectors = vectordbModule.queryVectors
    } catch {
      logger.debug('[vectorSearch] Embedding or vectordb modules unavailable')
      return []
    }

    let embeddingResult
    try {
      embeddingResult = await embed(options.query, { workspaceId: options.workspaceId })
    } catch (err) {
      logger.debug('[vectorSearch] No embedding provider configured, skipping vector search', {
        reason: err instanceof Error ? err.name : 'unknown',
      })
      return []
    }

    try {
      const queryResult = await queryVectors({
        workspaceId: options.workspaceId,
        namespace: 'search',
        vector: Array.from(embeddingResult.embedding.values),
        topK: options.limit || 50,
        includeMetadata: true,
        permissionFilter: (match) => {
          if (!match.metadata) return true
          if (options.filters?.resourceTypes) {
            return options.filters.resourceTypes.includes(match.metadata.resourceType as SearchResourceType)
          }
          return true
        },
      })

      if (queryResult.matches.length === 0) return []

      const resourceIds = queryResult.matches
        .map((m) => m.metadata?.resourceId as string)
        .filter(Boolean)

      const indexRecords = await prisma.searchIndex.findMany({
        where: { resourceId: { in: resourceIds }, workspaceId: options.workspaceId },
      })

      const indexMap = new Map(indexRecords.map((r) => [r.resourceId, r]))

      return queryResult.matches
        .map((match, idx) => {
          const resourceId = match.metadata?.resourceId as string
          const record = indexMap.get(resourceId)
          if (!record) return null

          return {
            id: record.id,
            resourceType: record.resourceType,
            resourceId: record.resourceId,
            title: record.title,
            content: record.content,
            summary: record.summary,
            score: match.score,
            rank: idx + 1,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          }
        })
        .filter((r): r is SearchResult => r !== null)
    } catch (err) {
      logger.debug('[vectorSearch] Vector query failed', {
        reason: err instanceof Error ? err.message : 'unknown',
      })
      return []
    }
  }

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
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    if (escaped.length === 0) return result
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
    result = result.replace(regex, '<mark>$1</mark>')
    return result
  }

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
      const chunks = this.chunkContent(content, 1000)

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]

        await prisma.searchIndex.upsert({
          where: {
            id: `${resourceId}-chunk-${i}`,
          },
          create: {
            id: `${resourceId}-chunk-${i}`,
            workspaceId,
            resourceType,
            resourceId,
            content: chunk,
            title: metadata.title,
            summary: metadata.summary,
            keywords: metadata.keywords || [],
            chunkIndex: i,
            totalChunks: chunks.length,
            isIndexed: true,
            indexedAt: new Date(),
          },
          update: {
            content: chunk,
            title: metadata.title,
            summary: metadata.summary,
            keywords: metadata.keywords || [],
            isIndexed: true,
            indexedAt: new Date(),
            lastUpdatedAt: new Date(),
          },
        })
      }

      await this.tryIndexVectors(workspaceId, resourceType, resourceId, chunks, metadata)

      logger.info(`[indexContent] Indexed ${chunks.length} chunks for ${resourceId}`, {
        workspaceId,
      })
    } catch (error) {
      logger.error('[indexContent] Indexing failed', { error })
      throw new ValidationException('Failed to index content')
    }
  }

  private async tryIndexVectors(
    workspaceId: string,
    resourceType: SearchResourceType,
    resourceId: string,
    chunks: string[],
    metadata: { title?: string; summary?: string; keywords?: string[] }
  ): Promise<void> {
    try {
      const { embedBatch } = await import('../embeddings')
      const { upsertVectors } = await import('../vectordb')

      const batchResult = await embedBatch(chunks, { workspaceId })

      const vectors = batchResult.results.map((result, i) => ({
        id: `${resourceId}-chunk-${i}`,
        values: Array.from(result.embedding.values),
        metadata: {
          resourceType,
          resourceId,
          chunkIndex: i,
          title: metadata.title ?? '',
          keywords: (metadata.keywords ?? []).join(','),
        },
      }))

      await upsertVectors(vectors, { workspaceId, namespace: 'search' })

      for (let i = 0; i < chunks.length; i++) {
        await prisma.searchIndex.update({
          where: { id: `${resourceId}-chunk-${i}` },
          data: {
            embeddingId: `${resourceId}-chunk-${i}`,
            embeddingModel: batchResult.results[0]?.model,
            embeddingDimension: batchResult.results[0]?.embedding.dimensions,
          },
        })
      }
    } catch (err) {
      logger.debug('[tryIndexVectors] Embedding/vector indexing unavailable, FTS only', {
        reason: err instanceof Error ? err.name : 'unknown',
      })
    }
  }

  private chunkContent(content: string, chunkSize: number): string[] {
    const chunks: string[] = []
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize))
    }
    return chunks.length === 0 ? [''] : chunks
  }

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

  async createSavedSearch(
    workspaceId: string,
    userId: string,
    name: string,
    query: string,
    options?: {
      description?: string
      queryType?: SearchQueryType
    }
  ): Promise<SavedSearch> {
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

  async getSavedSearches(workspaceId: string, userId: string): Promise<SavedSearch[]> {
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

  async pinSearch(_workspaceId: string, _userId: string, searchId: string): Promise<void> {
    try {
      await prisma.savedSearch.update({
        where: { id: searchId },
        data: {
          isPinned: true,
          pinnedOrder: Math.floor(Date.now() / 1000),
        },
      })
    } catch (error) {
      logger.error('[pinSearch] Failed to pin search', { error })
      throw new ValidationException('Failed to pin search')
    }
  }

  async getSearchAnalytics(workspaceId: string, periodDays = 30): Promise<{
    totalSearches: number
    avgExecutionTime: number
    avgResultCount: number
    topQueries: { term: string; count: number }[]
    periodStart: Date
    periodEnd: Date
  } | null> {
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
    userId?: string
    skip?: number
    take?: number
  }): Promise<{ items: SearchResult[]; total: number }> {
    try {
      const userId = options.userId || ''
      const result = await this.hybridSearch({
        workspaceId: options.workspaceId,
        userId,
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
    userId?: string
    skip?: number
    take?: number
  }): Promise<{ items: SearchResult[]; total: number }> {
    try {
      const userId = options.userId || ''
      const result = await this.hybridSearch({
        workspaceId: options.workspaceId,
        userId,
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
      select: { id: true, title: true, workspaceId: true, description: true },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const searchableContent = [conversation.title, conversation.description].filter(Boolean).join('\n')

    if (searchableContent.length > 0) {
      await this.indexContent(
        conversation.workspaceId,
        'CONVERSATION',
        conversationId,
        searchableContent,
        { title: conversation.title ?? undefined }
      )
    }

    logger.info('[indexConversation] Conversation indexed', { conversationId })
  }

  async indexMessage(messageId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, content: true, conversationId: true, conversation: { select: { workspaceId: true } } },
    })

    if (!message) {
      throw new NotFoundException('Message not found')
    }

    if (message.content && message.content.length > 0) {
      await this.indexContent(
        message.conversation.workspaceId,
        'MESSAGE',
        messageId,
        message.content,
        {}
      )
    }

    logger.info('[indexMessage] Message indexed', { messageId })
  }

  async deleteConversationIndex(conversationId: string): Promise<void> {
    await prisma.searchIndex.deleteMany({
      where: { resourceId: conversationId },
    })

    try {
      const { deleteVectors } = await import('../vectordb')
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { workspaceId: true },
      })
      if (conversation) {
        await deleteVectors({
          workspaceId: conversation.workspaceId,
          namespace: 'search',
          filter: { resourceId: conversationId },
        })
      }
    } catch {
      // Vector DB unavailable — FTS index already deleted
    }

    logger.info('[deleteConversationIndex] Conversation index deleted', { conversationId })
  }

  async searchSuggestions(workspaceId: string, partial: string, limit: number = 10): Promise<string[]> {
    try {
      const queries = await prisma.searchQuery.findMany({
        where: {
          workspaceId,
          query: { contains: partial, mode: 'insensitive' },
        },
        select: { query: true },
        distinct: ['query'],
        take: limit,
        orderBy: { createdAt: 'desc' },
      })

      logger.debug('[searchSuggestions] Found suggestions', { workspaceId, partial, count: queries.length })
      return queries.map(q => q.query)
    } catch (error) {
      logger.error('[searchSuggestions] Failed to get suggestions', { error, workspaceId, partial })
      return []
    }
  }

  async saveSearch(userId: string, workspaceId: string, name: string, query: string): Promise<SavedSearch> {
    try {
      const existing = await prisma.savedSearch.findFirst({
        where: { workspaceId, userId, name },
      })

      if (existing) {
        throw new ValidationException(`Saved search with name "${name}" already exists`)
      }

      const saved = await prisma.savedSearch.create({
        data: { workspaceId, userId, name, query },
      })

      logger.info('[saveSearch] Search saved', { workspaceId, userId, savedSearchId: saved.id, name })
      return saved
    } catch (error) {
      if (error instanceof ValidationException) throw error
      logger.error('[saveSearch] Failed to save search', { error })
      throw new ValidationException('Failed to save search')
    }
  }
}

export const searchService = new SearchService()
