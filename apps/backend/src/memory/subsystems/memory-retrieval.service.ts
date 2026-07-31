/**
 * Memory Retrieval Optimizer
 * Optimizes memory retrieval with ranking, relevance scoring, context window management
 * Implements smart context windowing for prompt construction
 */

import { PrismaClient } from '@prisma/client';
import { Memory } from '../types';

export class MemoryRetrievalService {
  constructor(private prisma: PrismaClient, private logger: any) {}

  /**
   * Retrieve optimal context window for conversation
   * Smart selection of most relevant memories within token budget
   */
  async getContextWindow(
    conversationId: string,
    maxTokens = 2000
  ): Promise<{ memories: Memory[]; usedTokens: number; budget: number }> {
    // Fetch memories ordered by relevance
    const memories = await this.prisma.memory.findMany({
      where: { conversationId, status: 'ACTIVE', isArchived: false },
      include: { metadata: true },
      orderBy: [
        { importance: 'desc' },
        { lastAccessedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    // Greedy selection within token budget
    let usedTokens = 0;
    const selected: Memory[] = [];

    for (const memory of memories) {
      const memoryTokens = memory.metadata?.tokens || Math.ceil(memory.content.length / 4);

      if (usedTokens + memoryTokens <= maxTokens) {
        selected.push(memory);
        usedTokens += memoryTokens;
      }
    }

    return {
      memories: selected,
      usedTokens,
      budget: maxTokens,
    };
  }

  /**
   * Rank memories by relevance to a query
   */
  async rankByRelevance(
    query: string,
    workspaceId: string,
    limit = 20
  ): Promise<Array<Memory & { relevanceScore: number }>> {
    const memories = await this.prisma.memory.findMany({
      where: { workspaceId, status: 'ACTIVE', isArchived: false },
      include: { metadata: true },
    });

    const queryTokens = query.toLowerCase().split(/\s+/);

    const ranked = memories.map(memory => {
      let score = 0;

      // Text similarity (BM25-like)
      const contentTokens = memory.content.toLowerCase().split(/\s+/);
      const matches = queryTokens.filter(token => contentTokens.some(ct => ct.includes(token)));
      score += (matches.length / queryTokens.length) * 40;

      // Importance weight
      score += memory.importance * 30;

      // Recency weight
      const daysSinceCreation = (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - daysSinceCreation / 30);
      score += recencyScore * 20;

      // Access frequency weight
      const accessScore = Math.min(memory.accessCount / 10, 1);
      score += accessScore * 10;

      return { ...memory, relevanceScore: Math.min(score, 100) };
    });

    return ranked.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
  }

  /**
   * Prefetch hot memories into cache
   */
  async prefetchHotMemories(workspaceId: string): Promise<string[]> {
    const hotMemories = await this.prisma.memory.findMany({
      where: { workspaceId, status: 'ACTIVE', isArchived: false },
      orderBy: [{ importance: 'desc' }, { accessCount: 'desc' }],
      take: 100,
      select: { id: true },
    });

    this.logger.debug('Prefetched hot memories', { workspaceId, count: hotMemories.length });
    return hotMemories.map(m => m.id);
  }

  /**
   * Get memories that should be reviewed/updated
   */
  async getStaleMemories(
    workspaceId: string,
    staleDays = 30
  ): Promise<Array<Memory & { staleness: number }>> {
    const staleDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

    const memories = await this.prisma.memory.findMany({
      where: {
        workspaceId,
        lastAccessedAt: { lt: staleDate },
        status: 'ACTIVE',
        isArchived: false,
      },
      include: { metadata: true },
    });

    return memories.map(m => ({
      ...m,
      staleness: Math.min(
        (Date.now() - (m.lastAccessedAt?.getTime() ?? m.createdAt.getTime())) /
          (staleDays * 24 * 60 * 60 * 1000),
        1
      ),
    }));
  }

  /**
   * Find duplicate or similar memories
   */
  async findDuplicates(
    memoryId: string,
    workspaceId: string,
    similarityThreshold = 0.8
  ): Promise<Memory[]> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) return [];

    const others = await this.prisma.memory.findMany({
      where: {
        workspaceId,
        id: { not: memoryId },
        status: 'ACTIVE',
      },
    });

    return others
      .filter(m => this.calculateSimilarity(memory.content, m.content) >= similarityThreshold)
      .sort((a, b) => {
        const simA = this.calculateSimilarity(memory.content, a.content);
        const simB = this.calculateSimilarity(memory.content, b.content);
        return simB - simA;
      });
  }

  /**
   * Suggest memories to pin based on usage
   */
  async suggestPinning(
    workspaceId: string,
    accessThreshold = 5
  ): Promise<Array<Memory & { reason: string }>> {
    const memories = await this.prisma.memory.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        isArchived: false,
        isPinned: false,
      },
      include: { metadata: true },
    });

    return memories
      .filter(m => m.metadata && m.metadata.retrievalCount >= accessThreshold)
      .map(m => ({
        ...m,
        reason: `Accessed ${m.metadata?.retrievalCount || 0} times, importance: ${(m.importance * 100).toFixed(1)}%`,
      }))
      .sort((a, b) => (b.metadata?.retrievalCount || 0) - (a.metadata?.retrievalCount || 0))
      .slice(0, 10);
  }

  /**
   * Calculate text similarity (Jaccard index)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(text1.toLowerCase().split(/\s+/));
    const tokens2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }
}
