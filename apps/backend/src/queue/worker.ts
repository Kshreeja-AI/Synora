import { Worker, Job, WorkerOptions as BullMQWorkerOptions } from 'bullmq';
import { randomBytes } from 'crypto';
import { getRedisConnection } from './redis';
import { getMetricsCollector } from './metrics';
import { getRetryManager } from './retry';
import { getDeadLetterQueue } from './deadletter';
import { getQueueAuditLog } from './audit';
import { JobType, QueueJobHandler, WorkerOptions } from './types';
import { logger } from '../utils/logger';

export class QueueWorker {
  private worker: Worker | null = null;
  private jobType: JobType;
  private queueName: string;
  private handler: QueueJobHandler;
  private workerId: string;
  private config: WorkerOptions;
  private metricsCollector = getMetricsCollector();
  private retryManager = getRetryManager();
  private deadLetterQueue = getDeadLetterQueue();
  private auditLog = getQueueAuditLog();

  constructor(
    jobType: JobType,
    queueName: string,
    handler: QueueJobHandler,
    config: WorkerOptions = { concurrency: 1 }
  ) {
    this.jobType = jobType;
    this.queueName = queueName;
    this.handler = handler;
    this.config = config;
    this.workerId = `${jobType}-${randomBytes(4).toString('hex')}`;
  }

  async start(): Promise<void> {
    const bullMQOptions: BullMQWorkerOptions = {
      connection: getRedisConnection(),
      concurrency: this.config.concurrency,
      maxStalledCount: this.config.maxStalledCount ?? 2,
      stalledInterval: this.config.maxStalledInterval ?? 30000,
      lockDuration: this.config.lockDuration ?? 30000,
      lockRenewTime: this.config.lockRenewTime ?? 15000,
    };

    this.worker = new Worker(this.queueName, this.processJob.bind(this), bullMQOptions);

    this.setupEventHandlers();

    this.auditLog.recordWorkerStarted(this.jobType, this.workerId);
    this.metricsCollector.recordWorkerHealth(this.workerId, {
      status: 'healthy',
      workerId: this.workerId,
      processedCount: 0,
      failedCount: 0,
      uptime: 0,
      activeJobs: 0,
    });

    logger.info('[QueueWorker] Worker started', {
      workerId: this.workerId,
      jobType: this.jobType,
      queueName: this.queueName,
      concurrency: this.config.concurrency,
    });
  }

  async stop(): Promise<void> {
    if (!this.worker) {
      return;
    }

    await this.worker.close();
    this.auditLog.recordWorkerStopped(this.jobType, this.workerId);

    logger.info('[QueueWorker] Worker stopped', {
      workerId: this.workerId,
      jobType: this.jobType,
    });
  }

  private async processJob(job: Job): Promise<void> {
    const jobId = job.id!;

    try {
      this.auditLog.recordJobStarted(this.jobType, jobId, this.workerId);
      this.metricsCollector.incrementWorkerProcessed(this.workerId);

      logger.info('[QueueWorker] Processing job', {
        jobId,
        jobType: this.jobType,
        workerId: this.workerId,
        attempt: job.attemptsMade + 1,
      });

      await this.handler(job);

      this.auditLog.recordJobCompleted(this.jobType, jobId, this.workerId);

      logger.info('[QueueWorker] Job completed successfully', {
        jobId,
        jobType: this.jobType,
        workerId: this.workerId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.metricsCollector.incrementWorkerFailed(this.workerId);

      const attemptNumber = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts || 3;

      if (attemptNumber >= maxAttempts) {
        this.deadLetterQueue.moveToDeadLetter(
          jobId,
          this.jobType,
          job.data,
          errorMessage,
          attemptNumber
        );

        this.auditLog.recordJobFailed(this.jobType, jobId, errorMessage, this.workerId);

        logger.error('[QueueWorker] Job failed and moved to dead letter queue', {
          jobId,
          jobType: this.jobType,
          workerId: this.workerId,
          error: errorMessage,
          attempt: attemptNumber,
          maxAttempts,
        });

        throw error;
      }

      this.retryManager.recordRetry(jobId, this.jobType, attemptNumber, errorMessage);

      throw new Error(`Job will be retried. Attempt ${attemptNumber}/${maxAttempts}: ${errorMessage}`);
    }
  }

  private setupEventHandlers(): void {
    if (!this.worker) {
      return;
    }

    this.worker.on('ready', () => {
      logger.debug('[QueueWorker] Worker ready', {
        workerId: this.workerId,
        jobType: this.jobType,
      });
    });

    this.worker.on('error', (error) => {
      logger.error('[QueueWorker] Worker error', {
        workerId: this.workerId,
        jobType: this.jobType,
        error: error.message,
      });
    });

    this.worker.on('drained', () => {
      logger.debug('[QueueWorker] Worker drained (no more jobs)', {
        workerId: this.workerId,
        jobType: this.jobType,
      });
    });

    this.worker.on('failed', (job, error) => {
      logger.warn('[QueueWorker] Job failed', {
        jobId: job?.id,
        jobType: this.jobType,
        workerId: this.workerId,
        error: error?.message,
      });
    });
  }

  getWorkerId(): string {
    return this.workerId;
  }

  getJobType(): JobType {
    return this.jobType;
  }

  isRunning(): boolean {
    return this.worker !== null;
  }
}

export async function createWorker(
  jobType: JobType,
  queueName: string,
  handler: QueueJobHandler,
  config?: WorkerOptions
): Promise<QueueWorker> {
  const worker = new QueueWorker(jobType, queueName, handler, config);
  await worker.start();
  return worker;
}
