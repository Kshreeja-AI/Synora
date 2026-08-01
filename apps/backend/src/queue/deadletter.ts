import { DeadLetterEntry, JobType } from './types';
import { logger } from '../utils/logger';
import { getQueueAuditLog } from './audit';

export class DeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private retentionMs: number;
  private auditLog = getQueueAuditLog();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(retentionMs: number = 86400000) {
    this.retentionMs = retentionMs;
  }

  start(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);

    logger.info('[DeadLetterQueue] Started cleanup interval');
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('[DeadLetterQueue] Stopped cleanup interval');
    }
  }

  moveToDeadLetter(
    jobId: string,
    jobType: JobType,
    data: Record<string, unknown>,
    failureReason: string,
    failureCount: number
  ): void {
    const now = new Date();
    const entry: DeadLetterEntry = {
      jobId,
      jobType,
      data,
      failureReason,
      failureCount,
      lastFailureTime: now,
      movedAt: now,
      expiresAt: new Date(now.getTime() + this.retentionMs),
    };

    this.entries.set(jobId, entry);
    this.auditLog.recordJobMovedToDeadLetter(jobType, jobId, failureReason);

    logger.error('[DeadLetterQueue] Job moved to dead letter queue', {
      jobId,
      jobType,
      failureReason,
      failureCount,
      expiresAt: entry.expiresAt.toISOString(),
    });
  }

  getEntry(jobId: string): DeadLetterEntry | null {
    return this.entries.get(jobId) || null;
  }

  getEntriesByJobType(jobType: JobType): DeadLetterEntry[] {
    return Array.from(this.entries.values()).filter(e => e.jobType === jobType);
  }

  getAllEntries(): DeadLetterEntry[] {
    return Array.from(this.entries.values());
  }

  removeEntry(jobId: string): boolean {
    return this.entries.delete(jobId);
  }

  retryJob(jobId: string): DeadLetterEntry | null {
    const entry = this.entries.get(jobId);
    if (!entry) {
      return null;
    }

    logger.info('[DeadLetterQueue] Retrying job from dead letter queue', {
      jobId,
      jobType: entry.jobType,
    });

    this.entries.delete(jobId);
    return entry;
  }

  private cleanup(): void {
    const now = new Date();
    let removedCount = 0;

    for (const [jobId, entry] of this.entries) {
      if (entry.expiresAt < now) {
        this.entries.delete(jobId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info('[DeadLetterQueue] Cleaned up expired entries', {
        removedCount,
        totalEntries: this.entries.size,
      });
    }
  }

  getSize(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    logger.info('[DeadLetterQueue] Cleared all entries');
  }
}

let deadLetterQueue: DeadLetterQueue | null = null;

export function initDeadLetterQueue(retentionMs?: number): DeadLetterQueue {
  deadLetterQueue = new DeadLetterQueue(retentionMs);
  return deadLetterQueue;
}

export function getDeadLetterQueue(): DeadLetterQueue {
  if (!deadLetterQueue) {
    deadLetterQueue = new DeadLetterQueue();
  }
  return deadLetterQueue;
}

export function resetDeadLetterQueueForTests(): void {
  if (deadLetterQueue) {
    deadLetterQueue.stop();
  }
  deadLetterQueue = null;
}
