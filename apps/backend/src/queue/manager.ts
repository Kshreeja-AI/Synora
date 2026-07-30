import { Queue } from 'bullmq';
import { initRedis, getRedisConnection } from './redis';
import { initJobRegistry, getJobRegistry, getQueueRegistry, initQueueRegistry } from './registry';
import { initRetryManager } from './retry';
import { initDeadLetterQueue, getDeadLetterQueue } from './deadletter';
import { initHealthChecker, getHealthChecker } from './health';
import { initMetricsCollector, getMetricsCollector } from './metrics';
import { createWorker, QueueWorker } from './worker';
import { getConfig } from '../config';
import { getQueueAuditLog } from './audit';
import { JobType, JobTypeDefinition, QueueJobHandler } from './types';
import { logger } from '../utils/logger';

export class QueueManager {
  private queues: Map<JobType, Queue> = new Map();
  private workers: Map<JobType, QueueWorker[]> = new Map();
  private isInitialized = false;
  private shutdownSignalHandler: (() => Promise<void>) | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[QueueManager] Already initialized');
      return;
    }

    try {
      const config = getConfig();

      if (!config.queue.enabled) {
        logger.info('[QueueManager] Queue system disabled via config');
        return;
      }

      initRedis(config.queue.redis);
      initJobRegistry();
      initQueueRegistry();
      initRetryManager(config.queue.retry);
      initDeadLetterQueue(config.queue.deadLetter.retention);
      initMetricsCollector();
      initHealthChecker();

      logger.info('[QueueManager] Initialized all queue subsystems');
      this.isInitialized = true;
    } catch (error) {
      logger.error('[QueueManager] Initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  registerJobType(definition: JobTypeDefinition, handler: QueueJobHandler): void {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized. Call initialize() first.');
    }

    const jobRegistry = getJobRegistry();
    const queueRegistry = getQueueRegistry();

    jobRegistry.registerJobType(definition, handler);
    queueRegistry.registerQueue(definition.name, definition.name);

    const queueName = definition.name;
    const queue = new Queue(queueName, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: definition.attempts ?? 3,
        backoff: definition.backoff ?? {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    this.queues.set(definition.name, queue);
    getMetricsCollector().registerQueue(definition.name, queue);
    getHealthChecker().registerQueue(definition.name, queue);

    logger.debug('[QueueManager] Registered job type and queue', {
      jobType: definition.name,
      queueName,
    });
  }

  async startWorkers(jobType: JobType, concurrency: number): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('QueueManager not initialized. Call initialize() first.');
    }

    const jobRegistry = getJobRegistry();
    const queueRegistry = getQueueRegistry();

    if (!jobRegistry.isJobTypeRegistered(jobType)) {
      throw new Error(`Job type "${jobType}" not registered`);
    }

    const queueName = queueRegistry.getQueueName(jobType);
    const handler = jobRegistry.getJobHandler(jobType);

    const workers: QueueWorker[] = [];

    for (let i = 0; i < concurrency; i++) {
      const worker = await createWorker(jobType, queueName, handler, {
        concurrency: 1,
      });

      workers.push(worker);
      getHealthChecker().registerWorker(worker.getWorkerId(), worker);
    }

    this.workers.set(jobType, workers);

    logger.info('[QueueManager] Started workers for job type', {
      jobType,
      workerCount: concurrency,
    });
  }

  async stopAllWorkers(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const workers of this.workers.values()) {
      for (const worker of workers) {
        stopPromises.push(worker.stop());
      }
    }

    await Promise.all(stopPromises);
    this.workers.clear();

    logger.info('[QueueManager] Stopped all workers');
  }

  async shutdown(): Promise<void> {
    try {
      logger.info('[QueueManager] Shutting down');

      await this.stopAllWorkers();

      getDeadLetterQueue().stop();

      for (const queue of this.queues.values()) {
        await queue.close();
      }
      this.queues.clear();

      logger.info('[QueueManager] Shutdown complete');
    } catch (error) {
      logger.error('[QueueManager] Shutdown failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  setupGracefulShutdown(): void {
    this.shutdownSignalHandler = async () => {
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', this.shutdownSignalHandler);
    process.on('SIGINT', this.shutdownSignalHandler);

    logger.info('[QueueManager] Graceful shutdown handler registered');
  }

  removeGracefulShutdown(): void {
    if (this.shutdownSignalHandler) {
      process.removeListener('SIGTERM', this.shutdownSignalHandler);
      process.removeListener('SIGINT', this.shutdownSignalHandler);
      this.shutdownSignalHandler = null;
      logger.info('[QueueManager] Graceful shutdown handler removed');
    }
  }

  async getQueueByJobType(jobType: JobType): Promise<Queue | null> {
    return this.queues.get(jobType) || null;
  }

  getAuditLog() {
    return getQueueAuditLog();
  }
}

let queueManager: QueueManager | null = null;

export async function initQueueManager(): Promise<QueueManager> {
  if (!queueManager) {
    queueManager = new QueueManager();
    await queueManager.initialize();
  }
  return queueManager;
}

export function getQueueManager(): QueueManager {
  if (!queueManager) {
    throw new Error('QueueManager not initialized. Call initQueueManager() first.');
  }
  return queueManager;
}

export function resetQueueManagerForTests(): void {
  if (queueManager) {
    queueManager.removeGracefulShutdown();
  }
  queueManager = null;
}
