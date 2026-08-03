import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma as db } from '@synora/database'
import { MemoryStatus, MemoryType } from '@synora/database'
import { memoryAnalyticsService } from '../memoryAnalytics.service'
import { memoryService } from '../memory.service'

describe('MemoryAnalyticsService', () => {
  let userId: string
  let workspaceId: string
  let otherWorkspaceId: string

  beforeEach(async () => {
    const user = await db.user.create({
      data: { email: `analytics-${Date.now()}@example.com`, name: 'Analytics User' },
    })
    userId = user.id

    const workspace = await db.workspace.create({
      data: {
        name: 'Analytics Workspace',
        slug: `analytics-${Date.now()}`,
        members: { create: { userId, role: 'OWNER' } },
      },
    })
    workspaceId = workspace.id

    const other = await db.workspace.create({
      data: { name: 'Other Workspace', slug: `other-${Date.now()}` },
    })
    otherWorkspaceId = other.id

    await db.memory.createMany({
      data: [
        {
          workspaceId,
          userId,
          type: MemoryType.SEMANTIC,
          status: MemoryStatus.ACTIVE,
          content: 'high importance active memory',
          importance: 0.9,
          accessCount: 12,
          category: 'work',
        },
        {
          workspaceId,
          userId,
          type: MemoryType.SEMANTIC,
          status: MemoryStatus.ACTIVE,
          content: 'low importance active memory',
          importance: 0.2,
          accessCount: 3,
          category: 'work',
        },
        // Archiving is recorded on `isArchived`, not via MemoryStatus —
        // that is what consolidation and the decay worker actually write.
        {
          workspaceId,
          userId,
          type: MemoryType.EPISODIC,
          status: MemoryStatus.ACTIVE,
          isArchived: true,
          content: 'archived memory',
          importance: 0.5,
          accessCount: 0,
          category: 'personal',
        },
        // Belongs to a different workspace — must never appear in results.
        {
          workspaceId: otherWorkspaceId,
          userId,
          type: MemoryType.SEMANTIC,
          status: MemoryStatus.ACTIVE,
          content: 'other workspace memory',
          importance: 1,
          accessCount: 99,
          category: 'work',
        },
      ],
    })
  })

  afterEach(async () => {
    await db.memory.deleteMany({})
    await db.workspaceMember.deleteMany({})
    await db.workspace.deleteMany({})
    await db.user.deleteMany({})
  })

  describe('getWorkspaceAnalytics', () => {
    it('counts only memories belonging to the requested workspace', async () => {
      const analytics = await memoryAnalyticsService.getWorkspaceAnalytics(workspaceId)

      expect(analytics.workspaceId).toBe(workspaceId)
      expect(analytics.overview.totalMemories).toBe(3)
      expect(analytics.overview.activeMemories).toBe(3)
      expect(analytics.overview.archivedMemories).toBe(1)
    })

    it('agrees with the headline counters that /memories/stats serves', async () => {
      // These two readers disagreed: this one counted `isArchived`, the other
      // counted a MemoryStatus no writer ever sets, so stats always said 0.
      const [analytics, stats] = await Promise.all([
        memoryAnalyticsService.getWorkspaceAnalytics(workspaceId),
        memoryService.getWorkspaceStats(workspaceId),
      ])

      expect(stats.totalMemories).toBe(analytics.overview.totalMemories)
      expect(stats.archivedMemories).toBe(analytics.overview.archivedMemories)
      expect(stats.archivedMemories).toBe(1)
    })

    it('buckets memories by importance band', async () => {
      const analytics = await memoryAnalyticsService.getWorkspaceAnalytics(workspaceId)

      expect(analytics.importance.highImportance).toBe(1)
      expect(analytics.importance.lowImportance).toBe(1)
    })

    it('defaults to a trailing 30-day window when no range is given', async () => {
      const analytics = await memoryAnalyticsService.getWorkspaceAnalytics(workspaceId)

      const spanMs = analytics.period.to.getTime() - analytics.period.from.getTime()
      expect(Math.round(spanMs / (24 * 60 * 60 * 1000))).toBe(30)
    })

    it('honors an explicit date range', async () => {
      const from = new Date('2026-01-01T00:00:00Z')
      const to = new Date('2026-02-01T00:00:00Z')

      const analytics = await memoryAnalyticsService.getWorkspaceAnalytics(workspaceId, from, to)

      expect(analytics.period.from).toEqual(from)
      expect(analytics.period.to).toEqual(to)
      // The window predates every fixture, so nothing was created in it.
      expect(analytics.creation.createdThisPeriod).toBe(0)
    })
  })

  describe('getUserAnalytics', () => {
    it('scopes retrieval totals to one user within one workspace', async () => {
      const analytics = await memoryAnalyticsService.getUserAnalytics(workspaceId, userId)

      expect(analytics.memoryCount).toBe(3)
      // 12 + 3 + 0 — the 99 from the other workspace must be excluded.
      expect(analytics.totalRetrievals).toBe(15)
      expect(analytics.topCategories).toContain('work')
    })

    it('returns zeroed counters for a user with no memories', async () => {
      const stranger = await db.user.create({
        data: { email: `stranger-${Date.now()}@example.com` },
      })

      const analytics = await memoryAnalyticsService.getUserAnalytics(workspaceId, stranger.id)

      expect(analytics.memoryCount).toBe(0)
      expect(analytics.totalRetrievals).toBe(0)
      expect(analytics.avgImportance).toBe(0)
    })
  })

  describe('getTrendAnalysis', () => {
    it('returns day-bucketed series for the requested window', async () => {
      const trends = await memoryAnalyticsService.getTrendAnalysis(workspaceId, 7)

      expect(Array.isArray(trends.creationTrend)).toBe(true)
      expect(Array.isArray(trends.accessTrend)).toBe(true)
      expect(Array.isArray(trends.importanceTrend)).toBe(true)

      const created = trends.creationTrend.reduce((sum, day) => sum + day.count, 0)
      expect(created).toBe(3)
    })
  })
})
