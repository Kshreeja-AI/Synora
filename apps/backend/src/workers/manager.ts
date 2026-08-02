/**
 * Worker Manager: Initializes and manages all Bull Queue workers
 *
 * On app startup, this initializes all workers so they can process jobs.
 * Workers run independently and listen to their respective queues.
 */

import { Worker } from 'bullmq';
import { logger } from '../utils/logger';
import { createGenerateResponseWorker } from './generateResponse.worker';
import { setupWorkers as setupQueueWorkers, scheduleMemoryMaintenance } from './queue';

let workers: Worker[] = [];
let initialized = false;

/**
 * Idempotent: `initializeApp()` (and therefore this) can legitimately be
 * called more than once per process — every test file that calls
 * `initializeApp()` would otherwise create a fresh, never-closed set of
 * BullMQ Worker/Redis connections on top of the last set, leaking
 * connections across the whole suite. Only the first call actually starts
 * workers; later calls are a no-op until `shutdownWorkers()` runs.
 */
export async function initializeWorkers(): Promise<void> {
  if (initialized) {
    logger.debug('[WorkerManager] Workers already initialized, skipping');
    return;
  }

  try {
    logger.info('[WorkerManager] Initializing workers...');

    // Chat generation (streaming) worker
    const { worker: generateResponseWorker } = createGenerateResponseWorker();
    workers.push(generateResponseWorker);

    // Dataset export, evaluation, message feedback, video generation,
    // file processing, and memory maintenance workers — previously defined
    // in queue.ts but never started anywhere, so their queues were never
    // consumed.
    workers.push(...setupQueueWorkers());

    try {
      await scheduleMemoryMaintenance();
    } catch (error) {
      // Non-fatal: the worker above is still running and will process any
      // manually-enqueued sweep; only the automatic schedule is affected.
      logger.error('[WorkerManager] Failed to schedule memory maintenance', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    initialized = true;
    logger.info('[WorkerManager] Workers initialized successfully');
    logger.info(`[WorkerManager] Active workers: ${workers.length}`);
  } catch (error) {
    logger.error('[WorkerManager] Failed to initialize workers', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function shutdownWorkers(): Promise<void> {
  logger.info('[WorkerManager] Shutting down workers...');

  for (const worker of workers) {
    try {
      await worker.close();
    } catch (error) {
      logger.error('[WorkerManager] Error closing worker', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  workers = [];
  initialized = false;
  logger.info('[WorkerManager] All workers shut down');
}

export { workers };
