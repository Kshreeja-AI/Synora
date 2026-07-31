import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { logger } from '../utils/logger'

export interface MemoryAnalytics {
  workspaceId: string
  period: {
    from: Date
    to: Date
  }
  overview: {
    totalMemories: number
    activeMemories: number
    archivedMemories: number
    consolidatedMemories: number
    deletedMemories: number
  }
  creation: {
    createdThisPeriod: number
    creationRate: number // per day
    topCreationDays: Array<{ date: string; count: number }>
  }
  retrieval: {
    totalRetrievals: number
    avgAccessCount: number
    mostRetrieved: Memory[]
    leastRetrieved: Memory[]
    retrievalTrend: Array<{ date: string; count: number }>
  }
  importance: {
    avgImportance: number
    highImportance: number // count > 0.7
    mediumImportance: number // 0.4-0.7
    lowImportance: number // < 0.4
    importanceDistribution: Array<{ range: string; count: number }>
  }
  categories: {
    topCategories: Array<{ category: string; count: number }>
    typesDistribution: Array<{ type: string; count: number }>
  }
  permissions: {
    privateMemories: number
    workspaceMemories: number
    sharedMemories: number
    publicMemories: number
  }
  embeddings: {
    indexed: number
    needsRefresh: number
    refreshRate: number
  }
  decay: {
    decayingMemories: number
    avgDecayRate: number
  }
}

/**
 * Memory Analytics Service
 * Tracks memory system usage, patterns, and provides insights
 */
export class MemoryAnalyticsService {
  /**
   * Get comprehensive analytics for workspace
   */
  async getWorkspaceAnalytics(
    workspaceId: string,
    from?: Date,
    to?: Date,
  ): Promise<MemoryAnalytics> {
    const toDate = to || new Date()
    const fromDate = from || new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000) // last 30 days

    try {
      logger.info(`Fetching analytics for workspace ${workspaceId}`, { from: fromDate, to: toDate })

      const [
        overview,
        creation,
        retrieval,
        importance,
        categories,
        permissions,
        embeddings,
        decay,
      ] = await Promise.all([
        this.getOverviewStats(workspaceId),
        this.getCreationStats(workspaceId, fromDate, toDate),
        this.getRetrievalStats(workspaceId, fromDate, toDate),
        this.getImportanceStats(workspaceId),
        this.getCategoryStats(workspaceId),
        this.getPermissionStats(workspaceId),
        this.getEmbeddingStats(workspaceId),
        this.getDecayStats(workspaceId),
      ])

      return {
        workspaceId,
        period: { from: fromDate, to: toDate },
        overview,
        creation,
        retrieval,
        importance,
        categories,
        permissions,
        embeddings,
        decay,
      }
    } catch (error) {
      logger.error('Failed to get workspace analytics', { error, workspaceId })
      throw error
    }
  }

  /**
   * Get overview statistics
   */
  private async getOverviewStats(workspaceId: string): Promise<MemoryAnalytics['overview']> {
    const [total, active, archived, consolidated, deleted] = await Promise.all([
      db.memory.count({ where: { workspaceId } }),
      db.memory.count({ where: { workspaceId, status: 'ACTIVE' } }),
      db.memory.count({ where: { workspaceId, isArchived: true } }),
      db.memory.count({ where: { workspaceId, status: 'CONSOLIDATING' } }),
      db.memory.count({ where: { workspaceId, status: 'DELETED' } }),
    ])

    return {
      totalMemories: total,
      activeMemories: active,
      archivedMemories: archived,
      consolidatedMemories: consolidated,
      deletedMemories: deleted,
    }
  }

  /**
   * Get creation statistics
   */
  private async getCreationStats(workspaceId: string, from: Date, to: Date): Promise<MemoryAnalytics['creation']> {
    const created = await db.memory.findMany({
      where: {
        workspaceId,
        createdAt: { gte: from, lte: to },
      },
      select: { createdAt: true },
    })

    const createdCount = created.length
    const periodDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)
    const creationRate = createdCount / Math.max(periodDays, 1)

    // Top creation days
    const dayMap = new Map<string, number>()
    created.forEach((m) => {
      const day = m.createdAt.toISOString().split('T')[0]
      dayMap.set(day, (dayMap.get(day) || 0) + 1)
    })

    const topCreationDays = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7)

    return {
      createdThisPeriod: createdCount,
      creationRate,
      topCreationDays,
    }
  }

  /**
   * Get retrieval statistics
   */
  private async getRetrievalStats(workspaceId: string, from: Date, to: Date): Promise<MemoryAnalytics['retrieval']> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: { id: true, accessCount: true, lastAccessedAt: true },
      orderBy: { accessCount: 'desc' },
    })

    const totalRetrievals = memories.reduce((sum, m) => sum + (m.accessCount || 0), 0)
    const avgAccessCount = memories.length > 0 ? totalRetrievals / memories.length : 0

    const mostRetrieved = await db.memory.findMany({
      where: { workspaceId },
      orderBy: { accessCount: 'desc' },
      take: 5,
    })

    const leastRetrieved = await db.memory.findMany({
      where: { workspaceId },
      orderBy: { accessCount: 'asc' },
      take: 5,
    })

    // Retrieval trend
    const trendMap = new Map<string, number>()
    memories
      .filter((m) => m.lastAccessedAt && m.lastAccessedAt >= from && m.lastAccessedAt <= to)
      .forEach((m) => {
        if (m.lastAccessedAt) {
          const day = m.lastAccessedAt.toISOString().split('T')[0]
          trendMap.set(day, (trendMap.get(day) || 0) + 1)
        }
      })

    const retrievalTrend = Array.from(trendMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      totalRetrievals,
      avgAccessCount,
      mostRetrieved,
      leastRetrieved,
      retrievalTrend,
    }
  }

  /**
   * Get importance statistics
   */
  private async getImportanceStats(workspaceId: string): Promise<MemoryAnalytics['importance']> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: { importance: true },
    })

    const avgImportance = memories.length > 0 ? memories.reduce((sum, m) => sum + m.importance, 0) / memories.length : 0

    const high = memories.filter((m) => m.importance > 0.7).length
    const medium = memories.filter((m) => m.importance >= 0.4 && m.importance <= 0.7).length
    const low = memories.filter((m) => m.importance < 0.4).length

    // Distribution buckets
    const buckets: Record<string, number> = {
      '0.0-0.2': 0,
      '0.2-0.4': 0,
      '0.4-0.6': 0,
      '0.6-0.8': 0,
      '0.8-1.0': 0,
    }

    memories.forEach((m) => {
      if (m.importance <= 0.2) buckets['0.0-0.2']++
      else if (m.importance <= 0.4) buckets['0.2-0.4']++
      else if (m.importance <= 0.6) buckets['0.4-0.6']++
      else if (m.importance <= 0.8) buckets['0.6-0.8']++
      else buckets['0.8-1.0']++
    })

    return {
      avgImportance,
      highImportance: high,
      mediumImportance: medium,
      lowImportance: low,
      importanceDistribution: Object.entries(buckets).map(([range, count]) => ({ range, count })),
    }
  }

  /**
   * Get category statistics
   */
  private async getCategoryStats(workspaceId: string): Promise<MemoryAnalytics['categories']> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: { type: true, category: true },
    })

    // Top categories
    const categoryMap = new Map<string, number>()
    memories.forEach((m) => {
      if (m.category) {
        categoryMap.set(m.category, (categoryMap.get(m.category) || 0) + 1)
      }
    })

    const topCategories = Array.from(categoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Type distribution
    const typeMap = new Map<string, number>()
    memories.forEach((m) => {
      typeMap.set(m.type, (typeMap.get(m.type) || 0) + 1)
    })

    const typesDistribution = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    return {
      topCategories,
      typesDistribution,
    }
  }

  /**
   * Get permission statistics
   */
  private async getPermissionStats(workspaceId: string): Promise<MemoryAnalytics['permissions']> {
    const [priv, workspace, shared, pub] = await Promise.all([
      db.memory.count({ where: { workspaceId, permission: 'PRIVATE' } }),
      db.memory.count({ where: { workspaceId, permission: 'WORKSPACE' } }),
      db.memory.count({ where: { workspaceId, permission: 'SHARED' } }),
      db.memory.count({ where: { workspaceId, permission: 'PUBLIC' } }),
    ])

    return {
      privateMemories: priv,
      workspaceMemories: workspace,
      sharedMemories: shared,
      publicMemories: pub,
    }
  }

  /**
   * Get embedding statistics
   */
  private async getEmbeddingStats(workspaceId: string): Promise<MemoryAnalytics['embeddings']> {
    const [indexed, needsRefresh, total] = await Promise.all([
      db.memory.count({ where: { workspaceId, embeddingId: { not: null } } }),
      db.memory.count({ where: { workspaceId, embeddingRefreshNeeded: true } } ),
      db.memory.count({ where: { workspaceId } }),
    ])

    const refreshRate = total > 0 ? needsRefresh / total : 0

    return {
      indexed,
      needsRefresh,
      refreshRate,
    }
  }

  /**
   * Get decay statistics
   */
  private async getDecayStats(workspaceId: string): Promise<MemoryAnalytics['decay']> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: { importance: true, status: true },
    })

    const decayingCount = memories.filter((m) => m.status === 'DECAYING').length
    const avgDecayRate = memories.length > 0 ? (decayingCount / memories.length) * 100 : 0

    return {
      decayingMemories: decayingCount,
      avgDecayRate,
    }
  }

  /**
   * Get per-user analytics
   */
  async getUserAnalytics(
    workspaceId: string,
    userId: string,
  ): Promise<{
    memoryCount: number
    totalRetrievals: number
    avgImportance: number
    topCategories: string[]
  }> {
    const memories = await db.memory.findMany({
      where: { workspaceId, userId },
      select: { importance: true, accessCount: true, category: true },
    })

    const avgImportance = memories.length > 0 ? memories.reduce((sum, m) => sum + m.importance, 0) / memories.length : 0
    const totalRetrievals = memories.reduce((sum, m) => sum + (m.accessCount || 0), 0)

    const categoryMap = new Map<string, number>()
    memories.forEach((m) => {
      if (m.category) {
        categoryMap.set(m.category, (categoryMap.get(m.category) || 0) + 1)
      }
    })

    const topCategories = Array.from(categoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => cat)

    return {
      memoryCount: memories.length,
      totalRetrievals,
      avgImportance,
      topCategories,
    }
  }

  /**
   * Get trend analysis
   */
  async getTrendAnalysis(
    workspaceId: string,
    days: number = 30,
  ): Promise<{
    creationTrend: Array<{ date: string; count: number }>
    accessTrend: Array<{ date: string; count: number }>
    importanceTrend: Array<{ date: string; avgImportance: number }>
  }> {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const memories = await db.memory.findMany({
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
      },
      select: { createdAt: true, importance: true, lastAccessedAt: true },
    })

    // Creation trend
    const creationMap = new Map<string, number>()
    memories.forEach((m) => {
      const day = m.createdAt.toISOString().split('T')[0]
      creationMap.set(day, (creationMap.get(day) || 0) + 1)
    })

    const creationTrend = Array.from(creationMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Access trend
    const accessMap = new Map<string, number>()
    memories.forEach((m) => {
      if (m.lastAccessedAt && m.lastAccessedAt >= fromDate) {
        const day = m.lastAccessedAt.toISOString().split('T')[0]
        accessMap.set(day, (accessMap.get(day) || 0) + 1)
      }
    })

    const accessTrend = Array.from(accessMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Importance trend
    const importanceMap = new Map<string, { sum: number; count: number }>()
    memories.forEach((m) => {
      const day = m.createdAt.toISOString().split('T')[0]
      const current = importanceMap.get(day) || { sum: 0, count: 0 }
      importanceMap.set(day, {
        sum: current.sum + m.importance,
        count: current.count + 1,
      })
    })

    const importanceTrend = Array.from(importanceMap.entries())
      .map(([date, stats]) => ({
        date,
        avgImportance: stats.count > 0 ? stats.sum / stats.count : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return { creationTrend, accessTrend, importanceTrend }
  }
}

export const memoryAnalyticsService = new MemoryAnalyticsService()
