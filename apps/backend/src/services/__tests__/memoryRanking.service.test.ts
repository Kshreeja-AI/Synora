import { describe, it, expect } from 'vitest'
import { MemoryRankingService } from '../memoryRanking.service'
import type { Memory } from '@synora/database'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    workspaceId: 'ws-1',
    conversationId: null,
    userId: 'u1',
    content: 'The quarterly report is due next Friday',
    summary: null,
    type: 'SEMANTIC',
    category: null,
    tags: [],
    importance: 0.5,
    decayRate: 0.01,
    lastAccessedAt: null,
    accessCount: 0,
    isArchived: false,
    isPinned: false,
    isManual: true,
    status: 'ACTIVE',
    permission: 'PRIVATE',
    sharedWith: [],
    version: 1,
    parentId: null,
    embeddingId: null,
    embeddingModel: null,
    embeddingVersion: 0,
    embeddingRefreshNeeded: false,
    isEncrypted: false,
    encryptionKey: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Memory
}

describe('MemoryRankingService', () => {
  const service = new MemoryRankingService()

  describe('calculateRelevanceSignal', () => {
    it('scores full keyword overlap as 1', () => {
      const memory = makeMemory({ content: 'the quarterly report is due' })
      expect(service.calculateRelevanceSignal('quarterly report', memory)).toBe(1)
    })

    it('scores partial overlap proportionally, not a fixed number', () => {
      const memory = makeMemory({ content: 'the quarterly report is due' })
      const score = service.calculateRelevanceSignal('quarterly nonexistent-word', memory)
      expect(score).toBeCloseTo(0.5)
    })

    it('scores zero overlap as 0', () => {
      const memory = makeMemory({ content: 'completely unrelated text' })
      expect(service.calculateRelevanceSignal('quarterly report', memory)).toBe(0)
    })

    it('returns 0 for an empty query', () => {
      const memory = makeMemory()
      expect(service.calculateRelevanceSignal('', memory)).toBe(0)
    })

    it('also matches terms found only in the summary', () => {
      const memory = makeMemory({ content: 'unrelated body', summary: 'mentions quarterly targets' })
      expect(service.calculateRelevanceSignal('quarterly', memory)).toBe(1)
    })
  })

  describe('calculateRecencySignal', () => {
    it('scores a just-created memory near 1', () => {
      expect(service.calculateRecencySignal(new Date())).toBeCloseTo(1, 1)
    })

    it('decays over time — an older memory scores lower than a newer one', () => {
      const oldMemory = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const newMemory = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      expect(service.calculateRecencySignal(oldMemory)).toBeLessThan(service.calculateRecencySignal(newMemory))
    })
  })

  describe('calculateFrequencySignal', () => {
    it('returns 0 for a never-accessed memory', () => {
      expect(service.calculateFrequencySignal(0)).toBe(0)
    })

    it('increases monotonically with access count', () => {
      const low = service.calculateFrequencySignal(5)
      const high = service.calculateFrequencySignal(500)
      expect(high).toBeGreaterThan(low)
    })
  })

  describe('rankLinear', () => {
    it('weights all five signals into a single 0-1 score', () => {
      const score = service.rankLinear({
        semantic: 1,
        importance: 1,
        recency: 1,
        frequency: 1,
        relevance: 1,
      })
      expect(score).toBeCloseTo(1)
    })

    it('scores all-zero signals as 0', () => {
      const score = service.rankLinear({ semantic: 0, importance: 0, recency: 0, frequency: 0, relevance: 0 })
      expect(score).toBe(0)
    })
  })

  describe('applyBoosts', () => {
    it('boosts a pinned memory above its base score', () => {
      const memory = makeMemory({ isPinned: true, createdAt: new Date(2020, 0, 1) })
      const boosted = service.applyBoosts(0.5, memory)
      expect(boosted).toBeGreaterThan(0.5)
    })

    it('never exceeds 1 even with multiple boosts stacked', () => {
      const memory = makeMemory({ isPinned: true, isManual: true, createdAt: new Date() })
      const boosted = service.applyBoosts(0.95, memory)
      expect(boosted).toBeLessThanOrEqual(1)
    })
  })

  describe('combineSignals', () => {
    it('derives every signal from real memory fields, not fixed placeholders', () => {
      const memory = makeMemory({ importance: 0.8, accessCount: 50, createdAt: new Date() })
      const signals = service.combineSignals(memory, 'report', 0.9)

      expect(signals.importance).toBe(0.8)
      expect(signals.semantic).toBe(0.9)
      expect(signals.frequency).toBeGreaterThan(0)
      expect(signals.recency).toBeGreaterThan(0.9)
    })

    it('defaults semantic and relevance to 0 when no query/score is provided', () => {
      const memory = makeMemory()
      const signals = service.combineSignals(memory)
      expect(signals.semantic).toBe(0)
      expect(signals.relevance).toBe(0)
    })
  })

  describe('getStats', () => {
    it('computes real mean/median/stdDev from actual scores', () => {
      const results = [
        { memory: makeMemory({ id: 'a' }), score: 0.2 },
        { memory: makeMemory({ id: 'b' }), score: 0.5 },
        { memory: makeMemory({ id: 'c' }), score: 0.8 },
      ]
      const stats = service.getStats(results)
      expect(stats.meanScore).toBeCloseTo(0.5)
      expect(stats.min).toBe(0.2)
      expect(stats.max).toBe(0.8)
    })

    it('returns all zeros for an empty result set, never a fabricated default', () => {
      const stats = service.getStats([])
      expect(stats).toEqual({ meanScore: 0, medianScore: 0, stdDev: 0, min: 0, max: 0 })
    })
  })
})
