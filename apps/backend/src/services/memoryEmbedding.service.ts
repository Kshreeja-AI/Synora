import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { NotFoundException, ServiceUnavailableException } from '@synora/shared'
import { logger } from '../utils/logger'

/**
 * Memory embeddings and vector search.
 *
 * Semantic search requires two real dependencies: an embedding model and
 * a vector database. Synora ships neither today — no provider in the AI
 * abstraction implements the `embeddings` capability (see
 * `src/ai/types.ts`), and no vector DB is provisioned. Rather than
 * fabricate vectors (an earlier version hashed text through `Math.sin`
 * and served the resulting cosine distances as "semantic similarity",
 * which is noise dressed as relevance), this module is **disabled until
 * real providers are registered** via `configureMemoryEmbeddings`.
 *
 * While disabled:
 * - `isSemanticSearchAvailable()` returns false;
 * - `semanticSearch` throws `ServiceUnavailableException` (routes surface
 *   a 503 rather than empty-but-successful results, so callers can tell
 *   "not configured" from "no matches");
 * - indexing calls no-op and report `skipped`, leaving `embeddingId` null
 *   so nothing in the database claims an embedding that doesn't exist.
 *
 * Memory retrieval stays useful meanwhile: `memoryRetrieval.service`
 * falls back to real lexical matching over stored content.
 */

/** Vector database provider. Implement to enable semantic search. */
export interface IVectorDB {
  upsert(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void>
  delete(id: string): Promise<void>
  query(embedding: number[], topK: number, namespace?: string): Promise<Array<{ id: string; score: number }>>
}

/** Embedding model provider. Implement to enable semantic search. */
export interface IEmbeddingModel {
  /** Model identifier recorded on indexed memories, e.g. "text-embedding-3-small". */
  readonly model: string
  embed(text: string): Promise<number[]>
}

interface EmbeddingProviders {
  embeddings: IEmbeddingModel
  vectorDB: IVectorDB
}

let providers: EmbeddingProviders | null = null

/**
 * Register real embedding + vector DB providers. Call once at startup
 * when both are configured; semantic search stays disabled until then.
 */
export function configureMemoryEmbeddings(next: EmbeddingProviders): void {
  providers = next
  logger.info('Memory semantic search enabled', { model: next.embeddings.model })
}

/** Test/teardown hook — returns the module to its unconfigured state. */
export function resetMemoryEmbeddings(): void {
  providers = null
}

export function isSemanticSearchAvailable(): boolean {
  return providers !== null
}

const UNAVAILABLE_MESSAGE =
  'Semantic memory search is not available: no embedding provider is configured for this deployment.'

function requireProviders(): EmbeddingProviders {
  if (!providers) {
    throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE)
  }
  return providers
}

export interface IndexResult {
  status: 'indexed' | 'skipped'
}

export class MemoryEmbeddingService {
  /**
   * Generate an embedding for arbitrary content. Throws when no
   * embedding provider is configured — callers must not substitute a
   * synthetic vector.
   */
  async generateEmbedding(content: string): Promise<number[]> {
    const { embeddings } = requireProviders()
    return embeddings.embed(content)
  }

  /**
   * Index a memory in the vector DB. No-ops (reporting `skipped`) when
   * semantic search is disabled, leaving embedding columns untouched.
   */
  async indexMemory(memory: Memory): Promise<IndexResult> {
    if (!providers) {
      return { status: 'skipped' }
    }
    const { embeddings, vectorDB } = providers

    try {
      const embedding = await embeddings.embed(memory.content)
      const embeddingId = `memory_${memory.id}`

      await vectorDB.upsert(embeddingId, embedding, {
        memoryId: memory.id,
        workspaceId: memory.workspaceId,
        conversationId: memory.conversationId,
        userId: memory.userId,
        type: memory.type,
        category: memory.category,
        importance: memory.importance,
        createdAt: memory.createdAt,
      })

      await db.memory.update({
        where: { id: memory.id },
        data: {
          embeddingId,
          embeddingModel: embeddings.model,
          embeddingVersion: 1,
          embeddingRefreshNeeded: false,
        },
      })

      logger.debug(`Memory indexed: ${memory.id}`)
      return { status: 'indexed' }
    } catch (error) {
      logger.error('Failed to index memory', { error, memoryId: memory.id })
      throw error
    }
  }

  /**
   * Regenerate a memory's embedding. No-ops when disabled.
   */
  async regenerateEmbedding(memoryId: string): Promise<IndexResult> {
    if (!providers) {
      return { status: 'skipped' }
    }

    const memory = await db.memory.findUnique({ where: { id: memoryId } })
    if (!memory) {
      throw new NotFoundException('Memory not found')
    }

    if (memory.embeddingId) {
      await providers.vectorDB.delete(memory.embeddingId)
    }

    const result = await this.indexMemory(memory)

    await db.memory.update({
      where: { id: memoryId },
      data: {
        embeddingRefreshNeeded: false,
        embeddingVersion: (memory.embeddingVersion || 0) + 1,
      },
    })

    logger.info(`Embedding regenerated: ${memoryId}`)
    return result
  }

  /**
   * Semantic search across memories. Throws
   * `ServiceUnavailableException` when no provider is configured — an
   * empty result would misrepresent "unavailable" as "no matches".
   */
  async semanticSearch(
    query: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<Array<{ memoryId: string; memory: Memory; score: number }>> {
    const { embeddings, vectorDB } = requireProviders()

    const queryEmbedding = await embeddings.embed(query)
    const results = await vectorDB.query(queryEmbedding, limit, workspaceId)

    const memories = await db.memory.findMany({
      where: {
        id: { in: results.map((r) => r.id.replace('memory_', '')) },
        workspaceId,
      },
      include: { metadata: true },
    })

    const resultMap = new Map(results.map((r) => [r.id.replace('memory_', ''), r.score]))

    return memories
      .map((memory) => ({
        memoryId: memory.id,
        memory,
        score: resultMap.get(memory.id) || 0,
      }))
      .sort((a, b) => b.score - a.score)
  }

  /**
   * Batch index memories (background worker). Reports `skipped` when
   * semantic search is disabled instead of pretending to have worked.
   */
  async batchIndexMemories(
    memoryIds: string[],
    batchSize: number = 10,
  ): Promise<{ indexed: number; failed: number; skipped: boolean }> {
    if (!providers) {
      return { indexed: 0, failed: 0, skipped: true }
    }

    const memories = await db.memory.findMany({ where: { id: { in: memoryIds } } })

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

    return { indexed, failed, skipped: false }
  }

  /**
   * Refresh embeddings flagged as stale. No-ops when disabled.
   */
  async refreshPendingEmbeddings(workspaceId: string, limit: number = 100): Promise<number> {
    if (!providers) {
      return 0
    }

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
   * Delete a memory's embedding from the vector DB.
   */
  async deleteEmbedding(memoryId: string): Promise<void> {
    const memory = await db.memory.findUnique({ where: { id: memoryId } })

    if (!memory || !memory.embeddingId) {
      return
    }

    try {
      if (providers) {
        await providers.vectorDB.delete(memory.embeddingId)
      }

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
   * Embedding coverage for a workspace. `semanticSearchEnabled` tells
   * callers whether the zeroes below mean "nothing indexed yet" or
   * "indexing is switched off in this deployment".
   */
  async getEmbeddingStats(workspaceId: string): Promise<{
    semanticSearchEnabled: boolean
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
      semanticSearchEnabled: isSemanticSearchAvailable(),
      total: memories.length,
      indexed: memories.filter((m) => m.embeddingId).length,
      needsRefresh: memories.filter((m) => m.embeddingRefreshNeeded).length,
      byModel,
    }
  }
}

export const memoryEmbeddingService = new MemoryEmbeddingService()
