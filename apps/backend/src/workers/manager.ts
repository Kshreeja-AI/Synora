/**
 * Worker Manager: Initializes and manages all Bull Queue workers
 *
 * On app startup, this initializes all workers so they can process jobs.
 * Workers run independently and listen to their respective queues.
 */

import { Worker } from 'bullmq';
import { logger } from '../utils/logger';
import { createGenerateResponseWorker } from './generateResponse.worker';

let workers: Worker[] = [];

export async function initializeWorkers(): Promise<void> {
  try {
    logger.info('[WorkerManager] Initializing workers...');

    // Create and start generate response worker
    const { worker: generateResponseWorker } = createGenerateResponseWorker();
    workers.push(generateResponseWorker);

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
  logger.info('[WorkerManager] All workers shut down');
}

export { workers };
