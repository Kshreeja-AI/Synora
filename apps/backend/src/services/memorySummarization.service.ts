import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { ValidationException, NotFoundException } from '@synora/shared'
import { logger } from '../utils/logger'

export interface SummarizationConfig {
  maxLength?: number // max summary length (characters)
  style?: 'brief' | 'detailed' | 'bullet-points'
  highlightKeyPoints?: boolean
  extractTags?: boolean
}

export interface SummarizationResult {
  memoryId: string
  original: string
  summary: string
  keyPoints: string[]
  suggestedTags: string[]
  confidence: number // 0-1
}

/**
 * Memory Summarization Service
 * Generates summaries of memory content using AI abstraction
 * Can also extract key points and suggest tags
 */
export class MemorySummarizationService {
  private readonly DEFAULT_MAX_LENGTH = 500
  private readonly MIN_CONTENT_LENGTH = 100 // don't summarize very short content

  /**
   * Summarize a single memory
   */
  async summarizeMemory(memoryId: string, config?: SummarizationConfig): Promise<SummarizationResult> {
    try {
      const memory = await db.memory.findUnique({
        where: { id: memoryId },
      })

      if (!memory) {
        throw new NotFoundException('Memory not found')
      }

      // Skip summarization for short content
      if (memory.content.length < this.MIN_CONTENT_LENGTH) {
        return {
          memoryId,
          original: memory.content,
          summary: memory.content,
          keyPoints: [],
          suggestedTags: [],
          confidence: 1,
        }
      }

      return this.generateSummary(memory, config)
    } catch (error) {
      logger.error('Failed to summarize memory', { error, memoryId })
      throw error
    }
  }

  /**
   * Summarize multiple memories (batch)
   */
  async summarizeMemoriesBatch(
    memoryIds: string[],
    config?: SummarizationConfig,
  ): Promise<SummarizationResult[]> {
    const results: SummarizationResult[] = []

    for (const id of memoryIds) {
      try {
        const result = await this.summarizeMemory(id, config)
        results.push(result)
      } catch (error) {
        logger.warn('Failed to summarize memory in batch', { error, memoryId: id })
      }
    }

    return results
  }

  /**
   * Generate summary via extractive sentence selection (see
   * extractiveSummarize below) — no AI provider call, no network I/O.
   */
  private async generateSummary(memory: Memory, config?: SummarizationConfig): Promise<SummarizationResult> {
    const maxLength = config?.maxLength ?? this.DEFAULT_MAX_LENGTH
    const style = config?.style ?? 'brief'

    try {
      const summary = await this.extractiveSummarize(memory.content, maxLength, style)
      const keyPoints = config?.highlightKeyPoints ? this.extractKeyPoints(memory.content) : []
      const suggestedTags = config?.extractTags ? this.suggestTags(memory.content) : []

      const confidence = this.computeExtractionConfidence(memory.content, summary)

      return {
        memoryId: memory.id,
        original: memory.content,
        summary,
        keyPoints,
        suggestedTags,
        confidence,
      }
    } catch (error) {
      logger.error('Failed to generate summary', { error, memoryId: memory.id })
      throw new ValidationException('Summary generation failed')
    }
  }

  private computeExtractionConfidence(original: string, summary: string): number {
    if (!original || !summary) return 0

    const ratio = summary.length / original.length
    if (ratio >= 1) return 1

    const originalSentences = original.split(/[.!?]+/).filter((s) => s.trim().length > 0)
    const summarySentences = summary.split(/[.!?]+/).filter((s) => s.trim().length > 0)
    const coverage = originalSentences.length > 0 ? summarySentences.length / originalSentences.length : 0

    const truncated = summary.endsWith('...') ? 0.9 : 1.0

    const confidence = Math.min(1, (ratio * 0.3 + coverage * 0.5 + truncated * 0.2))
    return Math.round(confidence * 100) / 100
  }

  /**
   * Extractive summarization (sentence selection)
   * Selects most important sentences from content
   */
  private async extractiveSummarize(content: string, maxLength: number, style: string): Promise<string> {
    const sentences = content.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0)

    if (sentences.length <= 1) {
      return content.substring(0, maxLength)
    }

    // Score sentences by importance
    const scored = sentences.map((sentence, index) => {
      let score = 0

      // Position boost (first and last sentences more important)
      if (index === 0) score += 2
      if (index === sentences.length - 1) score += 1.5

      // Length boost (medium-length sentences usually more informative)
      const words = sentence.split(/\s+/).length
      if (words >= 5 && words <= 30) score += 1

      // Keyword boost (important words)
      const importantWords = ['key', 'important', 'critical', 'essential', 'main', 'primary', 'main', 'significant']
      importantWords.forEach((word) => {
        if (sentence.toLowerCase().includes(word)) score += 1
      })

      // Number/data boost
      if (/\d+/.test(sentence)) score += 0.5

      return { sentence, score, index }
    })

    // Select top sentences
    let selected: typeof scored = []

    if (style === 'brief') {
      selected = scored.sort((a, b) => b.score - a.score).slice(0, Math.ceil(sentences.length * 0.3))
    } else if (style === 'detailed') {
      selected = scored.sort((a, b) => b.score - a.score).slice(0, Math.ceil(sentences.length * 0.6))
    } else {
      // bullet-points style
      selected = scored.sort((a, b) => b.score - a.score).slice(0, Math.ceil(sentences.length * 0.4))
    }

    // Restore original order
    selected.sort((a, b) => a.index - b.index)

    let summary = selected.map((s) => s.sentence).join('. ') + '.'

    // Trim to max length
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength).trim() + '...'
    }

    return summary
  }

  /**
   * Extract key points from content
   */
  private extractKeyPoints(content: string): string[] {
    const sentences = content.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0)

    const keyPoints: string[] = []
    const keywordPatterns = [
      /^(first|second|third|fourth|finally)[:\s]/i,
      /^(important|key|critical|essential)[:\s]/i,
      /^(because|therefore|thus|consequently)[:\s]/i,
      /^(for example|such as|like)[:\s]/i,
    ]

    sentences.slice(0, 10).forEach((sentence) => {
      // Check if sentence starts with key phrase
      if (keywordPatterns.some((pattern) => pattern.test(sentence))) {
        keyPoints.push(sentence.substring(0, 150))
      }

      // Or if it's a question-answer pattern
      if (sentence.includes('?') && keyPoints.length < 5) {
        keyPoints.push(sentence.substring(0, 150))
      }
    })

    return keyPoints.slice(0, 5)
  }

  /**
   * Suggest tags from content
   */
  private suggestTags(content: string): string[] {
    const tags = new Set<string>()
    const text = content.toLowerCase()

    // Common tag patterns
    const tagPatterns: Record<string, RegExp> = {
      'project-update': /project|sprint|deadline|launch/,
      'research': /research|study|analysis|findings/,
      'meeting': /meeting|discussed|agreed|decided/,
      'learning': /learned|discovered|realized|understood/,
      'workflow': /process|workflow|steps|procedure/,
      'decision': /decided|chose|selected|determined/,
      'problem-solving': /problem|issue|challenge|solution/,
      'documentation': /documented|noted|recorded|written/,
    }

    Object.entries(tagPatterns).forEach(([tag, pattern]) => {
      if (pattern.test(text)) {
        tags.add(tag)
      }
    })

    return Array.from(tags).slice(0, 5)
  }

  /**
   * Update memory with generated summary
   */
  async updateMemorySummary(memoryId: string, config?: SummarizationConfig): Promise<Memory> {
    try {
      const result = await this.summarizeMemory(memoryId, config)

      const updated = await db.memory.update({
        where: { id: memoryId },
        data: {
          summary: result.summary,
          tags: [...new Set([...result.suggestedTags])], // merge with existing tags
          updatedAt: new Date(),
        },
      })

      logger.info(`Summary updated for memory ${memoryId}`, { summaryLength: result.summary.length })

      return updated
    } catch (error) {
      logger.error('Failed to update memory summary', { error, memoryId })
      throw error
    }
  }

  /**
   * Batch update summaries for workspace
   */
  async updateWorkspaceSummaries(
    workspaceId: string,
    config?: SummarizationConfig,
  ): Promise<{ updated: number; failed: number; totalTime: number }> {
    try {
      logger.info(`Starting batch summary update for workspace ${workspaceId}`)

      const startTime = performance.now()

      // Find memories without summaries or with old summaries
      const memories = await db.memory.findMany({
        where: {
          workspaceId,
          OR: [
            { summary: null },
            { summary: '' },
            // Optionally: update summaries older than 30 days
          ],
        },
        take: 100, // limit per batch
      })

      let updated = 0
      let failed = 0

      for (const memory of memories) {
        try {
          await this.updateMemorySummary(memory.id, config)
          updated++
        } catch (error) {
          logger.warn('Failed to update summary', { error, memoryId: memory.id })
          failed++
        }
      }

      const endTime = performance.now()
      const totalTime = endTime - startTime

      logger.info(`Summary update complete: ${updated} updated, ${failed} failed in ${totalTime.toFixed(0)}ms`)

      return { updated, failed, totalTime }
    } catch (error) {
      logger.error('Batch summary update failed', { error, workspaceId })
      throw error
    }
  }

  /**
   * Compress summary (for display in limited space)
   */
  compressSummary(summary: string, maxLength: number = 200): string {
    if (summary.length <= maxLength) {
      return summary
    }

    // Try to break at sentence boundary
    let truncated = summary.substring(0, maxLength)
    const lastPeriod = truncated.lastIndexOf('.')
    const lastComma = truncated.lastIndexOf(',')

    if (lastPeriod > maxLength * 0.7) {
      truncated = summary.substring(0, lastPeriod + 1)
    } else if (lastComma > maxLength * 0.7) {
      truncated = summary.substring(0, lastComma)
    }

    return truncated + '...'
  }

  /**
   * Get summarization statistics
   */
  async getSummarizationStats(workspaceId: string): Promise<{
    totalMemories: number
    summarized: number
    avgSummaryLength: number
    unsummarized: number
  }> {
    const total = await db.memory.count({ where: { workspaceId } })
    const summarized = await db.memory.count({
      where: {
        workspaceId,
        summary: { not: null },
      },
    })

    const summaries = await db.memory.findMany({
      where: {
        workspaceId,
        summary: { not: null },
      },
      select: { summary: true },
    })

    const avgLength = summaries.length > 0 ? summaries.reduce((sum, m) => sum + (m.summary?.length || 0), 0) / summaries.length : 0

    return {
      totalMemories: total,
      summarized,
      avgSummaryLength: Math.round(avgLength),
      unsummarized: total - summarized,
    }
  }
}

export const memorySummarizationService = new MemorySummarizationService()
