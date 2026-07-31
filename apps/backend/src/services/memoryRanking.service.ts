import { Memory } from '@synora/database'
import { logger } from '../utils/logger'

export interface RankingSignal {
  semantic: number // 0-1 (similarity to query)
  importance: number // 0-1 (user-defined importance)
  recency: number // 0-1 (how fresh)
  frequency: number // 0-1 (access count)
  relevance: number // 0-1 (match strength)
}

export interface RankingConfig {
  weights?: {
    semantic?: number
    importance?: number
    recency?: number
    frequency?: number
    relevance?: number
  }
  boosts?: {
    pinned?: number // boost for pinned memories
    recent?: number // boost for very recent memories
    manual?: number // boost for manually created
  }
  algorithm?: 'linear' | 'bm25' | 'tfidf' // ranking algorithm
}

/**
 * Memory Ranking Service
 * Specialized ranking algorithms for memory retrieval and relevance scoring
 */
export class MemoryRankingService {
  // Default weights: balanced across all signals
  private defaultWeights = {
    semantic: 0.4,
    importance: 0.25,
    recency: 0.2,
    frequency: 0.1,
    relevance: 0.05,
  }

  // Default boosts
  private defaultBoosts = {
    pinned: 1.3,
    recent: 1.2, // boost for memories created in last 7 days
    manual: 1.15,
  }

  /**
   * Linear weighted ranking (default)
   * Simple weighted sum of all signals
   */
  rankLinear(signals: RankingSignal, config?: RankingConfig): number {
    const weights = { ...this.defaultWeights, ...config?.weights }

    const score =
      signals.semantic * weights.semantic +
      signals.importance * weights.importance +
      signals.recency * weights.recency +
      signals.frequency * weights.frequency +
      signals.relevance * weights.relevance

    return Math.min(1, Math.max(0, score))
  }

  /**
   * BM25 ranking
   * Best Match 25 algorithm popular in IR systems
   * Combines term frequency, inverse document frequency, and document length
   */
  rankBM25(
    signals: RankingSignal,
    config?: RankingConfig,
    params?: {
      k1?: number // term frequency saturation (default: 1.5)
      b?: number // document length normalization (default: 0.75)
      idf?: number // inverse document frequency
    },
  ): number {
    const k1 = params?.k1 ?? 1.5
    const b = params?.b ?? 0.75
    const idf = params?.idf ?? 1.0

    // BM25 combines multiple factors
    // TF component: term frequency with saturation
    const tfComponent = signals.semantic * ((k1 + 1) / (k1 * (1 - b + b) + signals.semantic))

    // Importance as document boost (like a popularity signal)
    const boostComponent = signals.importance * 0.3

    // Recency as freshness component
    const freshnessComponent = signals.recency * 0.2

    // Frequency as engagement signal
    const engagementComponent = signals.frequency * 0.15

    const score = (tfComponent * idf + boostComponent + freshnessComponent + engagementComponent) / 10

    return Math.min(1, Math.max(0, score))
  }

  /**
   * TF-IDF ranking
   * Term Frequency - Inverse Document Frequency
   * Balances term frequency with rarity across corpus
   */
  rankTFIDF(
    signals: RankingSignal,
    config?: RankingConfig,
    params?: {
      tf?: number // term frequency (0-1)
      idf?: number // inverse document frequency (0-1)
      docLength?: number // normalized doc length (0-1)
    },
  ): number {
    const tf = params?.tf ?? signals.relevance
    const idf = params?.idf ?? Math.log(1 + signals.semantic)
    const docLength = params?.docLength ?? 0.8

    // TF-IDF score
    const tfidfScore = tf * idf

    // Augment with importance, recency, frequency
    const importanceBoost = signals.importance * 0.25
    const recencyBoost = signals.recency * 0.15
    const frequencyBoost = signals.frequency * 0.1

    const score = (tfidfScore + importanceBoost + recencyBoost + frequencyBoost) / (1 + idf)

    return Math.min(1, Math.max(0, score))
  }

  /**
   * Multi-factor ranking with dynamic weighting
   * Adapts weights based on memory characteristics
   */
  rankAdaptive(
    memory: Memory,
    signals: RankingSignal,
    config?: RankingConfig,
  ): number {
    // Adjust weights based on memory type and status
    let weights = { ...this.defaultWeights }

    // Pinned memories get higher importance weight
    if (memory.isPinned) {
      weights.importance = Math.min(1, weights.importance * 1.5)
    }

    // Manual memories boost relevance
    if (memory.isManual) {
      weights.relevance = Math.min(1, weights.relevance * 1.5)
    }

    // Recent memories get recency boost
    const ageMs = Date.now() - memory.createdAt.getTime()
    const ageDays = ageMs / (24 * 60 * 60 * 1000)
    if (ageDays < 7) {
      weights.recency = Math.min(1, weights.recency * 1.5)
    }

    // Merge with config weights
    if (config?.weights) {
      weights = { ...weights, ...config.weights }
    }

    // Calculate score
    const score =
      signals.semantic * weights.semantic +
      signals.importance * weights.importance +
      signals.recency * weights.recency +
      signals.frequency * weights.frequency +
      signals.relevance * weights.relevance

    return Math.min(1, Math.max(0, score))
  }

  /**
   * Calculate semantic signal from similarity score
   */
  calculateSemanticSignal(similarityScore: number): number {
    // Normalize: 0-1 range, with minimum threshold of 0.3
    return Math.max(0, Math.min(1, similarityScore))
  }

  /**
   * Calculate importance signal from memory importance value
   */
  calculateImportanceSignal(importance: number): number {
    // Already 0-1, just validate
    return Math.max(0, Math.min(1, importance))
  }

  /**
   * Calculate recency signal (0-1)
   * Exponential decay over 90 days
   */
  calculateRecencySignal(createdAt: Date, decayDays: number = 90): number {
    const now = Date.now()
    const created = createdAt.getTime()
    const ageMs = now - created
    const ageDays = ageMs / (24 * 60 * 60 * 1000)

    // Exponential decay: e^(-age/decay)
    return Math.exp(-ageDays / decayDays)
  }

  /**
   * Calculate frequency signal from access count (0-1)
   * Logarithmic scaling with ceiling at high counts
   */
  calculateFrequencySignal(accessCount: number, maxCount: number = 1000): number {
    if (accessCount <= 0) return 0
    // Logarithmic: log(count + 1) / log(maxCount + 1)
    return Math.log(accessCount + 1) / Math.log(maxCount + 1)
  }

  /**
   * Calculate relevance signal from text similarity
   * Mock: based on keyword overlap
   */
  calculateRelevanceSignal(query: string, memory: Memory): number {
    if (!query || !memory.content) return 0

    const queryTerms = query.toLowerCase().split(/\s+/)
    const contentTerms = memory.content.toLowerCase().split(/\s+/)
    const summaryTerms = (memory.summary || '').toLowerCase().split(/\s+/)
    const allTerms = [...contentTerms, ...summaryTerms]

    const matches = queryTerms.filter((term) => allTerms.some((t) => t.includes(term))).length

    const relevance = matches / Math.max(queryTerms.length, 1)

    return Math.min(1, relevance)
  }

  /**
   * Combine all signals into ranking signals object
   */
  combineSignals(
    memory: Memory,
    query?: string,
    semanticScore?: number,
    config?: RankingConfig,
  ): RankingSignal {
    return {
      semantic: semanticScore ? this.calculateSemanticSignal(semanticScore) : 0,
      importance: this.calculateImportanceSignal(memory.importance),
      recency: this.calculateRecencySignal(memory.createdAt),
      frequency: this.calculateFrequencySignal(memory.accessCount || 0),
      relevance: query ? this.calculateRelevanceSignal(query, memory) : 0,
    }
  }

  /**
   * Apply ranking boosts based on memory properties
   */
  applyBoosts(baseScore: number, memory: Memory, config?: RankingConfig): number {
    const boosts = { ...this.defaultBoosts, ...config?.boosts }

    let finalScore = baseScore

    if (memory.isPinned) {
      finalScore *= boosts.pinned
    }

    // Boost very recent memories (created in last 7 days)
    const ageMs = Date.now() - memory.createdAt.getTime()
    const ageDays = ageMs / (24 * 60 * 60 * 1000)
    if (ageDays < 7) {
      finalScore *= boosts.recent
    }

    if (memory.isManual) {
      finalScore *= boosts.manual
    }

    // Normalize back to 0-1
    return Math.min(1, finalScore)
  }

  /**
   * Diversity ranking - reduce similar results
   * Helps vary retrieval results
   */
  diversifyRanking(
    memories: Array<{ memory: Memory; score: number }>,
    similarityScores: Map<string, Map<string, number>>,
    diversityWeight: number = 0.2,
  ): Array<{ memory: Memory; score: number }> {
    const result: Array<{ memory: Memory; score: number }> = []
    const selected = new Set<string>()

    for (const item of memories) {
      let adjustedScore = item.score

      // Penalize if similar to already-selected memories
      for (const selectedId of selected) {
        const similarity = similarityScores.get(item.memory.id)?.get(selectedId) ?? 0
        if (similarity > 0.8) {
          // Reduce score if too similar to selected memory
          adjustedScore *= 1 - diversityWeight * similarity
        }
      }

      result.push({ memory: item.memory, score: adjustedScore })
      selected.add(item.memory.id)
    }

    // Re-sort after diversity adjustments
    return result.sort((a, b) => b.score - a.score)
  }

  /**
   * Get ranking statistics for a result set
   */
  getStats(
    results: Array<{ memory: Memory; score: number }>,
  ): {
    meanScore: number
    medianScore: number
    stdDev: number
    min: number
    max: number
  } {
    if (results.length === 0) {
      return { meanScore: 0, medianScore: 0, stdDev: 0, min: 0, max: 0 }
    }

    const scores = results.map((r) => r.score).sort((a, b) => a - b)
    const mean = scores.reduce((a, b) => a + b) / scores.length
    const median = scores[Math.floor(scores.length / 2)]

    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length
    const stdDev = Math.sqrt(variance)

    return {
      meanScore: mean,
      medianScore: median,
      stdDev,
      min: scores[0],
      max: scores[scores.length - 1],
    }
  }

  /**
   * Benchmark ranking performance
   */
  benchmark(memories: Memory[], queries: string[], iterations: number = 100): {
    avgTime: number
    minTime: number
    maxTime: number
  } {
    const times: number[] = []

    for (let i = 0; i < iterations; i++) {
      const query = queries[i % queries.length]
      const startTime = performance.now()

      for (const memory of memories) {
        const signals = this.combineSignals(memory, query, 0.5)
        this.rankLinear(signals)
      }

      const endTime = performance.now()
      times.push(endTime - startTime)
    }

    return {
      avgTime: times.reduce((a, b) => a + b) / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
    }
  }
}

export const memoryRankingService = new MemoryRankingService()
