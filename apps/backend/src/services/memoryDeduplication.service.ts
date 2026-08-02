import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { NotFoundException, ValidationException } from '@synora/shared'
import { memoryEmbeddingService } from './memoryEmbedding.service'
import { memoryRetrievalService } from './memoryRetrieval.service'
import { memoryCacheService } from './memoryCache.service'
import { logger } from '../utils/logger'

export interface DuplicateCluster {
  primary: Memory
  duplicates: Array<{ memory: Memory; similarity: number }>
}

export interface DeduplicationConfig {
  semanticThreshold?: number // 0-1, default 0.85
  textThreshold?: number // 0-1 for Levenshtein, default 0.8
  analyzeMetadata?: boolean // include metadata in comparison
  mergeStrategy?: 'primary' | 'newest' | 'highest_importance' // which memory to keep
}

/**
 * Memory Deduplication Service
 * Detects and merges duplicate memories to reduce clutter
 */
export class MemoryDeduplicationService {
  private readonly DEFAULT_SEMANTIC_THRESHOLD = 0.85
  private readonly DEFAULT_TEXT_THRESHOLD = 0.8

  /**
   * Find duplicate clusters in a workspace
   */
  async findDuplicateClusters(
    workspaceId: string,
    config?: DeduplicationConfig,
  ): Promise<DuplicateCluster[]> {
    try {
      logger.info(`Finding duplicate clusters for workspace ${workspaceId}`)

      const memories = await db.memory.findMany({
        where: { workspaceId },
        include: { metadata: true },
      })

      if (memories.length < 2) {
        return []
      }

      const clusters: Map<string, DuplicateCluster> = new Map()
      const processed = new Set<string>()

      for (const memory of memories) {
        if (processed.has(memory.id)) continue

        const duplicates = await this.findDuplicatesForMemory(memory, memories, config)

        if (duplicates.length > 0) {
          clusters.set(memory.id, {
            primary: memory,
            duplicates,
          })

          // Mark all as processed
          processed.add(memory.id)
          duplicates.forEach((d) => processed.add(d.memory.id))
        }
      }

      return Array.from(clusters.values())
    } catch (error) {
      logger.error('Failed to find duplicate clusters', { error, workspaceId })
      throw new ValidationException('Duplicate detection failed')
    }
  }

  /**
   * Find duplicates for a single memory
   */
  private async findDuplicatesForMemory(
    memory: Memory,
    allMemories: Memory[],
    config?: DeduplicationConfig,
  ): Promise<Array<{ memory: Memory; similarity: number }>> {
    const semanticThreshold = config?.semanticThreshold ?? this.DEFAULT_SEMANTIC_THRESHOLD
    const textThreshold = config?.textThreshold ?? this.DEFAULT_TEXT_THRESHOLD

    const duplicates: Array<{ memory: Memory; similarity: number }> = []

    let semanticMatches = new Map<string, number>()
    if (memory.embeddingId) {
      try {
        const similar = await memoryRetrievalService.findSimilarMemories(
          memory.id,
          semanticThreshold,
          allMemories.length,
        )
        semanticMatches = new Map(similar.map((s) => [s.memory.id, s.similarity]))
      } catch {
        // Vector DB unavailable — fall through to text similarity
      }
    }

    for (const candidate of allMemories) {
      if (memory.id === candidate.id) continue

      const semanticSimilarity =
        memory.embeddingId && candidate.embeddingId ? semanticMatches.get(candidate.id) ?? 0 : 0

      // Check text similarity
      const textSimilarity = this.calculateTextSimilarity(memory.content, candidate.content)

      // Check metadata similarity if enabled
      const metadataSimilarity = config?.analyzeMetadata
        ? this.calculateMetadataSimilarity(memory, candidate)
        : 0

      // Combine scores (weighted)
      const combinedScore = semanticSimilarity * 0.4 + textSimilarity * 0.4 + metadataSimilarity * 0.2

      if (
        (semanticSimilarity >= semanticThreshold && memory.embeddingId && candidate.embeddingId) ||
        textSimilarity >= textThreshold
      ) {
        duplicates.push({
          memory: candidate,
          similarity: combinedScore,
        })
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity)
  }

  /**
   * Calculate text similarity using Levenshtein distance
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const distance = this.levenshteinDistance(text1.toLowerCase(), text2.toLowerCase())
    const maxLen = Math.max(text1.length, text2.length)

    if (maxLen === 0) return 1

    // Similarity = 1 - (distance / maxLen)
    return 1 - distance / maxLen
  }

  /**
   * Levenshtein distance algorithm
   * Measures string similarity (lower = more similar)
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = Array.from({ length: b.length + 1 }, (_, i) => [i])

    for (let i = 0; i <= a.length; i++) {
      matrix[0][i] = i
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
          matrix[i - 1][j - 1] + cost, // substitution
        )
      }
    }

    return matrix[b.length][a.length]
  }

  /**
   * Calculate metadata similarity
   */
  private calculateMetadataSimilarity(memory1: Memory, memory2: Memory): number {
    let score = 0
    let factors = 0

    // Category match
    if (memory1.category && memory1.category === memory2.category) {
      score += 0.3
      factors++
    }

    // Type match
    if (memory1.type === memory2.type) {
      score += 0.3
      factors++
    }

    // Tag overlap
    const tags1 = new Set(memory1.tags)
    const tags2 = new Set(memory2.tags)
    const intersection = new Set([...tags1].filter((t) => tags2.has(t)))
    const union = new Set([...tags1, ...tags2])

    if (union.size > 0) {
      const tagSimilarity = intersection.size / union.size
      score += tagSimilarity * 0.4
      factors++
    }

    return factors > 0 ? score / factors : 0
  }

  /**
   * Merge duplicate memories
   */
  async mergeDuplicates(
    primaryId: string,
    duplicateIds: string[],
    config?: DeduplicationConfig,
  ): Promise<Memory> {
    try {
      logger.info(`Merging ${duplicateIds.length} duplicates into ${primaryId}`)

      const primary = await db.memory.findUnique({
        where: { id: primaryId },
        include: { metadata: true },
      })

      if (!primary) {
        throw new NotFoundException('Primary memory not found')
      }

      const duplicates = await db.memory.findMany({
        where: { id: { in: duplicateIds } },
        include: { metadata: true },
      })

      // Select which memory to keep based on strategy
      let merged = primary
      const mergeStrategy = config?.mergeStrategy ?? 'primary'

      if (mergeStrategy === 'newest') {
        const newest = [primary, ...duplicates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
        if (newest.id !== primary.id) {
          merged = newest
        }
      } else if (mergeStrategy === 'highest_importance') {
        const mostImportant = [primary, ...duplicates].sort((a, b) => b.importance - a.importance)[0]
        if (mostImportant.id !== primary.id) {
          merged = mostImportant
        }
      }

      // Merge metadata (metadata is optional, but content/importance always present)
      const primaryMetadata = primary.metadata ? primary.metadata : { content: primary.content }
      const duplicateMetadata = duplicates.map((d) => (d.metadata ? d.metadata : { content: d.content }))

      const mergedMetadata = this.mergeMetadata(primaryMetadata, duplicateMetadata)

      // Combine tags
      const allTags = new Set<string>()
      ;[primary, ...duplicates].forEach((m) => {
        m.tags.forEach((t) => allTags.add(t))
      })

      // Update primary memory
      const updated = await db.memory.update({
        where: { id: merged.id },
        data: {
          importance: typeof mergedMetadata.importance === 'number' ? mergedMetadata.importance : merged.importance,
          tags: Array.from(allTags),
          summary: this.mergeSummaries(
            primary.summary,
            duplicates.map((d) => d.summary).filter(Boolean) as string[],
          ),
          updatedAt: new Date(),
        },
      })

      // Mark duplicates as consolidating (being merged)
      await db.memory.updateMany({
        where: { id: { in: duplicateIds } },
        data: {
          status: 'CONSOLIDATING',
          updatedAt: new Date(),
        },
      })

      // Delete embeddings for merged memories (will be regenerated on access)
      for (const duplicate of duplicates) {
        if (duplicate.embeddingId) {
          await memoryEmbeddingService.deleteEmbedding(duplicate.id)
        }
      }

      // Invalidate cache
      memoryCacheService.invalidateMemory(merged.id)
      duplicates.forEach((d) => memoryCacheService.invalidateMemory(d.id))

      logger.info(`Successfully merged ${duplicateIds.length} duplicates`)
      return updated
    } catch (error) {
      logger.error('Failed to merge duplicates', { error, primaryId, duplicateIds })
      throw error
    }
  }

  /**
   * Automatically deduplicate workspace
   */
  async deduplicateWorkspace(workspaceId: string, config?: DeduplicationConfig): Promise<{
    clustersFound: number
    memoriesMerged: number
    duplicatesRemoved: number
  }> {
    try {
      logger.info(`Starting automatic deduplication for workspace ${workspaceId}`)

      const clusters = await this.findDuplicateClusters(workspaceId, config)

      let memoriesMerged = 0
      let duplicatesRemoved = 0

      for (const cluster of clusters) {
        try {
          const duplicateIds = cluster.duplicates.map((d) => d.memory.id)
          await this.mergeDuplicates(cluster.primary.id, duplicateIds, config)

          memoriesMerged += 1
          duplicatesRemoved += duplicateIds.length
        } catch (error) {
          logger.error('Failed to merge cluster', { error, clusterId: cluster.primary.id })
        }
      }

      logger.info(`Deduplication complete: ${clusters.length} clusters, ${memoriesMerged} merged`)

      return {
        clustersFound: clusters.length,
        memoriesMerged,
        duplicatesRemoved,
      }
    } catch (error) {
      logger.error('Workspace deduplication failed', { error, workspaceId })
      throw error
    }
  }

  /**
   * Check for near-duplicates with user confirmation
   */
  async findPotentialDuplicates(
    memoryId: string,
    threshold: number = 0.8,
  ): Promise<Array<{ memory: Memory; similarity: number }>> {
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
    })

    if (!memory) {
      throw new NotFoundException('Memory not found')
    }

    return memoryRetrievalService.findSimilarMemories(memoryId, threshold)
  }

  /**
   * Get deduplication statistics for workspace
   */
  async getDeduplicationStats(workspaceId: string): Promise<{
    totalMemories: number
    potentialDuplicates: number
    estimatedReduction: number
    consolidatedMemories: number
  }> {
    const [total, consolidated] = await Promise.all([
      db.memory.count({
        where: { workspaceId },
      }),
      db.memory.count({
        where: {
          workspaceId,
          status: 'CONSOLIDATING',
        },
      }),
    ])

    return {
      totalMemories: total,
      potentialDuplicates: 0,
      estimatedReduction: 0,
      consolidatedMemories: consolidated,
    }
  }

  /**
   * Merge metadata objects intelligently
   */
  private mergeMetadata(primary: any, others: any[]): any {
    const merged = { ...primary }

    for (const other of others) {
      // Keep most complete/recent metadata
      if (other.importance && (!merged.importance || other.importance > merged.importance)) {
        merged.importance = other.importance
      }

      if (other.tags && (!merged.tags || other.tags.length > merged.tags.length)) {
        merged.tags = other.tags
      }
    }

    return merged
  }

  /**
   * Merge summaries from multiple memories
   */
  private mergeSummaries(primary: string | null | undefined, others: string[]): string | undefined {
    const allSummaries = [primary, ...others].filter(Boolean) as string[]

    if (allSummaries.length === 0) return undefined

    // Return the longest summary (most comprehensive)
    return allSummaries.reduce((longest, current) => (current.length > longest.length ? current : longest))
  }
}

export const memoryDeduplicationService = new MemoryDeduplicationService()
