import { Queue, Worker } from 'bullmq'
import { logger } from '../utils/logger'
import { processExportDataset, type ExportDatasetJobData } from './export-dataset.worker'
import { processRunEvaluation, type RunEvaluationJobData } from './run-evaluation.worker'
import { processMessageFeedback, type ProcessFeedbackJobData } from './process-feedback.worker'
import { processFileJob, type ProcessFileJobData } from './processFile.worker'

// Queue configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const QUEUE_CONFIG = {
  connection: {
    url: REDIS_URL,
  },
}

// Create queues for different job types
export const exportDatasetQueue = new Queue<ExportDatasetJobData>('export-dataset', QUEUE_CONFIG)
export const runEvaluationQueue = new Queue<RunEvaluationJobData>('run-evaluation', QUEUE_CONFIG)
export const messageFeedbackQueue = new Queue<ProcessFeedbackJobData>(
  'message-feedback',
  QUEUE_CONFIG
)
export const fileProcessingQueue = new Queue<ProcessFileJobData>('file-processing', QUEUE_CONFIG)

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
      ...QUEUE_CONFIG,
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
      ...QUEUE_CONFIG,
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
      ...QUEUE_CONFIG,
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
      ...QUEUE_CONFIG,
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
  ])
  logger.info('[queue] All queues closed')
}
