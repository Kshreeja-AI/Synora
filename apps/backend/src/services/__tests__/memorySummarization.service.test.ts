import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemorySummarizationService } from '../memorySummarization.service'
import { NotFoundException } from '@synora/shared'

vi.mock('@synora/database', () => ({
  prisma: {
    memory: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}))

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const LONG_CONTENT =
  'The team met on Monday to discuss the quarterly roadmap. ' +
  'Important decisions were made about the launch timeline. ' +
  'The critical path involves three major milestones this quarter. ' +
  'Everyone agreed the deadline of March 15th is achievable. ' +
  'Finally, the team decided to schedule a follow-up meeting next week.'

describe('MemorySummarizationService', () => {
  let service: MemorySummarizationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MemorySummarizationService()
  })

  describe('summarizeMemory', () => {
    it('throws NotFoundException for a missing memory', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue(null)

      await expect(service.summarizeMemory('missing')).rejects.toThrow(NotFoundException)
    })

    it('returns the original content unmodified for short memories, with full confidence', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({
        id: 'm1',
        content: 'Too short to summarize.',
      } as never)

      const result = await service.summarizeMemory('m1')

      expect(result.summary).toBe('Too short to summarize.')
      expect(result.confidence).toBe(1)
    })

    it('produces a real extractive summary shorter than the original for long content', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({ id: 'm1', content: LONG_CONTENT } as never)

      const result = await service.summarizeMemory('m1', { style: 'brief' })

      expect(result.summary.length).toBeLessThan(LONG_CONTENT.length)
      expect(result.summary.length).toBeGreaterThan(0)
    })

    it('never returns a hardcoded confidence like 0.85 — confidence tracks real extraction quality', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({ id: 'm1', content: LONG_CONTENT } as never)

      const brief = await service.summarizeMemory('m1', { style: 'brief' })
      const detailed = await service.summarizeMemory('m1', { style: 'detailed' })

      // A detailed summary keeps more of the original, so it should score at
      // least as confident as a brief one — a fixed constant could never
      // reflect this relationship.
      expect(detailed.confidence).toBeGreaterThanOrEqual(brief.confidence)
      expect(brief.confidence).not.toBe(0.85)
    })

    it('extracts key points only when requested', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({
        id: 'm1',
        content: LONG_CONTENT + ' Important: watch the budget closely.',
      } as never)

      const withoutKeyPoints = await service.summarizeMemory('m1')
      expect(withoutKeyPoints.keyPoints).toEqual([])

      const withKeyPoints = await service.summarizeMemory('m1', { highlightKeyPoints: true })
      expect(withKeyPoints.keyPoints.length).toBeGreaterThan(0)
    })

    it('suggests tags derived from real content keywords, not a fixed list', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique).mockResolvedValue({
        id: 'm1',
        content: LONG_CONTENT,
      } as never)

      const result = await service.summarizeMemory('m1', { extractTags: true })
      expect(result.suggestedTags).toContain('decision')
    })
  })

  describe('summarizeMemoriesBatch', () => {
    it('continues past a failed memory instead of aborting the whole batch', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.findUnique)
        .mockResolvedValueOnce(null) // m1 -> NotFoundException
        .mockResolvedValueOnce({ id: 'm2', content: LONG_CONTENT } as never)

      const results = await service.summarizeMemoriesBatch(['m1', 'm2'])

      expect(results).toHaveLength(1)
      expect(results[0].memoryId).toBe('m2')
    })
  })

  describe('compressSummary', () => {
    it('returns the input unchanged when already within maxLength', () => {
      expect(service.compressSummary('short', 200)).toBe('short')
    })

    it('truncates at a sentence boundary when possible', () => {
      const input = 'First sentence here. Second sentence that pushes past the limit for sure.'
      const result = service.compressSummary(input, 25)
      expect(result.endsWith('...')).toBe(true)
    })
  })

  describe('getSummarizationStats', () => {
    it('computes real counts and average length from actual memory rows', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.count).mockResolvedValueOnce(10).mockResolvedValueOnce(4)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([
        { summary: 'abcde' },
        { summary: 'abcdefghij' },
      ] as never)

      const stats = await service.getSummarizationStats('ws-1')

      expect(stats).toEqual({
        totalMemories: 10,
        summarized: 4,
        avgSummaryLength: 8, // (5 + 10) / 2, rounded
        unsummarized: 6,
      })
    })

    it('reports zero average length when nothing is summarized yet, never a placeholder number', async () => {
      const { prisma } = await import('@synora/database')
      vi.mocked(prisma.memory.count).mockResolvedValueOnce(5).mockResolvedValueOnce(0)
      vi.mocked(prisma.memory.findMany).mockResolvedValue([])

      const stats = await service.getSummarizationStats('ws-1')
      expect(stats.avgSummaryLength).toBe(0)
    })
  })
})
