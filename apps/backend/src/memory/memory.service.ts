/**
 * Universal Memory System - Core Service
 * Orchestrates all memory operations across providers
 */

import { PrismaClient } from '@prisma/client';
import {
  Memory,
  MemoryMetadata,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchQuery,
  MemorySearchResult,
  SemanticSearchQuery,
  MemoryProvider,
  ConsolidationResult,
  MemoryAnalytics,
  MemoryAuditLog,
} from './types';

export class MemoryService {
  constructor(
    private prisma: PrismaClient,
    private storageProvider: MemoryProvider,
    private embeddingProvider: MemoryProvider,
    private searchProvider: MemoryProvider,
    private cacheProvider: MemoryProvider,
    private logger: any
  ) {}

  /**
   * Create a new memory
   */
  async createMemory(
    input: CreateMemoryInput,
    userId: string,
    workspaceId: string
  ): Promise<Memory> {
    this.logger.debug('Creating memory', { userId, workspaceId, type: input.type });

    // Validate quota
    const quota = await this.prisma.memoryQuota.findUnique({
      where: { workspaceId },
    });

    if (!quota) {
      throw new Error(`No quota found for workspace ${workspaceId}`);
    }

    if (quota.currentMemories >= quota.maxMemories) {
      throw new Error('Memory quota exceeded');
    }

    // Create memory in storage
    const memory = await this.storageProvider.create?.(input, userId, workspaceId);
    if (!memory) throw new Error('Failed to create memory');

    // Update quota
    await this.prisma.memoryQuota.update({
      where: { workspaceId },
      data: {
        currentMemories: { increment: 1 },
        currentTokens: { increment: this.estimateTokens(input.content) },
        currentStorage: { increment: this.estimateSize(input.content) },
      },
    });

    // Create audit log
    await this.createAuditLog(
      memory.id,
      userId,
      'CREATED',
      { type: input.type, importance: input.importance }
    );

    // Async: Generate embeddings
    if (this.embeddingProvider.embed) {
      setImmediate(() => this.generateEmbedding(memory.id, memory.content, 'text-embedding-3-small'));
    }

    return memory;
  }

  /**
   * Retrieve a memory by ID
   */
  async getMemory(memoryId: string, userId: string, workspaceId: string): Promise<Memory | null> {
    const memory = await this.storageProvider.read?.(memoryId, userId, workspaceId);
    if (!memory) return null;

    // Update access metadata
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    // Cache for fast retrieval
    await this.cacheProvider.cache?.(memory, 3600);

    // Log access
    await this.createAuditLog(memoryId, userId, 'ACCESSED');

    return memory;
  }

  /**
   * Update a memory
   */
  async updateMemory(
    memoryId: string,
    input: UpdateMemoryInput,
    userId: string,
    workspaceId: string
  ): Promise<Memory> {
    const existing = await this.getMemory(memoryId, userId, workspaceId);
    if (!existing) throw new Error(`Memory ${memoryId} not found`);

    const updated = await this.storageProvider.update?.(memoryId, input, userId, workspaceId);
    if (!updated) throw new Error('Failed to update memory');

    // Create version by archiving old version
    if (input.content && input.content !== existing.content) {
      // Create version history
      await this.prisma.memory.create({
        data: {
          workspaceId,
          userId,
          conversationId: existing.conversationId,
          content: existing.content,
          summary: existing.summary,
          type: existing.type,
          category: existing.category,
          tags: existing.tags,
          importance: existing.importance,
          decayRate: existing.decayRate,
          isArchived: true,
          isPinned: false,
          isManual: existing.isManual,
          status: 'ARCHIVED',
          permission: existing.permission,
          sharedWith: existing.sharedWith,
          version: existing.version,
          parentId: memoryId,
          embeddingRefreshNeeded: false,
          isEncrypted: existing.isEncrypted,
        },
      });

      // Flag for re-embedding
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { embeddingRefreshNeeded: true, version: { increment: 1 } },
      });
    }

    // Log change
    await this.createAuditLog(memoryId, userId, 'UPDATED', {
      changes: Object.keys(input).reduce(
        (acc, key) => ({
          ...acc,
          [key]: { from: (existing as any)[key], to: (input as any)[key] },
        }),
        {}
      ),
    });

    return updated;
  }

  /**
   * Delete a memory (soft delete)
   */
  async deleteMemory(memoryId: string, userId: string, workspaceId: string): Promise<void> {
    await this.storageProvider.delete?.(memoryId, userId, workspaceId, true);

    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { status: 'DELETED', isArchived: true },
    });

    await this.createAuditLog(memoryId, userId, 'DELETED');
  }

  /**
   * Search memories by full-text query
   */
  async search(query: MemorySearchQuery): Promise<MemorySearchResult> {
    return await this.searchProvider.search?.(query) || {
      memories: [],
      total: 0,
      hasMore: false,
      query,
    };
  }

  /**
   * Semantic search using embeddings
   */
  async semanticSearch(query: SemanticSearchQuery): Promise<MemorySearchResult> {
    // Generate embedding for query
    let embedding = query.embedding;
    if (!embedding && this.embeddingProvider.embed) {
      embedding = await this.embeddingProvider.embed(query.query, 'text-embedding-3-small');
    }

    if (!embedding) {
      return { memories: [], total: 0, hasMore: false, query: { workspaceId: query.workspaceId } };
    }

    // Search in vector space
    return await this.searchProvider.semanticSearch?.({
      ...query,
      embedding,
    }) || { memories: [], total: 0, hasMore: false, query: { workspaceId: query.workspaceId } };
  }

  /**
   * Consolidate related memories
   */
  async consolidate(
    memoryIds: string[],
    workspaceId: string,
    userId: string
  ): Promise<ConsolidationResult> {
    // Check consolidation quota
    const quota = await this.prisma.memoryQuota.findUnique({
      where: { workspaceId },
    });

    if (!quota || quota.consolidationsUsedToday >= quota.maxConsolidationsPerDay) {
      throw new Error('Consolidation quota exceeded');
    }

    // Perform consolidation
    const result = await this.storageProvider.consolidate?.(memoryIds, workspaceId);
    if (!result) throw new Error('Consolidation failed');

    // Mark old memories as consolidated
    await this.prisma.memory.updateMany({
      where: { id: { in: memoryIds } },
      data: { status: 'CONSOLIDATED' },
    });

    // Update quota
    await this.prisma.memoryQuota.update({
      where: { workspaceId },
      data: { consolidationsUsedToday: { increment: 1 } },
    });

    await this.createAuditLog(result.consolidatedMemoryId, userId, 'CONSOLIDATED', {
      sourceMemories: memoryIds,
      tokensReduced: result.tokensReduced,
    });

    return result;
  }

  /**
   * Apply memory decay
   */
  async applyDecay(workspaceId: string): Promise<number> {
    const memories = await this.prisma.memory.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        isArchived: false,
      },
    });

    let decayedCount = 0;

    for (const memory of memories) {
      const daysSinceAccess = Math.floor(
        (Date.now() - (memory.lastAccessedAt?.getTime() ?? memory.createdAt.getTime())) / (1000 * 60 * 60 * 24)
      );

      const decayedImportance = memory.importance * Math.exp(-memory.decayRate * daysSinceAccess);

      if (decayedImportance < 0.1) {
        await this.prisma.memory.update({
          where: { id: memory.id },
          data: { status: 'DECAYING', importance: decayedImportance },
        });
        decayedCount++;
      } else if (decayedImportance !== memory.importance) {
        await this.prisma.memory.update({
          where: { id: memory.id },
          data: { importance: decayedImportance },
        });
      }
    }

    return decayedCount;
  }

  /**
   * Generate embedding for memory
   */
  private async generateEmbedding(memoryId: string, content: string, model: string): Promise<void> {
    try {
      const vector = await this.embeddingProvider.embed?.(content, model);
      if (!vector) return;

      await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          embeddingId: `emb_${memoryId}`,
          embeddingModel: model,
          embeddingVersion: 1,
          embeddingRefreshNeeded: false,
        },
      });

      this.logger.debug('Embedding generated', { memoryId, model });
    } catch (error) {
      this.logger.error('Failed to generate embedding', { memoryId, error });
    }
  }

  /**
   * Get memory analytics
   */
  async getAnalytics(workspaceId: string): Promise<MemoryAnalytics> {
    return await this.storageProvider.getAnalytics?.(workspaceId) || {
      workspaceId,
      totalMemories: 0,
      memoriesByType: {} as any,
      memoriesByStatus: {} as any,
      averageImportance: 0,
      totalTokens: 0,
      totalStorage: 0,
      consolidationsToday: 0,
      retrievalsToday: 0,
      decayedMemoriesCount: 0,
      expiringMemoriesCount: 0,
    };
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(
    memoryId: string,
    userId: string,
    action: string,
    metadata?: Record<string, any>
  ): Promise<MemoryAuditLog> {
    return await this.prisma.memoryAuditLog.create({
      data: {
        memoryId,
        userId,
        action,
        metadata,
      },
    });
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate storage size
   */
  private estimateSize(text: string): number {
    return Buffer.byteLength(text, 'utf-8');
  }
}
