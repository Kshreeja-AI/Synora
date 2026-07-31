/**
 * Memory Lifecycle Service
 * Handles GDPR erasure, batch operations, failure recovery, vector sync,
 * stale-memory refresh, versioning, export/import, and analytics enrichment.
 */

import { PrismaClient } from '@prisma/client';
import {
  Memory,
  MemoryType,
  MemoryStatus,
  MemoryAnalytics,
} from './types';

/** Receipt returned after a GDPR erasure */
interface GdprEraseReceipt {
  userId: string;
  workspaceId: string;
  memoriesDeleted: number;
  auditLogsDeleted: number;
  metadataDeleted: number;
  relationsDeleted: number;
  embeddingsCleared: number;
  erasedAt: Date;
}

/** Input for a single batch-create entry */
interface BatchCreateInput {
  content: string;
  type: MemoryType;
  category?: string;
  tags?: string[];
  importance?: number;
  decayRate?: number;
  conversationId?: string;
  permission?: 'PRIVATE' | 'WORKSPACE' | 'SHARED' | 'PUBLIC';
  expiresAt?: Date;
}

/** Input for a single batch-update entry */
interface BatchUpdateInput {
  id: string;
  content?: string;
  summary?: string;
  tags?: string[];
  importance?: number;
  status?: MemoryStatus;
}

/** Health check result */
interface HealthCheckResult {
  healthy: boolean;
  totalMemories: number;
  activeMemories: number;
  stuckConsolidating: number;
  orphanedMetadata: number;
  embeddingsNeeded: number;
  expiredNotCleaned: number;
  issues: string[];
}

/** Version history entry */
interface MemoryVersion {
  versionNumber: number;
  content: string;
  summary?: string;
  importance: number;
  createdAt: Date;
  memoryId: string;
}

/** Detailed analytics with richer breakdowns */
interface DetailedAnalytics extends MemoryAnalytics {
  memoriesByUser: Record<string, number>;
  memoriesByMonth: Record<string, number>;
  averageAccessCount: number;
  topCategories: Array<{ category: string; count: number }>;
  pinnedCount: number;
  manualCount: number;
  automaticCount: number;
  averageTokensPerMemory: number;
  oldestMemoryDate: Date | null;
  newestMemoryDate: Date | null;
}

export class MemoryLifecycleService {
  constructor(
    private prisma: PrismaClient,
    private logger: any
  ) {}

  // ---------------------------------------------------------------------------
  // 1. GDPR erase
  // ---------------------------------------------------------------------------

  /**
   * Hard-delete ALL data associated with a user inside a workspace:
   * memories, audit logs, metadata, relations, and embedding references.
   * Returns an immutable receipt for compliance records.
   */
  async gdprErase(userId: string, workspaceId: string): Promise<GdprEraseReceipt> {
    try {
      this.logger.info('Starting GDPR erasure', { userId, workspaceId });

      // Find all memory IDs for this user in the workspace
      const memories = await this.prisma.memory.findMany({
        where: { userId, workspaceId },
        select: { id: true },
      });

      const memoryIds = memories.map(m => m.id);

      // Delete audit logs (they reference the memory)
      const auditResult = await this.prisma.memoryAuditLog.deleteMany({
        where: {
          OR: [
            { memoryId: { in: memoryIds } },
            { userId },
          ],
        },
      });

      // Delete metadata
      const metadataResult = await this.prisma.memoryMetadata.deleteMany({
        where: { memoryId: { in: memoryIds } },
      });

      // Delete relations (from or to)
      const relationsResult = await this.prisma.memoryRelation.deleteMany({
        where: {
          OR: [
            { fromId: { in: memoryIds } },
            { toId: { in: memoryIds } },
          ],
        },
      });

      // Delete cache entries
      await this.prisma.memoryCache.deleteMany({
        where: { memoryId: { in: memoryIds } },
      });

      // Delete exports belonging to this user in the workspace
      await this.prisma.memoryExport.deleteMany({
        where: { userId, workspaceId },
      });

      // Finally delete the memories themselves
      const memoriesResult = await this.prisma.memory.deleteMany({
        where: { userId, workspaceId },
      });

      // Update workspace quota
      try {
        await this.prisma.memoryQuota.update({
          where: { workspaceId },
          data: {
            currentMemories: { decrement: memoriesResult.count },
          },
        });
      } catch {
        // Quota record may not exist; non-fatal
        this.logger.warn('Could not update quota after GDPR erase', { workspaceId });
      }

      const receipt: GdprEraseReceipt = {
        userId,
        workspaceId,
        memoriesDeleted: memoriesResult.count,
        auditLogsDeleted: auditResult.count,
        metadataDeleted: metadataResult.count,
        relationsDeleted: relationsResult.count,
        embeddingsCleared: memoryIds.length,
        erasedAt: new Date(),
      };

      this.logger.info('GDPR erasure completed', receipt);
      return receipt;
    } catch (error) {
      this.logger.error('GDPR erasure failed', { userId, workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Batch processing
  // ---------------------------------------------------------------------------

  /**
   * Create multiple memories in a single call. Each entry gets its own
   * metadata record. Returns the created Memory objects.
   */
  async batchCreate(
    inputs: BatchCreateInput[],
    userId: string,
    workspaceId: string
  ): Promise<Memory[]> {
    try {
      if (inputs.length === 0) return [];

      // Validate quota up-front
      const quota = await this.prisma.memoryQuota.findUnique({
        where: { workspaceId },
      });

      if (quota && quota.currentMemories + inputs.length > quota.maxMemories) {
        throw new Error(
          `Batch would exceed memory quota: ${quota.currentMemories} + ${inputs.length} > ${quota.maxMemories}`
        );
      }

      const created: Memory[] = [];

      // Use a transaction for atomicity
      await this.prisma.$transaction(async (tx) => {
        for (const input of inputs) {
          const memory = await tx.memory.create({
            data: {
              workspaceId,
              userId,
              conversationId: input.conversationId,
              content: input.content,
              type: input.type,
              category: input.category,
              tags: input.tags ?? [],
              importance: input.importance ?? 0.5,
              decayRate: input.decayRate ?? 0.01,
              isManual: false,
              permission: input.permission ?? 'PRIVATE',
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
                  source: 'batch-create',
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

          created.push(this.mapToMemory(memory));
        }

        // Update quota
        if (quota) {
          const totalTokens = inputs.reduce(
            (sum, i) => sum + this.estimateTokens(i.content), 0
          );
          const totalSize = inputs.reduce(
            (sum, i) => sum + this.estimateSize(i.content), 0
          );

          await tx.memoryQuota.update({
            where: { workspaceId },
            data: {
              currentMemories: { increment: inputs.length },
              currentTokens: { increment: totalTokens },
              currentStorage: { increment: totalSize },
            },
          });
        }
      });

      this.logger.info('Batch create completed', {
        workspaceId,
        count: created.length,
      });

      return created;
    } catch (error) {
      this.logger.error('Batch create failed', { workspaceId, count: inputs.length, error });
      throw error;
    }
  }

  /**
   * Update multiple memories in a single transactional call.
   */
  async batchUpdate(updates: BatchUpdateInput[]): Promise<Memory[]> {
    try {
      if (updates.length === 0) return [];

      const results: Memory[] = [];

      await this.prisma.$transaction(async (tx) => {
        for (const upd of updates) {
          const data: any = {};
          if (upd.content !== undefined) {
            data.content = upd.content;
            data.embeddingRefreshNeeded = true;
            data.version = { increment: 1 };
          }
          if (upd.summary !== undefined) data.summary = upd.summary;
          if (upd.tags !== undefined) data.tags = upd.tags;
          if (upd.importance !== undefined) data.importance = upd.importance;
          if (upd.status !== undefined) data.status = upd.status;

          if (Object.keys(data).length === 0) continue;

          const updated = await tx.memory.update({
            where: { id: upd.id },
            data,
            include: { metadata: true },
          });

          results.push(this.mapToMemory(updated));
        }
      });

      this.logger.info('Batch update completed', { count: results.length });
      return results;
    } catch (error) {
      this.logger.error('Batch update failed', { count: updates.length, error });
      throw error;
    }
  }

  /**
   * Soft-delete multiple memories by IDs.
   */
  async batchDelete(memoryIds: string[]): Promise<number> {
    try {
      if (memoryIds.length === 0) return 0;

      const result = await this.prisma.memory.updateMany({
        where: { id: { in: memoryIds } },
        data: { status: 'DELETED', isArchived: true },
      });

      this.logger.info('Batch delete completed', { count: result.count });
      return result.count;
    } catch (error) {
      this.logger.error('Batch delete failed', { count: memoryIds.length, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Failure recovery
  // ---------------------------------------------------------------------------

  /**
   * Find memories stuck in CONSOLIDATING status and reset them to ACTIVE.
   * Returns the number of recovered records.
   */
  async recoverFailedOperations(workspaceId: string): Promise<number> {
    try {
      // Memories that have been CONSOLIDATING for more than 15 minutes are
      // considered stuck
      const stuckThreshold = new Date(Date.now() - 15 * 60 * 1000);

      const result = await this.prisma.memory.updateMany({
        where: {
          workspaceId,
          status: 'CONSOLIDATING',
          updatedAt: { lt: stuckThreshold },
        },
        data: {
          status: 'ACTIVE',
        },
      });

      if (result.count > 0) {
        this.logger.warn('Recovered stuck consolidating memories', {
          workspaceId,
          count: result.count,
        });
      }

      return result.count;
    } catch (error) {
      this.logger.error('Failed to recover operations', { workspaceId, error });
      throw error;
    }
  }

  /**
   * Perform a health check on the memory subsystem and report issues.
   */
  async checkHealth(workspaceId?: string): Promise<HealthCheckResult> {
    try {
      const where: any = {};
      if (workspaceId) where.workspaceId = workspaceId;

      const totalMemories = await this.prisma.memory.count({ where });

      const activeMemories = await this.prisma.memory.count({
        where: { ...where, status: 'ACTIVE' },
      });

      const stuckConsolidating = await this.prisma.memory.count({
        where: {
          ...where,
          status: 'CONSOLIDATING',
          updatedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });

      // Find metadata records whose parent memory no longer exists
      const allMetadata = await this.prisma.memoryMetadata.findMany({
        select: { memoryId: true },
      });
      const allMemoryIds = new Set(
        (await this.prisma.memory.findMany({
          where,
          select: { id: true },
        })).map(m => m.id)
      );
      const orphanedMetadata = allMetadata.filter(
        md => workspaceId ? !allMemoryIds.has(md.memoryId) : false
      ).length;

      const embeddingsNeeded = await this.prisma.memory.count({
        where: {
          ...where,
          embeddingRefreshNeeded: true,
          status: 'ACTIVE',
        },
      });

      const expiredNotCleaned = await this.prisma.memory.count({
        where: {
          ...where,
          expiresAt: { lt: new Date() },
          status: { not: 'EXPIRED' },
        },
      });

      const issues: string[] = [];
      if (stuckConsolidating > 0) {
        issues.push(`${stuckConsolidating} memories stuck in CONSOLIDATING status`);
      }
      if (orphanedMetadata > 0) {
        issues.push(`${orphanedMetadata} orphaned metadata records`);
      }
      if (embeddingsNeeded > 50) {
        issues.push(`${embeddingsNeeded} memories need embedding refresh`);
      }
      if (expiredNotCleaned > 0) {
        issues.push(`${expiredNotCleaned} expired memories not yet cleaned`);
      }

      const result: HealthCheckResult = {
        healthy: issues.length === 0,
        totalMemories,
        activeMemories,
        stuckConsolidating,
        orphanedMetadata,
        embeddingsNeeded,
        expiredNotCleaned,
        issues,
      };

      this.logger.debug('Health check completed', result);
      return result;
    } catch (error) {
      this.logger.error('Health check failed', { error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Vector synchronization
  // ---------------------------------------------------------------------------

  /**
   * Scan a workspace for memories whose embeddings are stale
   * (`embeddingRefreshNeeded === true`) and return their IDs.
   * Marks them with a consistent `embeddingModel` value so the
   * embedding refresh worker can pick them up.
   */
  async syncVectors(workspaceId: string): Promise<string[]> {
    try {
      const stale = await this.prisma.memory.findMany({
        where: {
          workspaceId,
          embeddingRefreshNeeded: true,
          status: 'ACTIVE',
          isArchived: false,
        },
        select: { id: true },
      });

      const ids = stale.map(m => m.id);

      if (ids.length > 0) {
        // Ensure a model is set so the refresh worker knows what to use
        await this.prisma.memory.updateMany({
          where: {
            id: { in: ids },
            embeddingModel: null,
          },
          data: {
            embeddingModel: 'text-embedding-3-small',
          },
        });
      }

      this.logger.info('Vector sync scan completed', {
        workspaceId,
        staleCount: ids.length,
      });

      return ids;
    } catch (error) {
      this.logger.error('Vector sync failed', { workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Automatic refresh
  // ---------------------------------------------------------------------------

  /**
   * Refresh stale memories in a workspace:
   *  - Recalculate importance scores
   *  - Mark expired memories
   *  - Clean up DECAYING memories below threshold
   */
  async refreshStaleMemories(
    workspaceId: string,
    staleDays: number = 14
  ): Promise<{ refreshed: number; expired: number; decayed: number }> {
    try {
      const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
      let refreshed = 0;
      let expired = 0;
      let decayed = 0;

      // 1. Mark memories past their expiresAt
      const expireResult = await this.prisma.memory.updateMany({
        where: {
          workspaceId,
          expiresAt: { lt: new Date() },
          status: { not: 'EXPIRED' },
        },
        data: { status: 'EXPIRED' },
      });
      expired = expireResult.count;

      // 2. Recalculate importance for stale active memories
      const staleMemories = await this.prisma.memory.findMany({
        where: {
          workspaceId,
          status: 'ACTIVE',
          isArchived: false,
          updatedAt: { lt: cutoff },
        },
        include: {
          metadata: true,
          relatedMemories: true,
          relatedBy: true,
        },
        take: 500,
      });

      for (const memory of staleMemories) {
        const accessScore = Math.min(memory.accessCount / 100, 1.0) * 0.25;

        const lastAccess = memory.lastAccessedAt ?? memory.createdAt;
        const daysSinceAccess = (Date.now() - lastAccess.getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-daysSinceAccess / 30) * 0.2;

        const tokens = memory.metadata?.tokens ?? this.estimateTokens(memory.content);
        const contentScore = Math.min(tokens / 2000, 1.0) * 0.15;

        const connections = memory.relatedMemories.length + memory.relatedBy.length;
        const connectionScore = Math.min(connections / 10, 1.0) * 0.2;

        let flagScore = 0;
        if (memory.isPinned) flagScore += 0.15;
        if (memory.isManual) flagScore += 0.05;

        const newImportance = Math.min(
          accessScore + recencyScore + contentScore + connectionScore + flagScore,
          1.0
        );

        // Apply decay
        const decayedImportance = newImportance * Math.exp(-memory.decayRate * daysSinceAccess);

        if (decayedImportance < 0.05 && !memory.isPinned) {
          await this.prisma.memory.update({
            where: { id: memory.id },
            data: { status: 'DECAYING', importance: decayedImportance },
          });
          decayed++;
        } else {
          await this.prisma.memory.update({
            where: { id: memory.id },
            data: { importance: decayedImportance },
          });
          refreshed++;
        }
      }

      this.logger.info('Stale memories refreshed', {
        workspaceId,
        refreshed,
        expired,
        decayed,
      });

      return { refreshed, expired, decayed };
    } catch (error) {
      this.logger.error('Stale memory refresh failed', { workspaceId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Memory versioning
  // ---------------------------------------------------------------------------

  /**
   * Get the full version history of a memory.  Versions are stored as
   * archived child records linked via `parentId`.
   */
  async getVersionHistory(memoryId: string): Promise<MemoryVersion[]> {
    try {
      // The current version
      const current = await this.prisma.memory.findUnique({
        where: { id: memoryId },
      });

      if (!current) throw new Error(`Memory ${memoryId} not found`);

      // Historical versions stored as archived children
      const archived = await this.prisma.memory.findMany({
        where: {
          parentId: memoryId,
          isArchived: true,
        },
        orderBy: { version: 'asc' },
      });

      const versions: MemoryVersion[] = archived.map(v => ({
        versionNumber: v.version,
        content: v.content,
        summary: v.summary ?? undefined,
        importance: v.importance,
        createdAt: v.createdAt,
        memoryId: v.id,
      }));

      // Add the current version at the end
      versions.push({
        versionNumber: current.version,
        content: current.content,
        summary: current.summary ?? undefined,
        importance: current.importance,
        createdAt: current.updatedAt,
        memoryId: current.id,
      });

      return versions;
    } catch (error) {
      this.logger.error('Failed to get version history', { memoryId, error });
      throw error;
    }
  }

  /**
   * Revert a memory to a specific historical version. The current content
   * is archived first, then replaced with the target version's content.
   */
  async revertToVersion(memoryId: string, targetVersion: number): Promise<Memory> {
    try {
      const current = await this.prisma.memory.findUnique({
        where: { id: memoryId },
        include: { metadata: true },
      });

      if (!current) throw new Error(`Memory ${memoryId} not found`);

      if (current.version === targetVersion) {
        return this.mapToMemory(current);
      }

      // Find the archived version
      const archived = await this.prisma.memory.findFirst({
        where: {
          parentId: memoryId,
          version: targetVersion,
          isArchived: true,
        },
      });

      if (!archived) {
        throw new Error(`Version ${targetVersion} not found for memory ${memoryId}`);
      }

      // Archive the current version before reverting
      await this.prisma.memory.create({
        data: {
          workspaceId: current.workspaceId,
          userId: current.userId,
          conversationId: current.conversationId,
          content: current.content,
          summary: current.summary,
          type: current.type,
          category: current.category,
          tags: current.tags,
          importance: current.importance,
          decayRate: current.decayRate,
          isArchived: true,
          isPinned: false,
          isManual: current.isManual,
          status: 'ARCHIVED',
          permission: current.permission,
          sharedWith: current.sharedWith,
          version: current.version,
          parentId: memoryId,
          embeddingRefreshNeeded: false,
          isEncrypted: current.isEncrypted,
        },
      });

      // Revert to the target version's content
      const reverted = await this.prisma.memory.update({
        where: { id: memoryId },
        data: {
          content: archived.content,
          summary: archived.summary,
          importance: archived.importance,
          version: { increment: 1 },
          embeddingRefreshNeeded: true,
        },
        include: { metadata: true },
      });

      await this.createAuditLog(memoryId, current.userId, 'REVERTED', {
        fromVersion: current.version,
        toVersion: targetVersion,
      });

      this.logger.info('Memory reverted', {
        memoryId,
        fromVersion: current.version,
        toVersion: targetVersion,
      });

      return this.mapToMemory(reverted);
    } catch (error) {
      this.logger.error('Failed to revert memory', { memoryId, targetVersion, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Export / Import
  // ---------------------------------------------------------------------------

  /**
   * Export all memories for a user in a workspace as a structured payload.
   * Supports JSON, markdown, and CSV formats.
   */
  async exportMemories(
    workspaceId: string,
    userId: string,
    format: 'json' | 'markdown' | 'csv'
  ): Promise<{ data: string; count: number; format: string }> {
    try {
      const memories = await this.prisma.memory.findMany({
        where: {
          workspaceId,
          userId,
          status: { not: 'DELETED' },
        },
        include: { metadata: true },
        orderBy: { createdAt: 'asc' },
      });

      let data: string;

      switch (format) {
        case 'json':
          data = JSON.stringify(
            memories.map(m => this.mapToMemory(m)),
            null,
            2
          );
          break;

        case 'markdown': {
          const lines: string[] = ['# Memory Export', ''];
          for (const m of memories) {
            lines.push(`## ${m.type} — ${m.category ?? 'uncategorised'}`);
            lines.push('');
            lines.push(m.content);
            lines.push('');
            if (m.summary) {
              lines.push(`**Summary:** ${m.summary}`);
              lines.push('');
            }
            lines.push(`- **Importance:** ${m.importance}`);
            lines.push(`- **Tags:** ${m.tags.join(', ') || 'none'}`);
            lines.push(`- **Created:** ${m.createdAt.toISOString()}`);
            lines.push(`- **Status:** ${m.status}`);
            lines.push('');
            lines.push('---');
            lines.push('');
          }
          data = lines.join('\n');
          break;
        }

        case 'csv': {
          const header = 'id,type,category,content,summary,importance,tags,status,createdAt';
          const rows = memories.map(m => {
            const escapeCsv = (s: string | null | undefined) => {
              if (!s) return '';
              return `"${s.replace(/"/g, '""')}"`;
            };
            return [
              m.id,
              m.type,
              escapeCsv(m.category),
              escapeCsv(m.content),
              escapeCsv(m.summary),
              m.importance,
              escapeCsv(m.tags.join('; ')),
              m.status,
              m.createdAt.toISOString(),
            ].join(',');
          });
          data = [header, ...rows].join('\n');
          break;
        }

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      // Record the export
      try {
        await this.prisma.memoryExport.create({
          data: {
            workspaceId,
            userId,
            format,
            status: 'completed',
            storageKey: `exports/${workspaceId}/${userId}/${Date.now()}.${format}`,
            size: Buffer.byteLength(data, 'utf-8'),
            completedAt: new Date(),
          },
        });
      } catch {
        this.logger.warn('Failed to record export metadata');
      }

      this.logger.info('Memories exported', {
        workspaceId,
        userId,
        format,
        count: memories.length,
      });

      return { data, count: memories.length, format };
    } catch (error) {
      this.logger.error('Export failed', { workspaceId, userId, format, error });
      throw error;
    }
  }

  /**
   * Import memories from a JSON payload. Each imported record is created as
   * a new memory with fresh IDs and an `imported` source tag.
   */
  async importMemories(
    workspaceId: string,
    userId: string,
    data: string,
    format: 'json'
  ): Promise<{ imported: number; failed: number; errors: string[] }> {
    try {
      if (format !== 'json') {
        throw new Error(`Import is only supported for JSON format, got: ${format}`);
      }

      let parsed: any[];
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new Error('Invalid JSON payload');
      }

      if (!Array.isArray(parsed)) {
        throw new Error('JSON payload must be an array of memory objects');
      }

      let imported = 0;
      let failed = 0;
      const errors: string[] = [];

      for (let i = 0; i < parsed.length; i++) {
        const entry = parsed[i];
        try {
          if (!entry.content || typeof entry.content !== 'string') {
            throw new Error('Missing or invalid content');
          }

          const validTypes: MemoryType[] = [
            'SHORT_TERM', 'LONG_TERM', 'SEMANTIC', 'EPISODIC',
            'WORKSPACE', 'CONVERSATION', 'PINNED', 'MANUAL', 'AUTOMATIC',
          ];
          const type: MemoryType = validTypes.includes(entry.type) ? entry.type : 'MANUAL';

          await this.prisma.memory.create({
            data: {
              workspaceId,
              userId,
              content: entry.content,
              summary: entry.summary ?? null,
              type,
              category: entry.category ?? null,
              tags: Array.isArray(entry.tags) ? entry.tags : [],
              importance: typeof entry.importance === 'number' ? entry.importance : 0.5,
              decayRate: typeof entry.decayRate === 'number' ? entry.decayRate : 0.01,
              isManual: true,
              permission: 'PRIVATE',
              status: 'ACTIVE',
              isArchived: false,
              isPinned: false,
              isEncrypted: false,
              version: 1,
              embeddingRefreshNeeded: true,
              embeddingVersion: 0,
              metadata: {
                create: {
                  source: 'import',
                  context: { importIndex: i, originalId: entry.id },
                  confidence: 0.9,
                  isConsolidated: false,
                  relevanceScore: 1.0,
                  retrievalCount: 0,
                  tokens: this.estimateTokens(entry.content),
                  size: this.estimateSize(entry.content),
                },
              },
            },
          });

          imported++;
        } catch (entryError: any) {
          failed++;
          errors.push(`Entry ${i}: ${entryError.message ?? 'unknown error'}`);
        }
      }

      // Update quota
      try {
        await this.prisma.memoryQuota.update({
          where: { workspaceId },
          data: {
            currentMemories: { increment: imported },
          },
        });
      } catch {
        this.logger.warn('Could not update quota after import', { workspaceId });
      }

      this.logger.info('Import completed', { workspaceId, imported, failed });
      return { imported, failed, errors };
    } catch (error) {
      this.logger.error('Import failed', { workspaceId, userId, error });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Analytics enrichment
  // ---------------------------------------------------------------------------

  /**
   * Return detailed analytics for a workspace, including per-user and
   * per-month breakdowns, top categories, and average metrics.
   */
  async getDetailedAnalytics(
    workspaceId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<DetailedAnalytics> {
    try {
      const where: any = { workspaceId };
      if (dateRange) {
        where.createdAt = { gte: dateRange.from, lte: dateRange.to };
      }

      const memories = await this.prisma.memory.findMany({
        where,
        include: { metadata: true },
        orderBy: { createdAt: 'asc' },
      });

      // --- By type ---
      const memoriesByType: Record<string, number> = {};
      for (const m of memories) {
        memoriesByType[m.type] = (memoriesByType[m.type] || 0) + 1;
      }

      // --- By status ---
      const memoriesByStatus: Record<string, number> = {};
      for (const m of memories) {
        memoriesByStatus[m.status] = (memoriesByStatus[m.status] || 0) + 1;
      }

      // --- By user ---
      const memoriesByUser: Record<string, number> = {};
      for (const m of memories) {
        memoriesByUser[m.userId] = (memoriesByUser[m.userId] || 0) + 1;
      }

      // --- By month ---
      const memoriesByMonth: Record<string, number> = {};
      for (const m of memories) {
        const month = `${m.createdAt.getFullYear()}-${String(m.createdAt.getMonth() + 1).padStart(2, '0')}`;
        memoriesByMonth[month] = (memoriesByMonth[month] || 0) + 1;
      }

      // --- Top categories ---
      const catCounts: Record<string, number> = {};
      for (const m of memories) {
        const cat = m.category ?? 'uncategorised';
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      }
      const topCategories = Object.entries(catCounts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // --- Aggregate metrics ---
      const avgImportance = memories.length > 0
        ? memories.reduce((s, m) => s + m.importance, 0) / memories.length
        : 0;

      const avgAccessCount = memories.length > 0
        ? memories.reduce((s, m) => s + m.accessCount, 0) / memories.length
        : 0;

      const totalTokens = memories.reduce(
        (s, m) => s + (m.metadata?.tokens ?? 0), 0
      );
      const totalStorage = memories.reduce(
        (s, m) => s + (m.metadata?.size ?? 0), 0
      );

      const avgTokensPerMemory = memories.length > 0
        ? totalTokens / memories.length
        : 0;

      const pinnedCount = memories.filter(m => m.isPinned).length;
      const manualCount = memories.filter(m => m.isManual).length;
      const automaticCount = memories.filter(m => !m.isManual).length;

      const decayedCount = memories.filter(m => m.status === 'DECAYING').length;
      const expiringCount = memories.filter(
        m => m.expiresAt && m.expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
      ).length;

      // Consolidations today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const consolidationsToday = await this.prisma.memoryAuditLog.count({
        where: {
          action: 'CONSOLIDATED',
          createdAt: { gte: todayStart },
        },
      });

      const retrievalsToday = await this.prisma.memoryAuditLog.count({
        where: {
          action: 'ACCESSED',
          createdAt: { gte: todayStart },
        },
      });

      const oldest = memories.length > 0 ? memories[0].createdAt : null;
      const newest = memories.length > 0 ? memories[memories.length - 1].createdAt : null;

      const analytics: DetailedAnalytics = {
        workspaceId,
        totalMemories: memories.length,
        memoriesByType: memoriesByType as any,
        memoriesByStatus: memoriesByStatus as any,
        averageImportance: avgImportance,
        totalTokens,
        totalStorage,
        consolidationsToday,
        retrievalsToday,
        decayedMemoriesCount: decayedCount,
        expiringMemoriesCount: expiringCount,
        memoriesByUser,
        memoriesByMonth,
        averageAccessCount: avgAccessCount,
        topCategories,
        pinnedCount,
        manualCount,
        automaticCount,
        averageTokensPerMemory: avgTokensPerMemory,
        oldestMemoryDate: oldest,
        newestMemoryDate: newest,
      };

      this.logger.debug('Detailed analytics computed', {
        workspaceId,
        totalMemories: memories.length,
      });

      return analytics;
    } catch (error) {
      this.logger.error('Analytics computation failed', { workspaceId, error });
      throw error;
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
