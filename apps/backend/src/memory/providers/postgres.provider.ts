/**
 * PostgreSQL Memory Storage Provider
 * Handles persistent storage of all memory records
 */

import { PrismaClient } from '@prisma/client';
import {
  Memory,
  MemoryProvider,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchQuery,
  MemorySearchResult,
  ConsolidationResult,
  MemoryAnalytics,
} from '../types';

export class PostgresMemoryProvider implements MemoryProvider {
  name = 'postgres';
  type = 'storage' as const;

  constructor(private prisma: PrismaClient, private logger: any) {}

  async create(input: CreateMemoryInput, userId: string, workspaceId: string): Promise<Memory> {
    const memory = await this.prisma.memory.create({
      data: {
        workspaceId,
        userId,
        conversationId: input.conversationId,
        content: input.content,
        type: input.type,
        category: input.category,
        tags: input.tags || [],
        importance: input.importance ?? 0.5,
        decayRate: input.decayRate ?? 0.01,
        isManual: input.isManual ?? true,
        permission: input.permission || 'PRIVATE',
        sharedWith: input.sharedWith || [],
        status: 'ACTIVE',
        isArchived: false,
        isPinned: false,
        isEncrypted: false,
        version: 1,
        embeddingRefreshNeeded: true,
        embeddingVersion: 0,
        expiresAt: input.expiresAt,
        metadata: {
          create: {
            source: input.context?.source,
            context: input.context,
            confidence: 1.0,
            isConsolidated: false,
            relevanceScore: 1.0,
            retrievalCount: 0,
            tokens: this.estimateTokens(input.content),
            size: this.estimateSize(input.content),
          },
        },
      },
      include: { metadata: true },
    });

    return this.mapToMemory(memory);
  }

  async read(memoryId: string, _userId: string, _workspaceId: string): Promise<Memory | null> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { metadata: true },
    });

    return memory ? this.mapToMemory(memory) : null;
  }

  async update(
    memoryId: string,
    input: UpdateMemoryInput,
    _userId: string,
    _workspaceId: string
  ): Promise<Memory> {
    const memory = await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        content: input.content,
        summary: input.summary,
        category: input.category,
        tags: input.tags,
        importance: input.importance,
        decayRate: input.decayRate,
        isPinned: input.isPinned,
        status: input.status,
        permission: input.permission,
        sharedWith: input.sharedWith,
        embeddingRefreshNeeded: input.content ? true : false,
        version: { increment: 1 },
      },
      include: { metadata: true },
    });

    return this.mapToMemory(memory);
  }

  async delete(memoryId: string, _userId: string, _workspaceId: string, soft = true): Promise<void> {
    if (soft) {
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { status: 'DELETED', isArchived: true },
      });
    } else {
      // Hard delete
      await this.prisma.memory.delete({
        where: { id: memoryId },
      });
    }
  }

  async search(query: MemorySearchQuery): Promise<MemorySearchResult> {
    const where: any = {
      workspaceId: query.workspaceId,
      status: query.status || 'ACTIVE',
      isArchived: false,
    };

    if (query.userId) where.userId = query.userId;
    if (query.conversationId) where.conversationId = query.conversationId;
    if (query.type) where.type = query.type;
    if (query.category) where.category = query.category;
    if (query.minImportance) where.importance = { gte: query.minImportance };

    if (query.tags && query.tags.length > 0) {
      where.tags = { hasSome: query.tags };
    }

    if (query.dateRange) {
      where.createdAt = {
        gte: query.dateRange.from,
        lte: query.dateRange.to,
      };
    }

    // Full-text search if query provided
    if (query.query) {
      where.OR = [
        { content: { search: query.query } },
        { summary: { search: query.query } },
        { category: { search: query.query } },
      ];
    }

    const total = await this.prisma.memory.count({ where });
    const memories = await this.prisma.memory.findMany({
      where,
      include: { metadata: true },
      orderBy: { importance: 'desc' },
      take: query.limit || 20,
      skip: query.offset || 0,
    });

    return {
      memories: memories.map(m => this.mapToMemory(m)),
      total,
      hasMore: (query.offset || 0) + memories.length < total,
      query,
    };
  }

  async semanticSearch(): Promise<MemorySearchResult> {
    // Vector search would be handled by dedicated vector provider
    return { memories: [], total: 0, hasMore: false, query: { workspaceId: '' } };
  }

  async consolidate(memoryIds: string[], workspaceId: string): Promise<ConsolidationResult> {
    const memories = await this.prisma.memory.findMany({
      where: { id: { in: memoryIds } },
      include: { metadata: true },
    });

    if (memories.length === 0) {
      throw new Error('No memories to consolidate');
    }

    // Combine content and calculate metrics
    const combinedContent = memories.map(m => m.content).join('\n\n---\n\n');
    const totalTokens = memories.reduce((sum, m) => sum + (m.metadata?.tokens || 0), 0);
    const avgImportance = memories.reduce((sum, m) => sum + m.importance, 0) / memories.length;

    // Create consolidated memory
    const consolidated = await this.prisma.memory.create({
      data: {
        workspaceId,
        userId: memories[0].userId,
        content: combinedContent,
        summary: `Consolidated from ${memoryIds.length} memories`,
        type: 'SEMANTIC',
        importance: avgImportance,
        status: 'ACTIVE',
        isArchived: false,
        isPinned: false,
        isManual: false,
        isEncrypted: false,
        permission: memories[0].permission,
        version: 1,
        embeddingRefreshNeeded: true,
        embeddingVersion: 0,
        metadata: {
          create: {
            isConsolidated: true,
            consolidatedAt: new Date(),
            consolidationScore: avgImportance,
            confidence: avgImportance,
            relevanceScore: avgImportance,
            tokens: this.estimateTokens(combinedContent),
            size: this.estimateSize(combinedContent),
          },
        },
      },
      include: { metadata: true },
    });

    return {
      originalMemories: memoryIds,
      consolidatedMemoryId: consolidated.id,
      summarizedContent: consolidated.summary || '',
      tokensReduced: Math.max(0, totalTokens - (consolidated.metadata?.tokens || 0)),
      importanceScore: avgImportance,
    };
  }

  async getAnalytics(workspaceId: string): Promise<MemoryAnalytics> {
    const memories = await this.prisma.memory.findMany({
      where: { workspaceId },
      include: { metadata: true },
    });

    const byType = memories.reduce(
      (acc, m) => {
        acc[m.type] = (acc[m.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const byStatus = memories.reduce(
      (acc, m) => {
        acc[m.status] = (acc[m.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const avgImportance = memories.length > 0
      ? memories.reduce((sum, m) => sum + m.importance, 0) / memories.length
      : 0;

    const totalTokens = memories.reduce((sum, m) => sum + (m.metadata?.tokens || 0), 0);
    const totalStorage = memories.reduce((sum, m) => sum + (m.metadata?.size || 0), 0);

    const decayedCount = memories.filter(m => m.status === 'DECAYING').length;
    const expiringCount = memories.filter(
      m => m.expiresAt && new Date(m.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
    ).length;

    return {
      workspaceId,
      totalMemories: memories.length,
      memoriesByType: byType as any,
      memoriesByStatus: byStatus as any,
      averageImportance: avgImportance,
      totalTokens,
      totalStorage,
      consolidationsToday: 0,
      retrievalsToday: 0,
      decayedMemoriesCount: decayedCount,
      expiringMemoriesCount: expiringCount,
    };
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

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private estimateSize(text: string): number {
    return Buffer.byteLength(text, 'utf-8');
  }
}
