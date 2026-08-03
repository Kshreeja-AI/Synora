import { Queue, Worker } from 'bullmq'
import { logger } from '../utils/logger'
import { processExportDataset, type ExportDatasetJobData } from './export-dataset.worker'
import { processRunEvaluation, type RunEvaluationJobData } from './run-evaluation.worker'
import { processMessageFeedback, type ProcessFeedbackJobData } from './process-feedback.worker'
import { processFileJob, type ProcessFileJobData } from './processFile.worker'
import { processVideoGeneration, type VideoGenerationJobData } from './videoGeneration.worker'
import { processMemoryMaintenance, type MemoryMaintenanceJobData } from './memoryMaintenance.worker'
import type { GenerateResponseJob } from './generateResponse.worker'
import { queueJobsTotal, queueJobDuration } from '../monitoring/metrics'
import { attachWorkerCollector } from '../eos/worker-collector'

// Queue configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

/**
 * Producers (queue.add from request handlers) must FAIL FAST when
 * Redis is unreachable. ioredis's default `enableOfflineQueue: true`
 * buffers commands while disconnected, which turns a Redis outage
 * into request handlers awaiting `queue.add` indefinitely — a full
 * chat outage with no error. With the offline queue disabled, add()
 * rejects immediately once the connection is known to be down.
 *
 * The connection itself is deliberately NOT given a bounded
 * `retryStrategy`: these Queue instances live for the whole process,
 * so a Redis restart must be reconnected to automatically rather than
 * leaving the client permanently in the `end` state (which is what a
 * `retryStrategy` returning `null` does — no amount of Redis coming
 * back would ever be noticed again without a process restart).
 * Bounding the *initial* connection wait is instead the job of
 * `addWithTimeout` below, applied per-call at every enqueue site.
 */
const PRODUCER_CONFIG = {
  connection: {
    url: REDIS_URL,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  },
}

const PRODUCER_ADD_TIMEOUT_MS = 3000

/**
 * BullMQ's `Queue#add` waits for the underlying connection to reach
 * `ready` before evaluating `enableOfflineQueue`/`maxRetriesPerRequest`,
 * so those options alone do not bound how long `add()` can hang while
 * Redis is unreachable and the connection is still retrying in the
 * background. This wraps any producer `add()` call with an explicit
 * timeout so callers (route handlers, startup scheduling) get an
 * honest rejection instead of hanging indefinitely.
 */
function addWithTimeout<T>(promise: Promise<T>, queueName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Queue '${queueName}' unavailable: add() timed out after ${PRODUCER_ADD_TIMEOUT_MS}ms`))
      }, PRODUCER_ADD_TIMEOUT_MS)
      timer.unref?.()
    }),
  ])
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
export const videoGenerationQueue = new Queue<VideoGenerationJobData>(
  'video-generation',
  PRODUCER_CONFIG
)
export const generateResponseQueue = new Queue<GenerateResponseJob>(
  'generate_response',
  PRODUCER_CONFIG
)
export const memoryMaintenanceQueue = new Queue<MemoryMaintenanceJobData>(
  'memory-maintenance',
  PRODUCER_CONFIG
)

// Add jobs to queues
export async function enqueueExportDataset(data: ExportDatasetJobData): Promise<string> {
  const job = await addWithTimeout(
    exportDatasetQueue.add('export', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'export-dataset'
  )

  logger.info(`[queue] Enqueued export dataset job`, {
    jobId: job.id,
    exportId: data.exportId,
  })

  return job.id!
}

export async function enqueueRunEvaluation(data: RunEvaluationJobData): Promise<string> {
  const job = await addWithTimeout(
    runEvaluationQueue.add('run', data, {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'run-evaluation'
  )

  logger.info(`[queue] Enqueued run evaluation job`, {
    jobId: job.id,
    evaluationRunId: data.evaluationRunId,
  })

  return job.id!
}

export async function enqueueMessageFeedback(data: ProcessFeedbackJobData): Promise<string> {
  const job = await addWithTimeout(
    messageFeedbackQueue.add('process', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'message-feedback'
  )

  logger.info(`[queue] Enqueued message feedback job`, {
    jobId: job.id,
    feedbackId: data.feedbackId,
  })

  return job.id!
}

export async function enqueueVideoGeneration(
  data: VideoGenerationJobData,
  options?: { delayMs?: number }
): Promise<string> {
  const job = await addWithTimeout(
    videoGenerationQueue.add('generate', data, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      delay: options?.delayMs,
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'video-generation'
  )

  logger.info(`[queue] Enqueued video generation job`, {
    jobId: job.id,
    videoId: data.videoId,
  })

  return job.id!
}

export async function enqueueFileProcessing(data: ProcessFileJobData): Promise<string> {
  const job = await addWithTimeout(
    fileProcessingQueue.add('process', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'file-processing'
  )

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
  const job = await addWithTimeout(
    generateResponseQueue.add('generate-response', data, {
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'generate_response'
  )

  logger.info(`[queue] Enqueued generation job`, {
    jobId: job.id,
    streamingJobId: data.jobId,
    messageId: data.messageId,
  })

  return job.id!
}

/**
 * Schedules the recurring memory maintenance sweep (see
 * memoryMaintenance.worker.ts / memoryLifecycle.service.ts). Uses a fixed
 * `jobId` so calling this on every app startup is idempotent — BullMQ
 * replaces the existing repeatable job definition rather than stacking a
 * second one, so restarts never multiply the schedule.
 */
export async function scheduleMemoryMaintenance(): Promise<void> {
  const intervalMs = parseInt(process.env.MEMORY_MAINTENANCE_INTERVAL_MS || String(24 * 60 * 60 * 1000))

  await addWithTimeout(
    memoryMaintenanceQueue.add(
      'sweep',
      { triggeredBy: 'schedule' },
      {
        repeat: { every: intervalMs },
        jobId: 'memory-maintenance-schedule',
        removeOnComplete: true,
        removeOnFail: false,
      }
    ),
    'memory-maintenance'
  )

  logger.info('[queue] Memory maintenance scheduled', { intervalMs })
}

export async function enqueueMemoryMaintenance(
  data: MemoryMaintenanceJobData = { triggeredBy: 'manual' }
): Promise<string> {
  const job = await addWithTimeout(
    memoryMaintenanceQueue.add('sweep', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    }),
    'memory-maintenance'
  )

  logger.info('[queue] Enqueued memory maintenance job', { jobId: job.id, triggeredBy: data.triggeredBy })

  return job.id!
}

// Worker setup
export function setupWorkers(): Worker[] {
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

  // Video generation worker (async poll + storage)
  const videoWorker = new Worker<VideoGenerationJobData>(
    'video-generation',
    async (job) => {
      logger.info(`[worker] Processing video generation job ${job.id}`, {
        videoId: job.data.videoId,
      })
      await processVideoGeneration(job.data)
    },
    {
      ...WORKER_CONFIG,
      concurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '2'),
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

  // Memory maintenance worker (consolidation, decay, embedding refresh,
  // importance recalculation, archival, cleanup, quota reset)
  const memoryMaintenanceWorker = new Worker<MemoryMaintenanceJobData>(
    'memory-maintenance',
    async (job) => {
      logger.info(`[worker] Processing memory maintenance job ${job.id}`)
      await processMemoryMaintenance(job.data)
    },
    {
      ...WORKER_CONFIG,
      concurrency: 1,
    }
  )

  // Event handlers
  setupWorkerEventHandlers(exportWorker, 'export-dataset')
  setupWorkerEventHandlers(evaluationWorker, 'run-evaluation')
  setupWorkerEventHandlers(feedbackWorker, 'message-feedback')
  setupWorkerEventHandlers(videoWorker, 'video-generation')
  setupWorkerEventHandlers(fileWorker, 'file-processing')
  setupWorkerEventHandlers(memoryMaintenanceWorker, 'memory-maintenance')

  // EOS engineering event bus collectors (additive — no change to existing handlers)
  attachWorkerCollector(exportWorker, 'export-dataset')
  attachWorkerCollector(evaluationWorker, 'run-evaluation')
  attachWorkerCollector(feedbackWorker, 'message-feedback')
  attachWorkerCollector(videoWorker, 'video-generation')
  attachWorkerCollector(fileWorker, 'file-processing')
  attachWorkerCollector(memoryMaintenanceWorker, 'memory-maintenance')

  logger.info('[queue] Workers setup complete')

  return [exportWorker, evaluationWorker, feedbackWorker, videoWorker, fileWorker, memoryMaintenanceWorker]
}

function setupWorkerEventHandlers(worker: Worker, workerName: string): void {
  worker.on('completed', (job) => {
    const durationMs = job.finishedOn! - job.processedOn!
    queueJobsTotal.inc({ queue: workerName, outcome: 'completed' })
    queueJobDuration.observe({ queue: workerName }, durationMs / 1000)
    logger.info(`[worker] Job completed`, {
      workerName,
      jobId: job.id,
      duration: durationMs,
    })
  })

  worker.on('failed', (job, error) => {
    queueJobsTotal.inc({ queue: workerName, outcome: 'failed' })
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
    videoGeneration: {
      waiting: await videoGenerationQueue.count(),
      active: (await videoGenerationQueue.getActiveCount()) ?? 0,
      failed: (await videoGenerationQueue.getFailedCount()) ?? 0,
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
    videoGenerationQueue.close(),
    generateResponseQueue.close(),
  ])
  logger.info('[queue] All queues closed')
}
