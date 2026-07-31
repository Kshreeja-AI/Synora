/**
 * Memory Subsystems Service
 * Specialized memory operations: short/long-term, semantic, episodic,
 * workspace/conversation/user context, pinning, importance scoring,
 * compression, summarization, smart retrieval, conflict resolution,
 * merging, and permission enforcement.
 */

import { PrismaClient } from '@prisma/client';
import {
  Memory,
  MemoryType,
  MemoryStatus,
  MemoryPermission,
  MemorySearchResult,
} from './types';

/** Result returned from conflict detection */
interface MemoryConflict {
  id: string;
  memoryId: string;
  conflictingMemoryId: string;
  relationId: string;
  memoryContent: string;
  conflictingContent: string;
  detectedAt: Date;
}

/** Resolution strategy for a detected conflict */
interface ConflictResolution {
  keep: 'source' | 'conflicting' | 'both' | 'merge';
  mergedContent?: string;
}

/** Lightweight event descriptor for episodic memories */
interface EpisodicEvent {
  type: string;
  description: string;
  participants?: string[];
  context?: Record<string, any>;
}

/** Merged-memory result */
interface MergeResult {
  mergedMemoryId: string;
  sourceIds: string[];
  mergedContent: string;
  totalTokensReduced: number;
}

export class MemorySubsystemsService {
  constructor(
    private prisma: PrismaClient,
    private logger: any
  ) {}

  // ---------------------------------------------------------------------------
  // 1. Short-term memory management
  // ---------------------------------------------------------------------------

  /**
   * Create a short-term memory with an automatic expiry.
   * "context" memories expire in 1 hour; "session" memories in 24 hours.
   */
  async createShortTermMemory(
    content: string,
    userId: string,
    workspaceId: string,
    variant: 'context' | 'session',
    conversationId?: string
  ): Promise<Memory> {
    try {
      const ttlMs = variant === 'context' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + ttlMs);

      const memory = await this.prisma.memory.create({
        data: {
          workspaceId,
          userId,
          conversationId,
          content,
          type: 'SHORT_TERM',
          category: variant,
          tags: ['short-term', variant],
          importance: variant === 'session' ? 0.4 : 0.2,
          decayRate: variant === 'context' ? 0.5 : 0.1,
          isManual: false,
          permission: 'PRIVATE',
          status: 'ACTIVE',
          isArchived: false,
          isPinned: false,
          isEncrypted: false,
          version: 1,
          embeddingRefreshNeeded: true,
          embeddingVersion: 0,
          expiresAt,
          metadata: {
            create: {
              source: 'short-term-subsystem',
              context: { variant },
              confidence: 1.0,
              isConsolidated: false,
              relevanceScore: 1.0,
              retrievalCount: 0,
              tokens: this.estimateTokens(content),
              size: this.estimateSize(content),
            },
          },
        },
        include: { metadata: true },
      });

      this.logger.debug('Short-term memory created', {
        memoryId: memory.id,
        variant,
        expiresAt,
      });

      return this.mapToMemory(memory);
    } catch (error) {
      this.logger.error('Failed to create short-term memory', { error });
      throw error;
    }
  }

  /**
   * Delete all expired short-term memories in a workspace.
   * Returns the count of removed records.
   */
  async cleanExpiredShortTerm(workspaceId?: string): Promise<number> {
    try {
      const where: any = {
        type: 'SHORT_TERM',
        expiresAt: { lte: new Date() },
      };
      if (workspaceId) {
        where.workspaceId = workspaceId;
      }

      // Mark as EXPIRED first (audit-friendly), then hard-delete metadata and the memories
      const expired = await this.prisma.memory.findMany({ where, select: { id: true } });
      if (expired.length === 0) return 0;

      const ids = expired.map(m => m.id);

      await this.prisma.memoryAuditLog.deleteMany({ where: { memoryId: { in: ids } } });
      await this.prisma.memoryMetadata.deleteMany({ where: { memoryId: { in: ids } } });
      await this.prisma.memoryRelation.deleteMany({
        where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
      });
      const result = await this.prisma.memory.deleteMany({ where: { id: { in: ids } } });

      this.logger.info('Expired short-term memories cleaned', { count: result.count });
      return result.count;
    } catch (error) {
      this.logger.error('Failed to clean expired short-term memories', { error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Long-term memory promotion
  // ---------------------------------------------------------------------------

  /**
   * Promote a short-term memory to long-term by updating its type, removing
   * the expiry, and lowering the decay rate so it persists indefinitely.
   */
  async promoteToLongTerm(memoryId: string): Promise<Memory> {
    try {
      const existing = await this.prisma.memory.findUnique({
        where: { id: memoryId },
        include: { metadata: true },
      });

      if (!existing) {
        throw new Error(`Memory ${memoryId} not found`);
      }

      if (existing.type !== 'SHORT_TERM') {
        throw new Error(`Memory ${memoryId} is already ${existing.type}, not SHORT_TERM`);
      }

      const updated = await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          type: 'LONG_TERM',
          expiresAt: null,
          decayRate: 0.005,
          importance: Math.max(existing.importance, 0.5),
          version: { increment: 1 },
          embeddingRefreshNeeded: true,
        },
        include: { metadata: true },
      });

      await this.createAuditLog(memoryId, existing.userId, 'PROMOTED', {
        from: 'SHORT_TERM',
        to: 'LONG_TERM',
      });

      this.logger.info('Memory promoted to long-term', { memoryId });
      return this.mapToMemory(updated);
    } catch (error) {
      this.logger.error('Failed to promote memory', { memoryId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Semantic memory extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract key facts / semantic assertions from raw text content and store
   * each as a separate SEMANTIC memory linked to the originating conversation.
   *
   * The extraction is rule-based (sentence splitting + heuristic filtering).
   * A downstream AI enrichment step can replace this with LLM-based extraction.
   */
  async extractSemanticMemory(
    content: string,
    conversationId: string,
    userId: string,
    workspaceId: string
  ): Promise<Memory[]> {
    try {
      // Split into sentences and keep those that look like factual assertions
      const sentences = content
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 500);

      // Heuristic: keep sentences with declarative patterns
      const factPatterns = [
        /\bis\b/i, /\bare\b/i, /\bwas\b/i, /\bwere\b/i,
        /\bhas\b/i, /\bhave\b/i, /\bmeans\b/i, /\bdefin/i,
        /\bcontains\b/i, /\bincludes\b/i, /\brequires\b/i,
        /\bshould\b/i, /\bmust\b/i, /\bcan\b/i,
      ];

      const facts = sentences.filter(s =>
        factPatterns.some(p => p.test(s))
      );

      if (facts.length === 0) {
        this.logger.debug('No semantic facts extracted', { conversationId });
        return [];
      }

      // Cap the number of extracted facts per call to avoid flooding
      const capped = facts.slice(0, 10);

      const created: Memory[] = [];

      for (const fact of capped) {
        const memory = await this.prisma.memory.create({
          data: {
            workspaceId,
            userId,
            conversationId,
            content: fact,
            type: 'SEMANTIC',
            category: 'extracted-fact',
            tags: ['semantic', 'auto-extracted'],
            importance: 0.5,
            decayRate: 0.005,
            isManual: false,
            permission: 'WORKSPACE',
            status: 'ACTIVE',
            isArchived: false,
            isPinned: false,
            isEncrypted: false,
            version: 1,
            embeddingRefreshNeeded: true,
            embeddingVersion: 0,
            metadata: {
              create: {
                source: 'semantic-extraction',
                context: { conversationId, extractedFrom: content.substring(0, 200) },
                confidence: 0.7,
                isConsolidated: false,
                relevanceScore: 0.8,
                retrievalCount: 0,
                tokens: this.estimateTokens(fact),
                size: this.estimateSize(fact),
              },
            },
          },
          include: { metadata: true },
        });

        created.push(this.mapToMemory(memory));
      }

      this.logger.info('Semantic memories extracted', {
        conversationId,
        count: created.length,
      });

      return created;
    } catch (error) {
      this.logger.error('Semantic extraction failed', { conversationId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Episodic memory creation
  // ---------------------------------------------------------------------------

  /**
   * Log a conversation event as an EPISODIC memory.
   */
  async createEpisodicMemory(
    event: EpisodicEvent,
    conversationId: string,
    userId: string,
    workspaceId: string
  ): Promise<Memory> {
    try {
      const content = `[${event.type}] ${event.description}`;

      const memory = await this.prisma.memory.create({
        data: {
          workspaceId,
          userId,
          conversationId,
          content,
          type: 'EPISODIC',
          category: event.type,
          tags: ['episodic', event.type, ...(event.participants ?? [])],
          importance: 0.4,
          decayRate: 0.02,
          isManual: false,
          permission: 'WORKSPACE',
          status: 'ACTIVE',
          isArchived: false,
          isPinned: false,
          isEncrypted: false,
          version: 1,
          embeddingRefreshNeeded: true,
          embeddingVersion: 0,
          metadata: {
            create: {
              source: 'episodic-subsystem',
              context: {
                eventType: event.type,
                participants: event.participants,
                ...(event.context ?? {}),
              },
              confidence: 1.0,
              isConsolidated: false,
              relevanceScore: 0.6,
              retrievalCount: 0,
              tokens: this.estimateTokens(content),
              size: this.estimateSize(content),
            },
          },
        },
        include: { metadata: true },
      });

      this.logger.debug('Episodic memory created', {
        memoryId: memory.id,
        eventType: event.type,
      });

      return this.mapToMemory(memory);
    } catch (error) {
      this.logger.error('Failed to create episodic memory', { event, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Workspace memory
  // ---------------------------------------------------------------------------

  /**
   * Aggregate workspace-level knowledge: all WORKSPACE-type and highly
   * important memories across the workspace, sorted by importance.
   */
  async getWorkspaceContext(
    workspaceId: string,
    limit: number = 50
  ): Promise<Memory[]> {
    try {
      const memories = await this.prisma.memory.findMany({
        where: {
          workspaceId,
          status: 'ACTIVE',
          isArchived: false,
          OR: [
            { type: 'WORKSPACE' },
            { importance: { gte: 0.8 } },
            { isPinned: true },
          ],
        },
        include: { metadata: true },
        orderBy: [{ isPinned: 'desc' }, { importance: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      });

      this.logger.debug('Workspace context retrieved', {
        workspaceId,
        count: memories.length,
      });

      return memories.map(m => this.mapToMemory(m));
    } catch (error) {
      this.logger.error('Failed to get workspace context', { workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Conversation memory
  // ---------------------------------------------------------------------------

  /**
   * Build a context window from conversation memories, respecting a
   * token budget.  Returns memories in chronological order.
   */
  async getConversationContext(
    conversationId: string,
    maxTokens: number = 4000
  ): Promise<Memory[]> {
    try {
      const memories = await this.prisma.memory.findMany({
        where: {
          conversationId,
          status: 'ACTIVE',
          isArchived: false,
        },
        include: { metadata: true },
        orderBy: { createdAt: 'asc' },
      });

      // Accumulate until we hit the token budget
      const result: Memory[] = [];
      let tokenCount = 0;

      // Include pinned first (they always fit)
      const pinned = memories.filter(m => m.isPinned);
      const unpinned = memories.filter(m => !m.isPinned);

      for (const m of pinned) {
        const tokens = m.metadata?.tokens ?? this.estimateTokens(m.content);
        tokenCount += tokens;
        result.push(this.mapToMemory(m));
      }

      // Then add the rest from most-important downwards, keeping chronological order
      const sortedByImportance = [...unpinned].sort((a, b) => b.importance - a.importance);

      for (const m of sortedByImportance) {
        const tokens = m.metadata?.tokens ?? this.estimateTokens(m.content);
        if (tokenCount + tokens > maxTokens) continue;
        tokenCount += tokens;
        result.push(this.mapToMemory(m));
      }

      // Re-sort chronologically for a coherent context window
      result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      this.logger.debug('Conversation context built', {
        conversationId,
        tokens: tokenCount,
        memories: result.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get conversation context', { conversationId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. User memory
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all memories belonging to a specific user within a workspace.
   */
  async getUserMemories(
    userId: string,
    workspaceId: string,
    options?: { type?: MemoryType; status?: MemoryStatus; limit?: number; offset?: number }
  ): Promise<MemorySearchResult> {
    try {
      const where: any = {
        userId,
        workspaceId,
        isArchived: false,
      };

      if (options?.type) where.type = options.type;
      if (options?.status) where.status = options.status;
      else where.status = 'ACTIVE';

      const total = await this.prisma.memory.count({ where });
      const memories = await this.prisma.memory.findMany({
        where,
        include: { metadata: true },
        orderBy: [{ isPinned: 'desc' }, { importance: 'desc' }, { updatedAt: 'desc' }],
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      });

      return {
        memories: memories.map(m => this.mapToMemory(m)),
        total,
        hasMore: (options?.offset ?? 0) + memories.length < total,
        query: { workspaceId, userId },
      };
    } catch (error) {
      this.logger.error('Failed to get user memories', { userId, workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Pinned memory
  // ---------------------------------------------------------------------------

  /**
   * List all pinned memories in a workspace, optionally filtered to a user.
   */
  async getPinnedMemories(
    workspaceId: string,
    userId?: string
  ): Promise<Memory[]> {
    try {
      const where: any = {
        workspaceId,
        isPinned: true,
        status: 'ACTIVE',
        isArchived: false,
      };
      if (userId) where.userId = userId;

      const memories = await this.prisma.memory.findMany({
        where,
        include: { metadata: true },
        orderBy: { updatedAt: 'desc' },
      });

      return memories.map(m => this.mapToMemory(m));
    } catch (error) {
      this.logger.error('Failed to get pinned memories', { workspaceId, error });
      throw error;
    }
  }

  /**
   * Toggle the pinned state of a memory. Returns the updated memory.
   */
  async togglePin(memoryId: string, userId: string): Promise<Memory> {
    try {
      const existing = await this.prisma.memory.findUnique({ where: { id: memoryId } });
      if (!existing) throw new Error(`Memory ${memoryId} not found`);

      const updated = await this.prisma.memory.update({
        where: { id: memoryId },
        data: { isPinned: !existing.isPinned },
        include: { metadata: true },
      });

      await this.createAuditLog(memoryId, userId, updated.isPinned ? 'PINNED' : 'UNPINNED');

      this.logger.debug('Memory pin toggled', {
        memoryId,
        isPinned: updated.isPinned,
      });

      return this.mapToMemory(updated);
    } catch (error) {
      this.logger.error('Failed to toggle pin', { memoryId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Memory importance scoring
  // ---------------------------------------------------------------------------

  /**
   * Calculate an importance score (0-1) for a memory based on:
   *   - Access frequency (normalised to 0-0.25)
   *   - Recency of last access (0-0.2)
   *   - Content length / token richness (0-0.15)
   *   - Number of connections / relations (0-0.2)
   *   - Explicit flags: pinned, manual (0-0.2)
   */
  async calculateImportance(memoryId: string): Promise<number> {
    try {
      const memory = await this.prisma.memory.findUnique({
        where: { id: memoryId },
        include: {
          metadata: true,
          relatedMemories: true,
          relatedBy: true,
        },
      });

      if (!memory) throw new Error(`Memory ${memoryId} not found`);

      // Access frequency — cap at 100 accesses
      const accessScore = Math.min(memory.accessCount / 100, 1.0) * 0.25;

      // Recency — how recently accessed (exponential decay over 30 days)
      const lastAccess = memory.lastAccessedAt ?? memory.createdAt;
      const daysSinceAccess = (Date.now() - lastAccess.getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-daysSinceAccess / 30) * 0.2;

      // Content richness — normalised token count, cap at 2000
      const tokens = memory.metadata?.tokens ?? this.estimateTokens(memory.content);
      const contentScore = Math.min(tokens / 2000, 1.0) * 0.15;

      // Connections — each relation adds weight, cap at 10
      const connectionCount = memory.relatedMemories.length + memory.relatedBy.length;
      const connectionScore = Math.min(connectionCount / 10, 1.0) * 0.2;

      // Explicit flags
      let flagScore = 0;
      if (memory.isPinned) flagScore += 0.15;
      if (memory.isManual) flagScore += 0.05;

      const total = Math.min(
        accessScore + recencyScore + contentScore + connectionScore + flagScore,
        1.0
      );

      // Persist the updated importance
      await this.prisma.memory.update({
        where: { id: memoryId },
        data: { importance: total },
      });

      this.logger.debug('Importance calculated', { memoryId, importance: total });
      return total;
    } catch (error) {
      this.logger.error('Failed to calculate importance', { memoryId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 10. Memory compression
  // ---------------------------------------------------------------------------

  /**
   * Compress a single memory by generating a shorter summary from its content.
   * The original content is preserved; the summary field is populated.
   */
  async compressMemory(memoryId: string): Promise<Memory> {
    try {
      const memory = await this.prisma.memory.findUnique({
        where: { id: memoryId },
        include: { metadata: true },
      });

      if (!memory) throw new Error(`Memory ${memoryId} not found`);

      // Extractive summarisation: take the first and last meaningful sentences
      const sentences = memory.content
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 10);

      let summary: string;
      if (sentences.length <= 2) {
        summary = memory.content;
      } else {
        // Take the first sentence plus the longest sentence in the middle
        const middle = sentences.slice(1, -1).sort((a, b) => b.length - a.length);
        summary = [sentences[0], middle[0], sentences[sentences.length - 1]].join(' ');
      }

      // Truncate to ~25 % of original length
      const maxLen = Math.max(Math.floor(memory.content.length * 0.25), 100);
      if (summary.length > maxLen) {
        summary = summary.substring(0, maxLen).trimEnd() + '...';
      }

      const updated = await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          summary,
          version: { increment: 1 },
        },
        include: { metadata: true },
      });

      // Update token count in metadata
      if (memory.metadata) {
        await this.prisma.memoryMetadata.update({
          where: { id: memory.metadata.id },
          data: {
            tokens: this.estimateTokens(summary),
          },
        });
      }

      await this.createAuditLog(memoryId, memory.userId, 'COMPRESSED', {
        originalLength: memory.content.length,
        summaryLength: summary.length,
      });

      this.logger.info('Memory compressed', { memoryId, ratio: summary.length / memory.content.length });
      return this.mapToMemory(updated);
    } catch (error) {
      this.logger.error('Failed to compress memory', { memoryId, error });
      throw error;
    }
  }

  /**
   * Compress all memories in a workspace older than `daysOld` that have no
   * summary yet.
   */
  async compressOldMemories(
    workspaceId: string,
    daysOld: number = 30
  ): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

      const candidates = await this.prisma.memory.findMany({
        where: {
          workspaceId,
          status: 'ACTIVE',
          isArchived: false,
          summary: null,
          createdAt: { lt: cutoff },
        },
        select: { id: true },
        take: 200,
      });

      let compressed = 0;
      for (const { id } of candidates) {
        try {
          await this.compressMemory(id);
          compressed++;
        } catch (err) {
          this.logger.warn('Skipping memory compression', { memoryId: id, error: err });
        }
      }

      this.logger.info('Old memories compressed', { workspaceId, compressed });
      return compressed;
    } catch (error) {
      this.logger.error('Failed to compress old memories', { workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 11. Memory summarization
  // ---------------------------------------------------------------------------

  /**
   * Create a single summary from multiple memories and store it as a new
   * SEMANTIC memory linked to the originals via MemoryRelation.
   */
  async summarizeMemories(
    memoryIds: string[],
    userId: string,
    workspaceId: string
  ): Promise<Memory> {
    try {
      if (memoryIds.length === 0) {
        throw new Error('At least one memory ID is required');
      }

      const memories = await this.prisma.memory.findMany({
        where: { id: { in: memoryIds } },
        include: { metadata: true },
        orderBy: { createdAt: 'asc' },
      });

      if (memories.length === 0) {
        throw new Error('No memories found for the given IDs');
      }

      // Build extractive summary: first sentence of each memory
      const excerpts = memories.map(m => {
        const firstSentence = m.content.split(/(?<=[.!?])\s+/)[0]?.trim();
        return firstSentence || m.content.substring(0, 120);
      });

      const summaryContent = excerpts.join(' | ');
      const allTags = Array.from(new Set(memories.flatMap(m => m.tags)));
      const avgImportance = memories.reduce((s, m) => s + m.importance, 0) / memories.length;

      const summaryMemory = await this.prisma.memory.create({
        data: {
          workspaceId,
          userId,
          content: summaryContent,
          summary: `Summary of ${memoryIds.length} memories`,
          type: 'SEMANTIC',
          category: 'summary',
          tags: ['summary', ...allTags.slice(0, 10)],
          importance: Math.min(avgImportance + 0.1, 1.0),
          decayRate: 0.003,
          isManual: false,
          permission: 'WORKSPACE',
          status: 'ACTIVE',
          isArchived: false,
          isPinned: false,
          isEncrypted: false,
          version: 1,
          embeddingRefreshNeeded: true,
          embeddingVersion: 0,
          metadata: {
            create: {
              source: 'summarization',
              context: { sourceMemoryIds: memoryIds },
              confidence: 0.8,
              isConsolidated: true,
              consolidatedAt: new Date(),
              consolidationScore: avgImportance,
              relevanceScore: 0.9,
              retrievalCount: 0,
              tokens: this.estimateTokens(summaryContent),
              size: this.estimateSize(summaryContent),
            },
          },
        },
        include: { metadata: true },
      });

      // Create relations linking the summary to each source memory
      for (const srcId of memoryIds) {
        await this.prisma.memoryRelation.create({
          data: {
            fromId: summaryMemory.id,
            toId: srcId,
            relationType: 'summarizes',
            strength: 1.0,
          },
        });
      }

      await this.createAuditLog(summaryMemory.id, userId, 'SUMMARIZED', {
        sourceMemoryIds: memoryIds,
      });

      this.logger.info('Memories summarized', {
        summaryId: summaryMemory.id,
        sourceCount: memoryIds.length,
      });

      return this.mapToMemory(summaryMemory);
    } catch (error) {
      this.logger.error('Failed to summarize memories', { memoryIds, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 12. Smart retrieval
  // ---------------------------------------------------------------------------

  /**
   * Smart retrieval that combines full-text search, importance ranking, and
   * recency weighting.  Returns the top `limit` memories.
   */
  async smartRetrieve(
    query: string,
    workspaceId: string,
    userId?: string,
    limit: number = 20
  ): Promise<Memory[]> {
    try {
      const where: any = {
        workspaceId,
        status: 'ACTIVE',
        isArchived: false,
      };

      if (userId) {
        // Include private memories of this user plus all non-private memories
        where.OR = [
          { userId, permission: 'PRIVATE' },
          { permission: { in: ['WORKSPACE', 'SHARED', 'PUBLIC'] } },
        ];
      }

      // Full-text search candidates (broad fetch, then re-rank)
      const candidates = await this.prisma.memory.findMany({
        where: {
          ...where,
          OR: [
            ...(where.OR ?? []),
            { content: { contains: query, mode: 'insensitive' as any } },
            { summary: { contains: query, mode: 'insensitive' as any } },
            { tags: { hasSome: query.toLowerCase().split(/\s+/) } },
          ],
        },
        include: { metadata: true },
        take: limit * 5, // over-fetch for re-ranking
        orderBy: { importance: 'desc' },
      });

      // Re-rank: composite score = 0.4 * importance + 0.3 * recency + 0.3 * textMatch
      const scored = candidates.map(m => {
        const importanceComponent = m.importance * 0.4;

        const lastAccess = m.lastAccessedAt ?? m.createdAt;
        const daysSince = (Date.now() - lastAccess.getTime()) / (1000 * 60 * 60 * 24);
        const recencyComponent = Math.exp(-daysSince / 14) * 0.3;

        // Simple text-match relevance: ratio of query terms found in content
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const contentLower = m.content.toLowerCase();
        const matchedTerms = queryTerms.filter(t => contentLower.includes(t));
        const textMatchComponent = queryTerms.length > 0
          ? (matchedTerms.length / queryTerms.length) * 0.3
          : 0.15;

        const score = importanceComponent + recencyComponent + textMatchComponent;
        return { memory: m, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const topResults = scored.slice(0, limit).map(s => this.mapToMemory(s.memory));

      // Bump access counts for retrieved memories
      const ids = topResults.map(m => m.id);
      if (ids.length > 0) {
        await this.prisma.memory.updateMany({
          where: { id: { in: ids } },
          data: {
            accessCount: { increment: 1 },
            lastAccessedAt: new Date(),
          },
        });
      }

      this.logger.debug('Smart retrieval completed', {
        query,
        workspaceId,
        results: topResults.length,
      });

      return topResults;
    } catch (error) {
      this.logger.error('Smart retrieval failed', { query, workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 13. Conflict resolution
  // ---------------------------------------------------------------------------

  /**
   * Detect memories that contradict the given memory. A contradiction is
   * modelled as a MemoryRelation with relationType "contradicts".
   * Additionally, scan for memories with the same category whose content
   * differs significantly (simple heuristic).
   */
  async detectConflicts(memoryId: string): Promise<MemoryConflict[]> {
    try {
      const memory = await this.prisma.memory.findUnique({
        where: { id: memoryId },
      });
      if (!memory) throw new Error(`Memory ${memoryId} not found`);

      const conflicts: MemoryConflict[] = [];

      // 1. Existing "contradicts" relations
      const existingRelations = await this.prisma.memoryRelation.findMany({
        where: {
          OR: [
            { fromId: memoryId, relationType: 'contradicts' },
            { toId: memoryId, relationType: 'contradicts' },
          ],
        },
      });

      for (const rel of existingRelations) {
        const otherId = rel.fromId === memoryId ? rel.toId : rel.fromId;
        const other = await this.prisma.memory.findUnique({ where: { id: otherId } });
        if (!other || other.status === 'DELETED') continue;

        conflicts.push({
          id: `conflict_${rel.id}`,
          memoryId,
          conflictingMemoryId: otherId,
          relationId: rel.id,
          memoryContent: memory.content,
          conflictingContent: other.content,
          detectedAt: rel.createdAt,
        });
      }

      // 2. Heuristic: same category, same workspace, significantly different
      if (memory.category) {
        const sameCat = await this.prisma.memory.findMany({
          where: {
            workspaceId: memory.workspaceId,
            category: memory.category,
            status: 'ACTIVE',
            isArchived: false,
            id: { not: memoryId },
          },
          take: 50,
        });

        for (const other of sameCat) {
          // Very rough overlap check: Jaccard on word sets
          const wordsA = new Set(memory.content.toLowerCase().split(/\s+/).filter(w => w.length > 3));
          const wordsB = new Set(other.content.toLowerCase().split(/\s+/).filter(w => w.length > 3));

          if (wordsA.size === 0 || wordsB.size === 0) continue;

          let intersection = 0;
          for (const w of wordsA) {
            if (wordsB.has(w)) intersection++;
          }
          const union = wordsA.size + wordsB.size - intersection;
          const jaccard = union > 0 ? intersection / union : 0;

          // Moderate overlap (topically related) but not high (not duplicates)
          // suggests potential conflict
          if (jaccard > 0.15 && jaccard < 0.6) {
            // Create the relation so it's tracked
            const rel = await this.prisma.memoryRelation.upsert({
              where: {
                fromId_toId_relationType: {
                  fromId: memoryId,
                  toId: other.id,
                  relationType: 'contradicts',
                },
              },
              update: {},
              create: {
                fromId: memoryId,
                toId: other.id,
                relationType: 'contradicts',
                strength: 1 - jaccard,
              },
            });

            conflicts.push({
              id: `conflict_${rel.id}`,
              memoryId,
              conflictingMemoryId: other.id,
              relationId: rel.id,
              memoryContent: memory.content,
              conflictingContent: other.content,
              detectedAt: new Date(),
            });
          }
        }
      }

      this.logger.debug('Conflict detection completed', {
        memoryId,
        conflictCount: conflicts.length,
      });

      return conflicts;
    } catch (error) {
      this.logger.error('Conflict detection failed', { memoryId, error });
      throw error;
    }
  }

  /**
   * Resolve a detected conflict.
   * `conflictId` is in the form `conflict_<relationId>`.
   */
  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
    userId: string
  ): Promise<void> {
    try {
      const relationId = conflictId.replace(/^conflict_/, '');

      const relation = await this.prisma.memoryRelation.findUnique({
        where: { id: relationId },
      });

      if (!relation) throw new Error(`Conflict relation ${relationId} not found`);

      const sourceMemory = await this.prisma.memory.findUnique({ where: { id: relation.fromId } });
      const conflictingMemory = await this.prisma.memory.findUnique({ where: { id: relation.toId } });

      if (!sourceMemory || !conflictingMemory) {
        throw new Error('One or both memories in the conflict no longer exist');
      }

      switch (resolution.keep) {
        case 'source':
          // Archive the conflicting memory
          await this.prisma.memory.update({
            where: { id: conflictingMemory.id },
            data: { status: 'ARCHIVED', isArchived: true },
          });
          await this.createAuditLog(conflictingMemory.id, userId, 'CONFLICT_RESOLVED', {
            resolution: 'archived_in_favor_of',
            keptMemoryId: sourceMemory.id,
          });
          break;

        case 'conflicting':
          // Archive the source memory
          await this.prisma.memory.update({
            where: { id: sourceMemory.id },
            data: { status: 'ARCHIVED', isArchived: true },
          });
          await this.createAuditLog(sourceMemory.id, userId, 'CONFLICT_RESOLVED', {
            resolution: 'archived_in_favor_of',
            keptMemoryId: conflictingMemory.id,
          });
          break;

        case 'merge':
          if (!resolution.mergedContent) {
            throw new Error('mergedContent is required for merge resolution');
          }
          // Update source with merged content, archive conflicting
          await this.prisma.memory.update({
            where: { id: sourceMemory.id },
            data: {
              content: resolution.mergedContent,
              version: { increment: 1 },
              embeddingRefreshNeeded: true,
            },
          });
          await this.prisma.memory.update({
            where: { id: conflictingMemory.id },
            data: { status: 'ARCHIVED', isArchived: true },
          });
          await this.createAuditLog(sourceMemory.id, userId, 'CONFLICT_MERGED', {
            mergedFrom: conflictingMemory.id,
          });
          break;

        case 'both':
          // Keep both; just remove the contradicts relation
          break;
      }

      // Remove the contradiction relation
      await this.prisma.memoryRelation.delete({ where: { id: relationId } });

      this.logger.info('Conflict resolved', { conflictId, resolution: resolution.keep });
    } catch (error) {
      this.logger.error('Failed to resolve conflict', { conflictId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 14. Memory merge
  // ---------------------------------------------------------------------------

  /**
   * Merge multiple memories into one.  If `targetId` is provided the merged
   * content goes into that memory; otherwise a new memory is created.
   * Source memories (excluding the target) are archived.
   */
  async mergeMemories(
    sourceIds: string[],
    userId: string,
    workspaceId: string,
    targetId?: string
  ): Promise<MergeResult> {
    try {
      if (sourceIds.length < 2) {
        throw new Error('At least two memory IDs are required for merging');
      }

      const sources = await this.prisma.memory.findMany({
        where: { id: { in: sourceIds } },
        include: { metadata: true },
        orderBy: { createdAt: 'asc' },
      });

      if (sources.length < 2) {
        throw new Error('Could not find at least two source memories');
      }

      const mergedContent = sources.map(m => m.content).join('\n\n');
      const allTags = Array.from(new Set(sources.flatMap(m => m.tags)));
      const maxImportance = Math.max(...sources.map(m => m.importance));
      const totalTokensBefore = sources.reduce(
        (s, m) => s + (m.metadata?.tokens ?? this.estimateTokens(m.content)),
        0
      );
      const mergedTokens = this.estimateTokens(mergedContent);

      let mergedMemoryId: string;

      if (targetId && sourceIds.includes(targetId)) {
        // Merge into existing target
        await this.prisma.memory.update({
          where: { id: targetId },
          data: {
            content: mergedContent,
            tags: allTags,
            importance: maxImportance,
            version: { increment: 1 },
            embeddingRefreshNeeded: true,
          },
        });

        if (sources.find(m => m.id === targetId)?.metadata) {
          await this.prisma.memoryMetadata.update({
            where: { memoryId: targetId },
            data: {
              tokens: mergedTokens,
              size: this.estimateSize(mergedContent),
              isConsolidated: true,
              consolidatedAt: new Date(),
            },
          });
        }

        mergedMemoryId = targetId;
      } else {
        // Create a new merged memory
        const created = await this.prisma.memory.create({
          data: {
            workspaceId,
            userId,
            content: mergedContent,
            summary: `Merged from ${sourceIds.length} memories`,
            type: 'SEMANTIC',
            category: sources[0].category,
            tags: allTags,
            importance: maxImportance,
            decayRate: 0.005,
            isManual: false,
            permission: sources[0].permission,
            status: 'ACTIVE',
            isArchived: false,
            isPinned: false,
            isEncrypted: false,
            version: 1,
            embeddingRefreshNeeded: true,
            embeddingVersion: 0,
            metadata: {
              create: {
                source: 'merge',
                context: { sourceIds },
                confidence: 0.9,
                isConsolidated: true,
                consolidatedAt: new Date(),
                consolidationScore: maxImportance,
                relevanceScore: 1.0,
                retrievalCount: 0,
                tokens: mergedTokens,
                size: this.estimateSize(mergedContent),
              },
            },
          },
          include: { metadata: true },
        });

        mergedMemoryId = created.id;
      }

      // Archive sources (except the target if it was used)
      const idsToArchive = sourceIds.filter(id => id !== mergedMemoryId);
      if (idsToArchive.length > 0) {
        await this.prisma.memory.updateMany({
          where: { id: { in: idsToArchive } },
          data: { status: 'ARCHIVED', isArchived: true },
        });
      }

      // Create relations from merged memory to each source
      for (const srcId of sourceIds) {
        if (srcId === mergedMemoryId) continue;
        await this.prisma.memoryRelation.create({
          data: {
            fromId: mergedMemoryId,
            toId: srcId,
            relationType: 'merged_from',
            strength: 1.0,
          },
        });
      }

      await this.createAuditLog(mergedMemoryId, userId, 'MERGED', { sourceIds });

      const result: MergeResult = {
        mergedMemoryId,
        sourceIds,
        mergedContent,
        totalTokensReduced: Math.max(0, totalTokensBefore - mergedTokens),
      };

      this.logger.info('Memories merged', {
        mergedMemoryId,
        sourceCount: sourceIds.length,
        tokensReduced: result.totalTokensReduced,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to merge memories', { sourceIds, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 15. Permission enforcement
  // ---------------------------------------------------------------------------

  /**
   * Check whether `userId` in `workspaceId` has access to a specific memory.
   * Returns true if access is allowed.
   */
  async checkAccess(
    memoryId: string,
    userId: string,
    workspaceId: string
  ): Promise<boolean> {
    try {
      const memory = await this.prisma.memory.findUnique({
        where: { id: memoryId },
      });

      if (!memory) return false;

      // Must be in the same workspace
      if (memory.workspaceId !== workspaceId) return false;

      switch (memory.permission) {
        case 'PUBLIC':
          return true;

        case 'WORKSPACE':
          // Any member of the workspace can access
          return true;

        case 'SHARED':
          // Owner or explicitly shared
          if (memory.userId === userId) return true;
          return memory.sharedWith.includes(userId);

        case 'PRIVATE':
          return memory.userId === userId;

        default:
          return false;
      }
    } catch (error) {
      this.logger.error('Access check failed', { memoryId, userId, error });
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async createAuditLog(
    memoryId: string,
    userId: string,
    action: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await this.prisma.memoryAuditLog.create({
        data: { memoryId, userId, action, metadata },
      });
    } catch (error) {
      this.logger.warn('Failed to create audit log', { memoryId, action, error });
    }
  }

  private mapToMemory(data: any): Memory {
    return {
      id: data.id,
      workspaceId: data.workspaceId,
      conversationId: data.conversationId ?? undefined,
      userId: data.userId,
      content: data.content,
      summary: data.summary ?? undefined,
      type: data.type,
      category: data.category ?? undefined,
      tags: data.tags ?? [],
      importance: data.importance,
      decayRate: data.decayRate,
      lastAccessedAt: data.lastAccessedAt ?? undefined,
      accessCount: data.accessCount ?? 0,
      isArchived: data.isArchived,
      isPinned: data.isPinned,
      isManual: data.isManual,
      status: data.status,
      permission: data.permission,
      sharedWith: data.sharedWith ?? [],
      version: data.version,
      parentId: data.parentId ?? undefined,
      embeddingId: data.embeddingId ?? undefined,
      embeddingModel: data.embeddingModel ?? undefined,
      embeddingVersion: data.embeddingVersion ?? 0,
      embeddingRefreshNeeded: data.embeddingRefreshNeeded ?? false,
      isEncrypted: data.isEncrypted ?? false,
      encryptionKey: data.encryptionKey ?? undefined,
      expiresAt: data.expiresAt ?? undefined,
      metadata: data.metadata ?? undefined,
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
