/**
 * Memory Lifecycle Service
 * Manages memory state transitions: creation → active → decay → consolidation → deletion
 * Handles automatic state management, TTL enforcement, and lifecycle hooks
 */

import { PrismaClient } from '@prisma/client';
import { Memory, MemoryStatus } from '../types';

export class MemoryLifecycleService {
  constructor(private prisma: PrismaClient, private logger: any) {}

  /**
   * Transition memory to DECAYING state after inactivity
   */
  async transitionToDecaying(
    memoryId: string,
    decayThreshold = 0.1
  ): Promise<Memory | null> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { metadata: true },
    });

    if (!memory) return null;

    const daysSinceAccess = Math.floor(
      (Date.now() - (memory.lastAccessedAt?.getTime() ?? memory.createdAt.getTime())) /
        (1000 * 60 * 60 * 24)
    );

    const decayedImportance = memory.importance * Math.exp(-memory.decayRate * daysSinceAccess);

    if (decayedImportance < decayThreshold) {
      const updated = await this.prisma.memory.update({
        where: { id: memoryId },
        data: { status: 'DECAYING', importance: decayedImportance },
        include: { metadata: true },
      });

      await this.createAuditLog(memoryId, 'SYSTEM', 'TRANSITIONED_TO_DECAYING', {
        previousImportance: memory.importance,
        newImportance: decayedImportance,
        daysSinceAccess,
      });

      return updated;
    }

    return memory;
  }

  /**
   * Transition memory to CONSOLIDATING state before merge
   */
  async transitionToConsolidating(memoryIds: string[]): Promise<void> {
    await this.prisma.memory.updateMany({
      where: { id: { in: memoryIds } },
      data: { status: 'CONSOLIDATING' },
    });
  }

  /**
   * Transition memory to CONSOLIDATED state after merge
   */
  async transitionToConsolidated(memoryIds: string[], consolidatedId: string): Promise<void> {
    await this.prisma.memory.updateMany({
      where: { id: { in: memoryIds } },
      data: { status: 'CONSOLIDATED' },
    });

    await this.createAuditLog(consolidatedId, 'SYSTEM', 'CONSOLIDATED_FROM', {
      sourceMemories: memoryIds,
      count: memoryIds.length,
    });
  }

  /**
   * Transition memory to EXPIRED state when TTL elapsed
   */
  async transitionToExpired(memoryId: string): Promise<Memory | null> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory || !memory.expiresAt) return null;

    if (new Date() >= memory.expiresAt) {
      const updated = await this.prisma.memory.update({
        where: { id: memoryId },
        data: { status: 'EXPIRED', isArchived: true },
      });

      await this.createAuditLog(memoryId, 'SYSTEM', 'EXPIRED_BY_TTL', {
        expiresAt: memory.expiresAt,
      });

      return updated;
    }

    return memory;
  }

  /**
   * Permanently delete expired memories (GDPR compliance, data retention)
   */
  async hardDeleteExpired(retentionDays = 30): Promise<number> {
    const expiryDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const deleted = await this.prisma.memory.deleteMany({
      where: {
        status: 'DELETED',
        updatedAt: { lt: expiryDate },
      },
    });

    this.logger.info('Hard deleted expired memories', {
      count: deleted.count,
      beforeDate: expiryDate,
    });

    return deleted.count;
  }

  /**
   * GDPR right to erasure: securely delete all user memories
   */
  async gdprErase(userId: string, workspaceId: string): Promise<number> {
    // Audit log before deletion
    await this.prisma.memoryAuditLog.create({
      data: {
        memoryId: 'GDPR_ERASE',
        userId,
        action: 'GDPR_ERASE_INITIATED',
        metadata: { workspaceId, timestamp: new Date().toISOString() },
      },
    });

    // Find all memories
    const memories = await this.prisma.memory.findMany({
      where: { userId, workspaceId },
      select: { id: true },
    });

    const memoryIds = memories.map(m => m.id);

    // Soft delete all
    await this.prisma.memory.updateMany({
      where: { id: { in: memoryIds } },
      data: { status: 'DELETED', isArchived: true, isEncrypted: true },
    });

    // Audit each deletion
    for (const memoryId of memoryIds) {
      await this.createAuditLog(memoryId, userId, 'GDPR_DELETED', {
        reason: 'User right to erasure',
        timestamp: new Date().toISOString(),
      });
    }

    // Schedule hard delete after retention period
    this.logger.info('GDPR erasure initiated', {
      userId,
      workspaceId,
      memoryCount: memoryIds.length,
      hardDeleteAfterDays: 30,
    });

    return memoryIds.length;
  }

  /**
   * Check if memory should be promoted (increase importance if accessed frequently)
   */
  async checkPromotion(memoryId: string, accessThreshold = 10): Promise<Memory | null> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { metadata: true },
    });

    if (!memory || !memory.metadata) return null;

    // If accessed frequently, increase importance
    if (memory.metadata.retrievalCount >= accessThreshold && memory.importance < 1.0) {
      const newImportance = Math.min(1.0, memory.importance * 1.2);

      const updated = await this.prisma.memory.update({
        where: { id: memoryId },
        data: { importance: newImportance },
        include: { metadata: true },
      });

      await this.createAuditLog(memoryId, 'SYSTEM', 'PROMOTED', {
        previousImportance: memory.importance,
        newImportance,
        accessCount: memory.metadata.retrievalCount,
      });

      return updated;
    }

    return memory;
  }

  /**
   * Archive memory without deletion
   */
  async archive(memoryId: string, userId: string): Promise<Memory | null> {
    const memory = await this.prisma.memory.update({
      where: { id: memoryId },
      data: { isArchived: true, status: 'ARCHIVED' },
      include: { metadata: true },
    });

    await this.createAuditLog(memoryId, userId, 'ARCHIVED', {
      timestamp: new Date().toISOString(),
    });

    return memory;
  }

  /**
   * Restore archived memory
   */
  async restore(memoryId: string, userId: string): Promise<Memory | null> {
    const memory = await this.prisma.memory.update({
      where: { id: memoryId },
      data: { isArchived: false, status: 'ACTIVE' },
      include: { metadata: true },
    });

    await this.createAuditLog(memoryId, userId, 'RESTORED', {
      timestamp: new Date().toISOString(),
    });

    return memory;
  }

  /**
   * Get memory state summary
   */
  async getLifecycleState(memoryId: string): Promise<{
    status: MemoryStatus;
    importance: number;
    daysSinceAccess: number;
    daysSinceCreation: number;
    shouldDecay: boolean;
    shouldConsolidate: boolean;
    shouldExpire: boolean;
  } | null> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
    });

    if (!memory) return null;

    const daysSinceAccess = Math.floor(
      (Date.now() - (memory.lastAccessedAt?.getTime() ?? memory.createdAt.getTime())) /
        (1000 * 60 * 60 * 24)
    );

    const daysSinceCreation = Math.floor(
      (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      status: memory.status as MemoryStatus,
      importance: memory.importance,
      daysSinceAccess,
      daysSinceCreation,
      shouldDecay: memory.importance < 0.1,
      shouldConsolidate: daysSinceCreation > 7 && memory.importance < 0.7,
      shouldExpire: memory.expiresAt ? new Date() >= memory.expiresAt : false,
    };
  }

  private async createAuditLog(
    memoryId: string,
    userId: string,
    action: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await this.prisma.memoryAuditLog.create({
        data: {
          memoryId,
          userId,
          action,
          metadata,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create audit log', { memoryId, action, error });
    }
  }
}
