/**
 * Vector Memory Provider
 * Wires the Universal Memory System to the real embedding + vector DB
 * infrastructure (apps/backend/src/embeddings, apps/backend/src/vectordb)
 * instead of stubbing embed()/semanticSearch(). No provider SDK is named
 * here — both subsystems already handle provider selection, caching,
 * rate limiting, retry, circuit breaking and cost accounting internally.
 */

import { PrismaClient } from '@prisma/client';
import { embed } from '../../embeddings';
import { upsertVectors, queryVectors, deleteVectors } from '../../vectordb';
import { Memory, MemoryProvider, SemanticSearchQuery, MemorySearchResult } from '../types';

const MEMORY_NAMESPACE = 'memory';

export class VectorMemoryProvider implements MemoryProvider {
  name = 'vector';
  type = 'embedding' as const;

  constructor(private prisma: PrismaClient, private logger: any) {}

  /**
   * Generate an embedding for memory content via the shared embedding
   * service, then upsert it into the vector DB under the memory's
   * workspace namespace so semanticSearch() can query it back.
   */
  async embed(text: string, _model: string): Promise<number[]> {
    // workspaceId is attached by the caller via embedForMemory(); this
    // signature-compatible method exists only to satisfy MemoryProvider
    // for callers that only need the raw vector (no vector DB write).
    const result = await embed(text, { workspaceId: 'global' });
    return [...result.embedding.values];
  }

  /**
   * Full pipeline: embed memory content, upsert into vector DB, and
   * persist embedding metadata onto the Memory row.
   */
  async embedForMemory(memoryId: string, content: string, workspaceId: string): Promise<void> {
    try {
      const result = await embed(content, { workspaceId });

      await upsertVectors(
        [
          {
            id: memoryId,
            values: result.embedding.values,
            metadata: { memoryId, workspaceId },
          },
        ],
        { workspaceId, namespace: MEMORY_NAMESPACE }
      );

      await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          embeddingId: memoryId,
          embeddingModel: result.model,
          embeddingVersion: { increment: 1 },
          embeddingRefreshNeeded: false,
        },
      });

      this.logger.debug('Memory embedding generated and indexed', {
        memoryId,
        provider: result.provider,
        model: result.model,
        cached: result.cached,
      });
    } catch (error) {
      this.logger.error('Failed to embed memory', { memoryId, error });
      throw error;
    }
  }

  async searchByVector(vector: number[], limit: number, threshold: number): Promise<Memory[]> {
    const result = await queryVectors({
      workspaceId: 'global',
      namespace: MEMORY_NAMESPACE,
      vector,
      topK: limit,
      includeMetadata: true,
    });

    const memoryIds = result.matches
      .filter((m) => m.score >= threshold)
      .map((m) => m.id);

    if (memoryIds.length === 0) return [];

    const memories = await this.prisma.memory.findMany({
      where: { id: { in: memoryIds }, status: 'ACTIVE' },
      include: { metadata: true },
    });

    // Preserve vector-search relevance order
    const order = new Map(memoryIds.map((id, idx) => [id, idx]));
    return memories
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((m) => this.mapToMemory(m));
  }

  async semanticSearch(query: SemanticSearchQuery): Promise<MemorySearchResult> {
    let vector = query.embedding;
    if (!vector) {
      const result = await embed(query.query, { workspaceId: query.workspaceId });
      vector = [...result.embedding.values];
    }

    const queryResult = await queryVectors({
      workspaceId: query.workspaceId,
      namespace: MEMORY_NAMESPACE,
      vector,
      topK: query.limit ?? 10,
      includeMetadata: true,
    });

    const threshold = query.threshold ?? 0.7;
    const memoryIds = queryResult.matches
      .filter((m) => m.score >= threshold)
      .map((m) => m.id);

    if (memoryIds.length === 0) {
      return { memories: [], total: 0, hasMore: false, query: { workspaceId: query.workspaceId } };
    }

    const memories = await this.prisma.memory.findMany({
      where: { id: { in: memoryIds }, workspaceId: query.workspaceId, status: 'ACTIVE' },
      include: { metadata: true },
    });

    const order = new Map(memoryIds.map((id, idx) => [id, idx]));
    const ordered = memories.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return {
      memories: ordered.map((m) => this.mapToMemory(m)),
      total: ordered.length,
      hasMore: false,
      query: { workspaceId: query.workspaceId },
    };
  }

  /**
   * Remove a memory's vector when the memory itself is hard-deleted or
   * erased (GDPR). Vector DB rows do not soft-delete.
   */
  async deleteVector(memoryId: string, workspaceId: string): Promise<void> {
    await deleteVectors({
      workspaceId,
      namespace: MEMORY_NAMESPACE,
      ids: [memoryId],
    });
  }

  private mapToMemory(data: any): Memory {
    return {
      id: data.id,
      workspaceId: data.workspaceId,
      conversationId: data.conversationId,
      userId: data.userId,
      content: data.content,
      summary: data.summary,
      type: data.type,
      category: data.category,
      tags: data.tags,
      importance: data.importance,
      decayRate: data.decayRate,
      lastAccessedAt: data.lastAccessedAt,
      accessCount: data.accessCount,
      isArchived: data.isArchived,
      isPinned: data.isPinned,
      isManual: data.isManual,
      status: data.status,
      permission: data.permission,
      sharedWith: data.sharedWith,
      version: data.version,
      parentId: data.parentId,
      embeddingId: data.embeddingId,
      embeddingModel: data.embeddingModel,
      embeddingVersion: data.embeddingVersion,
      embeddingRefreshNeeded: data.embeddingRefreshNeeded,
      isEncrypted: data.isEncrypted,
      encryptionKey: data.encryptionKey,
      expiresAt: data.expiresAt,
      metadata: data.metadata,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}
