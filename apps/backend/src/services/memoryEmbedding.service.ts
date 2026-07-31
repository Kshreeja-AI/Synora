import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { ValidationException, NotFoundException } from '@synora/shared'
import { logger } from '../utils/logger'

/**
 * Abstract interface for vector database providers
 */
export interface IVectorDB {
  upsert(id: string, embedding: number[], metadata: Record<string, any>): Promise<void>
  delete(id: string): Promise<void>
  query(embedding: number[], topK: number, namespace?: string): Promise<Array<{ id: string; score: number }>>
}

/**
 * Mock Pinecone implementation
 */
class MockPinecone implements IVectorDB {
  private store: Map<string, { embedding: number[]; metadata: Record<string, any> }> = new Map()

  async upsert(id: string, embedding: number[], metadata: Record<string, any>): Promise<void> {
    this.store.set(id, { embedding, metadata })
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id)
  }

  async query(embedding: number[], topK: number, _namespace?: string): Promise<Array<{ id: string; score: number }>> {
    const results: Array<{ id: string; score: number }> = []

    for (const [id, { embedding: stored }] of this.store) {
      const similarity = this.cosineSimilarity(embedding, stored)
      results.push({ id, score: similarity })
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
    return dotProduct / (magnitudeA * magnitudeB)
  }
}

/**
 * Mock embedding model (OpenAI-compatible)
 */
class MockEmbeddings {
  async embed(text: string): Promise<number[]> {
    // Mock embedding: hash text into 1536-dim vector
    const hash = this.hashString(text)
    const embedding: number[] = []

    for (let i = 0; i < 1536; i++) {
      embedding.push(Math.sin((hash + i) * 0.1) * 0.5 + 0.5)
    }

    return embedding
  }

  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }
}

export class MemoryEmbeddingService {
  private vectorDB: IVectorDB = new MockPinecone()
  private embeddings = new MockEmbeddings()

  /**
   * Generate embedding for memory content
   */
  async generateEmbedding(content: string, model: string = 'text-embedding-3-small'): Promise<number[]> {
    try {
      const embedding = await this.embeddings.embed(content)
      return embedding
    } catch (error) {
      logger.error('Failed to generate embedding', { error, model })
      throw new ValidationException('Failed to generate embedding')
    }
  }

  /**
   * Index memory in vector DB
   */
  async indexMemory(memory: Memory): Promise<void> {
    try {
      // Generate embedding
      const embedding = await this.generateEmbedding(memory.content)

      // Store embedding ID
      const embeddingId = `memory_${memory.id}`

      // Upsert to vector DB
      await this.vectorDB.upsert(embeddingId, embedding, {
        memoryId: memory.id,
        workspaceId: memory.workspaceId,
        conversationId: memory.conversationId,
        userId: memory.userId,
        type: memory.type,
        category: memory.category,
        importance: memory.importance,
        createdAt: memory.createdAt,
      })

      // Update memory metadata
      await db.memory.update({
        where: { id: memory.id },
        data: {
          embeddingId,
          embeddingModel: 'text-embedding-3-small',
          embeddingVersion: 1,
          embeddingRefreshNeeded: false,
        },
      })

      logger.debug(`Memory indexed: ${memory.id}`)
    } catch (error) {
      logger.error('Failed to index memory', { error, memoryId: memory.id })
      throw error
    }
  }

  /**
   * Regenerate embedding for memory
   */
  async regenerateEmbedding(memoryId: string): Promise<void> {
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
    })

    if (!memory) {
      throw new NotFoundException('Memory not found')
    }

    // Delete old embedding
    if (memory.embeddingId) {
      await this.vectorDB.delete(memory.embeddingId)
    }

    // Generate and index new embedding
    await this.indexMemory(memory)

    // Mark as refreshed
    await db.memory.update({
      where: { id: memoryId },
      data: {
        embeddingRefreshNeeded: false,
        embeddingVersion: (memory.embeddingVersion || 0) + 1,
      },
    })

    logger.info(`Embedding regenerated: ${memoryId}`)
  }

  /**
   * Semantic search across memories
   */
  async semanticSearch(
    query: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<Array<{ memoryId: string; memory: Memory; score: number }>> {
    try {
      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query)

      // Search vector DB
      const results = await this.vectorDB.query(queryEmbedding, limit, workspaceId)

      // Fetch full memory records
      const memories = await db.memory.findMany({
        where: {
          id: { in: results.map((r) => r.id.replace('memory_', '')) },
          workspaceId,
        },
        include: { metadata: true },
      })

      // Merge results with scores
      const resultMap = new Map(results.map((r) => [r.id.replace('memory_', ''), r.score]))

      const merged = memories
        .map((memory) => ({
          memoryId: memory.id,
          memory,
          score: resultMap.get(memory.id) || 0,
        }))
        .sort((a, b) => b.score - a.score)

      return merged
    } catch (error) {
      logger.error('Semantic search failed', { error, query })
      throw new ValidationException('Semantic search failed')
    }
  }

  /**
   * Batch index memories (for background worker)
   */
  async batchIndexMemories(memoryIds: string[], batchSize: number = 10): Promise<{ indexed: number; failed: number }> {
    const memories = await db.memory.findMany({
      where: { id: { in: memoryIds } },
    })

    let indexed = 0
    let failed = 0

    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize)

      await Promise.all(
        batch.map(async (memory) => {
          try {
            await this.indexMemory(memory)
            indexed++
          } catch (error) {
            logger.error('Failed to index memory in batch', { error, memoryId: memory.id })
            failed++
          }
        }),
      )
    }

    return { indexed, failed }
  }

  /**
   * Refresh embeddings for memories that need it
   */
  async refreshPendingEmbeddings(workspaceId: string, limit: number = 100): Promise<number> {
    const memories = await db.memory.findMany({
      where: {
        workspaceId,
        embeddingRefreshNeeded: true,
      },
      take: limit,
    })

    let refreshed = 0

    for (const memory of memories) {
      try {
        await this.regenerateEmbedding(memory.id)
        refreshed++
      } catch (error) {
        logger.error('Failed to refresh embedding', { error, memoryId: memory.id })
      }
    }

    return refreshed
  }

  /**
   * Delete embedding from vector DB
   */
  async deleteEmbedding(memoryId: string): Promise<void> {
    const memory = await db.memory.findUnique({
      where: { id: memoryId },
    })

    if (!memory || !memory.embeddingId) {
      return
    }

    try {
      await this.vectorDB.delete(memory.embeddingId)

      await db.memory.update({
        where: { id: memoryId },
        data: {
          embeddingId: null,
          embeddingRefreshNeeded: false,
        },
      })
    } catch (error) {
      logger.error('Failed to delete embedding', { error, memoryId })
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(workspaceId: string): Promise<{
    total: number
    indexed: number
    needsRefresh: number
    byModel: Record<string, number>
  }> {
    const memories = await db.memory.findMany({
      where: { workspaceId },
      select: {
        embeddingId: true,
        embeddingModel: true,
        embeddingRefreshNeeded: true,
      },
    })

    const byModel: Record<string, number> = {}

    memories.forEach((m) => {
      if (m.embeddingModel) {
        byModel[m.embeddingModel] = (byModel[m.embeddingModel] || 0) + 1
      }
    })

    return {
      total: memories.length,
      indexed: memories.filter((m) => m.embeddingId).length,
      needsRefresh: memories.filter((m) => m.embeddingRefreshNeeded).length,
      byModel,
    }
  }
}

export const memoryEmbeddingService = new MemoryEmbeddingService()
