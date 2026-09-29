import { prisma as db } from '@synora/database'
import { Memory } from '@synora/database'
import { NotFoundException, ServiceUnavailableException } from '@synora/shared'
import { logger } from '../utils/logger'
import { embed, EMBEDDING_PROVIDER_REGISTRY } from '../embeddings'
import {
  upsertVectors,
  queryVectors,
  deleteVectors,
  VECTORDB_PROVIDER_REGISTRY,
} from '../vectordb'

/**
 * Memory embeddings and vector search.
 *
 * This module owns no provider logic of its own. Embedding generation goes
 * through `src/embeddings` (7 providers: OpenAI, Voyage, Gemini, Cohere,
 * Claude, Ollama, self-hosted — with caching, rate limiting, retry, circuit
 * breaking, metrics and cost accounting built in) and vector storage goes
 * through `src/vectordb` (pgvector, Pinecone, Qdrant, Weaviate, Milvus).
 * Both select their provider from configuration and credentials; nothing
 * here ever names one.
 *
 * Semantic search therefore activates automatically the moment an embedding
 * provider and a vector database are configured, and is honestly disabled
 * until then:
 * - `isSemanticSearchAvailable()` reports whether both halves are ready;
 * - `semanticSearch` throws `ServiceUnavailableException` (503) rather than
 *   returning empty results, so callers can distinguish "not configured"
 *   from "no matches";
 * - indexing no-ops and reports `skipped`, leaving `embeddingId` null so
 *   nothing in the database claims an embedding that doesn't exist.
 *
 * There is no fallback embedding implementation and there must never be
 * one: an approximate vector produces confident, wrong rankings, which is
 * worse than no semantic search at all. `memoryRetrieval.service` degrades
 * to real lexical matching instead.
 */

/** Vectors for memories live in their own namespace, away from any other vector workload. */
const MEMORY_NAMESPACE = 'memories'

const UNAVAILABLE_MESSAGE =
  'Semantic memory search is not available: this deployment has no embedding provider and/or vector database configured.'

export interface SemanticSearchAvailability {
  available: boolean
  embeddingProvider: string | null
  vectorDatabase: string | null
  /** Human-readable reason when unavailable — surfaced in health/stats, never to anonymous callers. */
  reason?: string
}

/**
 * Capability detection: asks both registries whether any provider has the
 * credentials it needs. Cheap (no network calls) — every descriptor's
 * `isConfigured()` only inspects config and secrets.
 */
export async function getSemanticSearchAvailability(): Promise<SemanticSearchAvailability> {
  let embeddingProvider: string | null = null
  for (const descriptor of EMBEDDING_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      embeddingProvider = descriptor.id
      break
    }
  }

  let vectorDatabase: string | null = null
  for (const descriptor of VECTORDB_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      vectorDatabase = descriptor.id
      break
    }
  }

  const missing: string[] = []
  if (!embeddingProvider) missing.push('an embedding provider')
  if (!vectorDatabase) missing.push('a vector database')

  return {
    available: embeddingProvider !== null && vectorDatabase !== null,
    embeddingProvider,
    vectorDatabase,
    ...(missing.length > 0 && { reason: `Missing ${missing.join(' and ')}.` }),
  }
}

export async function isSemanticSearchAvailable(): Promise<boolean> {
  return (await getSemanticSearchAvailability()).available
}

async function requireAvailable(): Promise<void> {
  const availability = await getSemanticSearchAvailability()
  if (!availability.available) {
    throw new ServiceUnavailableException(`${UNAVAILABLE_MESSAGE} ${availability.reason ?? ''}`.trim())
  }
}

export interface IndexResult {
  status: 'indexed' | 'skipped'
}

export class MemoryEmbeddingService {
  /**
   * Generate an embedding for arbitrary content through the shared
   * embeddings service. Throws when nothing is configured — callers must
   * never substitute a synthetic vector.
   */
  async generateEmbedding(content: string, workspaceId: string): Promise<number[]> {
    await requireAvailable()
    const result = await embed(content, { workspaceId })
    return [...result.embedding.values]
  }

  /**
   * Index a memory for semantic search. No-ops (reporting `skipped`) when
   * semantic search is unavailable, leaving embedding columns untouched.
   */
  async indexMemory(memory: Memory): Promise<IndexResult> {
    if (!(await isSemanticSearchAvailable())) {
      return { status: 'skipped' }
    }

    try {
      const result = await embed(memory.content, { workspaceId: memory.workspaceId })
      const embeddingId = `memory_${memory.id}`

      await upsertVectors(
        [
          {
            id: embeddingId,
            values: result.embedding.values,
            metadata: {
              memoryId: memory.id,
              workspaceId: memory.workspaceId,
              conversationId: memory.conversationId ?? undefined,
              userId: memory.userId,
              type: memory.type,
              category: memory.category ?? undefined,
              importance: memory.importance,
              permission: memory.permission,
              createdAt: memory.createdAt.toISOString(),
            },
          },
        ],
        { workspaceId: memory.workspaceId, namespace: MEMORY_NAMESPACE }
      )

      await db.memory.update({
        where: { id: memory.id },
        data: {
          embeddingId,
          embeddingModel: result.model,
          embeddingVersion: 1,
          embeddingRefreshNeeded: false,
        },
      })

      logger.debug('Memory indexed', { memoryId: memory.id, provider: result.provider })
      return { status: 'indexed' }
    } catch (error) {
      logger.error('Failed to index memory', { error, memoryId: memory.id })
      throw error
    }
  }

  /**
   * Regenerate a memory's embedding after its content changed.
   */
  async regenerateEmbedding(memoryId: string): Promise<IndexResult> {
    const memory = await db.memory.findUnique({ where: { id: memoryId } })
    if (!memory) {
      throw new NotFoundException('Memory not found')
    }

    if (!(await isSemanticSearchAvailable())) {
      return { status: 'skipped' }
    }

    const result = await this.indexMemory(memory)

    await db.memory.update({
      where: { id: memoryId },
      data: {
        embeddingRefreshNeeded: false,
        embeddingVersion: (memory.embeddingVersion || 0) + 1,
      },
    })

    logger.info('Embedding regenerated', { memoryId })
    return result
  }

  /**
   * Semantic search across a workspace's memories. Throws
   * `ServiceUnavailableException` when unavailable — an empty result would
   * misrepresent "not configured" as "no matches".
   */
  async semanticSearch(
    query: string,
    workspaceId: string,
    limit: number = 10,
  ): Promise<Array<{ memoryId: string; memory: Memory; score: number }>> {
    await requireAvailable()

    const queryEmbedding = await embed(query, { workspaceId })
    const matches = await queryVectors({
      workspaceId,
      namespace: MEMORY_NAMESPACE,
      vector: queryEmbedding.embedding.values,
      topK: limit,
      includeMetadata: true,
    })

    const scoreById = new Map<string, number>()
    for (const match of matches.matches) {
      scoreById.set(match.id.replace('memory_', ''), match.score)
    }

    if (scoreById.size === 0) {
      return []
    }

    // The vector store is an index, not the source of truth: memory rows are
    // re-read from Postgres and re-scoped to the workspace so a stale or
    // cross-workspace vector can never surface content.
    const memories = await db.memory.findMany({
      where: { id: { in: [...scoreById.keys()] }, workspaceId },
      include: { metadata: true },
    })

    return memories
      .map((memory) => ({
        memoryId: memory.id,
        memory,
        score: scoreById.get(memory.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
  }

  /**
   * Batch index memories (background worker). Reports `skipped` when
   * semantic search is unavailable instead of pretending to have worked.
   */
  async batchIndexMemories(
    memoryIds: string[],
    batchSize: number = 10,
  ): Promise<{ indexed: number; failed: number; skipped: boolean }> {
    if (!(await isSemanticSearchAvailable())) {
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
   * Refresh embeddings flagged as stale.
   */
  async refreshPendingEmbeddings(workspaceId: string, limit: number = 100): Promise<number> {
    if (!(await isSemanticSearchAvailable())) {
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
   * Delete a memory's vector. Always clears the database columns, even if
   * the vector store call fails, so a memory is never left pointing at a
   * vector this system believes it deleted.
   */
  async deleteEmbedding(memoryId: string): Promise<void> {
    const memory = await db.memory.findUnique({ where: { id: memoryId } })

    if (!memory || !memory.embeddingId) {
      return
    }

    try {
      if (await isSemanticSearchAvailable()) {
        await deleteVectors({
          workspaceId: memory.workspaceId,
          namespace: MEMORY_NAMESPACE,
          ids: [memory.embeddingId],
        })
      }
    } catch (error) {
      logger.error('Failed to delete vector for memory', { error, memoryId })
    }

    await db.memory.update({
      where: { id: memoryId },
      data: {
        embeddingId: null,
        embeddingRefreshNeeded: false,
      },
    })
  }

  /**
   * Embedding coverage for a workspace. The availability fields tell callers
   * whether a zero count means "nothing indexed yet" or "semantic search is
   * switched off in this deployment".
   */
  async getEmbeddingStats(workspaceId: string): Promise<{
    semanticSearchEnabled: boolean
    embeddingProvider: string | null
    vectorDatabase: string | null
    total: number
    indexed: number
    needsRefresh: number
    byModel: Record<string, number>
  }> {
    const [availability, memories] = await Promise.all([
      getSemanticSearchAvailability(),
      db.memory.findMany({
        where: { workspaceId },
        select: {
          embeddingId: true,
          embeddingModel: true,
          embeddingRefreshNeeded: true,
        },
      }),
    ])

    const byModel: Record<string, number> = {}

    memories.forEach((m) => {
      if (m.embeddingModel) {
        byModel[m.embeddingModel] = (byModel[m.embeddingModel] || 0) + 1
      }
    })

    return {
      semanticSearchEnabled: availability.available,
      embeddingProvider: availability.embeddingProvider,
      vectorDatabase: availability.vectorDatabase,
      total: memories.length,
      indexed: memories.filter((m) => m.embeddingId).length,
      needsRefresh: memories.filter((m) => m.embeddingRefreshNeeded).length,
      byModel,
    }
  }
}

export const memoryEmbeddingService = new MemoryEmbeddingService()
