/**
 * Memory Background Worker Scheduler
 * Periodically runs consolidation, decay, expiry, and embedding-refresh
 * workers. Deliberately process-lifecycle code, not request-handling code —
 * it is started from server.ts (the process entrypoint), never from
 * app.ts/createApp(), so `supertest` runs against createApp() never spin up
 * timers that outlive a test.
 */

import { PrismaClient } from '@prisma/client';
import {
  consolidationWorker,
  decayWorker,
  expiryWorker,
  embeddingRefreshWorker,
} from './workers/consolidation.worker';
import { CacheMemoryProvider } from './providers/cache.provider';
import { MemoryLifecycleService } from './memory-lifecycle.service';

export interface MemorySchedulerIntervals {
  consolidationMs: number;
  decayMs: number;
  expiryMs: number;
  embeddingRefreshMs: number;
  cacheCleanupMs: number;
}

export const DEFAULT_MEMORY_SCHEDULER_INTERVALS: MemorySchedulerIntervals = {
  consolidationMs: 6 * 60 * 60 * 1000, // every 6 hours
  decayMs: 24 * 60 * 60 * 1000, // daily
  expiryMs: 24 * 60 * 60 * 1000, // daily
  embeddingRefreshMs: 15 * 60 * 1000, // every 15 minutes
  cacheCleanupMs: 60 * 60 * 1000, // hourly
};

export interface MemoryScheduler {
  stop(): void;
}

/**
 * Runs a job immediately, then on a fixed interval, swallowing (and
 * logging) failures so one bad run never kills the interval timer for
 * subsequent runs.
 */
function scheduleRepeating(
  name: string,
  fn: () => Promise<void>,
  intervalMs: number,
  logger: any
): NodeJS.Timeout {
  const run = () => {
    fn().catch((error) => {
      logger.error(`Memory scheduler job failed: ${name}`, { error });
    });
  };
  run();
  return setInterval(run, intervalMs);
}

export function startMemoryWorkerScheduler(
  prisma: PrismaClient,
  logger: any,
  intervals: MemorySchedulerIntervals = DEFAULT_MEMORY_SCHEDULER_INTERVALS
): MemoryScheduler {
  const cacheProvider = new CacheMemoryProvider(prisma, logger);
  const lifecycleService = new MemoryLifecycleService(prisma, logger);

  const timers: NodeJS.Timeout[] = [
    scheduleRepeating(
      'consolidation',
      () => consolidationWorker(prisma, logger),
      intervals.consolidationMs,
      logger
    ),
    scheduleRepeating('decay', () => decayWorker(prisma, logger), intervals.decayMs, logger),
    scheduleRepeating('expiry', () => expiryWorker(prisma, logger), intervals.expiryMs, logger),
    scheduleRepeating(
      'embedding-refresh',
      () => embeddingRefreshWorker(prisma, logger),
      intervals.embeddingRefreshMs,
      logger
    ),
    scheduleRepeating(
      'cache-cleanup',
      async () => {
        const cleared = await cacheProvider.clearExpired();
        if (cleared > 0) logger.debug('Memory cache cleanup', { cleared });
      },
      intervals.cacheCleanupMs,
      logger
    ),
    scheduleRepeating(
      'failure-recovery',
      async () => {
        const workspaces = await prisma.workspace.findMany({ select: { id: true } });
        for (const { id } of workspaces) {
          await lifecycleService.recoverFailedOperations(id);
        }
      },
      intervals.consolidationMs,
      logger
    ),
  ];

  logger.info('Memory background worker scheduler started', {
    intervals,
  });

  return {
    stop(): void {
      for (const timer of timers) clearInterval(timer);
      logger.info('Memory background worker scheduler stopped');
    },
  };
}
