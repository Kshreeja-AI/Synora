import { Queue, Worker } from 'bullmq'
import { logger } from '../utils/logger'
import { processExportDataset, type ExportDatasetJobData } from './export-dataset.worker'
import { processRunEvaluation, type RunEvaluationJobData } from './run-evaluation.worker'
import { processMessageFeedback, type ProcessFeedbackJobData } from './process-feedback.worker'
import { processFileJob, type ProcessFileJobData } from './processFile.worker'
import type { GenerateResponseJob } from './generateResponse.worker'

// Queue configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

/**
 * Producers (queue.add from request handlers) must FAIL FAST when
 * Redis is unreachable. ioredis's default `enableOfflineQueue: true`
 * buffers commands while disconnected, which turns a Redis outage
 * into request handlers awaiting `queue.add` indefinitely — a full
 * chat outage with no error. With the offline queue disabled, add()
 * rejects immediately and each call site's error handling decides
 * what degradation looks like (non-fatal for uploads/messages,
 * explicit 5xx for evaluation/export kickoffs).
 */
const PRODUCER_CONFIG = {
  connection: {
    url: REDIS_URL,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  },
}

/**
 * Workers hold long-lived blocking connections and are expected to
 * ride out Redis restarts by reconnecting — BullMQ requires
 * `maxRetriesPerRequest: null` on worker connections for exactly
 * that reason.
 */
const WORKER_CONFIG = {
  connection: {
    url: REDIS_URL,
    maxRetriesPerRequest: null,
  },
}

// Create queues for different job types (producer side)
export const exportDatasetQueue = new Queue<ExportDatasetJobData>('export-dataset', PRODUCER_CONFIG)
export const runEvaluationQueue = new Queue<RunEvaluationJobData>('run-evaluation', PRODUCER_CONFIG)
export const messageFeedbackQueue = new Queue<ProcessFeedbackJobData>(
  'message-feedback',
  PRODUCER_CONFIG
)
export const fileProcessingQueue = new Queue<ProcessFileJobData>('file-processing', PRODUCER_CONFIG)
// Singleton producer for chat generation. Previously every message
// send constructed a fresh Queue (and Redis connection) that was
// never closed — a connection leak on the hottest path in the app.
export const generateResponseQueue = new Queue<GenerateResponseJob>(
  'generate_response',
  PRODUCER_CONFIG
)

// Add jobs to queues
export async function enqueueExportDataset(data: ExportDatasetJobData): Promise<string> {
  const job = await exportDatasetQueue.add('export', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  })

  logger.info(`[queue] Enqueued export dataset job`, {
    jobId: job.id,
    exportId: data.exportId,
  })

  return job.id!
}

export async function enqueueRunEvaluation(data: RunEvaluationJobData): Promise<string> {
  const job = await runEvaluationQueue.add('run', data, {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  })

  logger.info(`[queue] Enqueued run evaluation job`, {
    jobId: job.id,
    evaluationRunId: data.evaluationRunId,
  })

  return job.id!
}

export async function enqueueMessageFeedback(data: ProcessFeedbackJobData): Promise<string> {
  const job = await messageFeedbackQueue.add('process', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  })

  logger.info(`[queue] Enqueued message feedback job`, {
    jobId: job.id,
    feedbackId: data.feedbackId,
  })

  return job.id!
}

export async function enqueueFileProcessing(data: ProcessFileJobData): Promise<string> {
  const job = await fileProcessingQueue.add('process', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  })

  logger.info(`[queue] Enqueued file processing job`, {
    jobId: job.id,
    fileId: data.fileId,
  })

  return job.id!
}

/**
 * Enqueue a chat generation job. Retry semantics live in the worker's
 * StreamingRetryEngine, not in BullMQ attempts — the job runs once
 * from the queue's perspective, matching the previous behavior.
 */
export async function enqueueGenerateResponse(data: GenerateResponseJob): Promise<string> {
  const job = await generateResponseQueue.add('generate-response', data, {
    removeOnComplete: true,
    removeOnFail: false,
  })

  logger.info(`[queue] Enqueued generation job`, {
    jobId: job.id,
    streamingJobId: data.jobId,
    messageId: data.messageId,
  })

  return job.id!
}

// Worker setup
export function setupWorkers(): void {
  logger.info('[queue] Setting up workers...')

  // Export dataset worker
  const exportWorker = new Worker<ExportDatasetJobData>(
    'export-dataset',
    async (job) => {
      logger.info(`[worker] Processing export dataset job ${job.id}`, {
        exportId: job.data.exportId,
      })
      await processExportDataset(job.data)
    },
    {
      ...WORKER_CONFIG,
      concurrency: parseInt(process.env.EXPORT_WORKER_CONCURRENCY || '2'),
    }
  )

  // Run evaluation worker
  const evaluationWorker = new Worker<RunEvaluationJobData>(
    'run-evaluation',
    async (job) => {
      logger.info(`[worker] Processing run evaluation job ${job.id}`, {
        evaluationRunId: job.data.evaluationRunId,
      })
      await processRunEvaluation(job.data)
    },
    {
      ...WORKER_CONFIG,
      concurrency: parseInt(process.env.EVALUATION_WORKER_CONCURRENCY || '1'),
    }
  )

  // Message feedback worker
  const feedbackWorker = new Worker<ProcessFeedbackJobData>(
    'message-feedback',
    async (job) => {
      logger.info(`[worker] Processing message feedback job ${job.id}`, {
        feedbackId: job.data.feedbackId,
      })
      await processMessageFeedback(job.data)
    },
    {
      ...WORKER_CONFIG,
      concurrency: parseInt(process.env.FEEDBACK_WORKER_CONCURRENCY || '3'),
    }
  )

  // File processing worker (virus scan + content extraction)
  const fileWorker = new Worker<ProcessFileJobData>(
    'file-processing',
    async (job) => {
      logger.info(`[worker] Processing file job ${job.id}`, {
        fileId: job.data.fileId,
      })
      await processFileJob(job.data)
    },
    {
      ...WORKER_CONFIG,
      concurrency: parseInt(process.env.FILE_WORKER_CONCURRENCY || '2'),
    }
  )

  // Event handlers
  setupWorkerEventHandlers(exportWorker, 'export-dataset')
  setupWorkerEventHandlers(evaluationWorker, 'run-evaluation')
  setupWorkerEventHandlers(feedbackWorker, 'message-feedback')
  setupWorkerEventHandlers(fileWorker, 'file-processing')

  logger.info('[queue] Workers setup complete')
}

function setupWorkerEventHandlers(worker: Worker, workerName: string): void {
  worker.on('completed', (job) => {
    logger.info(`[worker] Job completed`, {
      workerName,
      jobId: job.id,
      duration: job.finishedOn! - job.processedOn!,
    })
  })

  worker.on('failed', (job, error) => {
    logger.error(`[worker] Job failed`, {
      workerName,
      jobId: job?.id,
      error: error.message,
      attempts: job?.attemptsMade,
    })
  })

  worker.on('error', (error) => {
    logger.error(`[worker] Worker error`, {
      workerName,
      error: error.message,
    })
  })
}

// Queue event handlers for monitoring
export function setupQueueEventHandlers(): void {
  // Event handlers are configured per worker in setupWorkers()
  // This function is here for future extensions if needed
  logger.info('[queue] Queue event handlers configured')
}

// Health check
export async function checkQueueHealth(): Promise<Record<string, any>> {
  const counts = {
    exportDataset: {
      waiting: await exportDatasetQueue.count(),
      active: (await exportDatasetQueue.getActiveCount()) ?? 0,
      failed: (await exportDatasetQueue.getFailedCount()) ?? 0,
    },
    runEvaluation: {
      waiting: await runEvaluationQueue.count(),
      active: (await runEvaluationQueue.getActiveCount()) ?? 0,
      failed: (await runEvaluationQueue.getFailedCount()) ?? 0,
    },
    messageFeedback: {
      waiting: await messageFeedbackQueue.count(),
      active: (await messageFeedbackQueue.getActiveCount()) ?? 0,
      failed: (await messageFeedbackQueue.getFailedCount()) ?? 0,
    },
    fileProcessing: {
      waiting: await fileProcessingQueue.count(),
      active: (await fileProcessingQueue.getActiveCount()) ?? 0,
      failed: (await fileProcessingQueue.getFailedCount()) ?? 0,
    },
    generateResponse: {
      waiting: await generateResponseQueue.count(),
      active: (await generateResponseQueue.getActiveCount()) ?? 0,
      failed: (await generateResponseQueue.getFailedCount()) ?? 0,
    },
  }

  return counts
}

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  logger.info('[queue] Closing queues...')
  await Promise.all([
    exportDatasetQueue.close(),
    runEvaluationQueue.close(),
    messageFeedbackQueue.close(),
    fileProcessingQueue.close(),
    generateResponseQueue.close(),
  ])
  logger.info('[queue] All queues closed')
}
