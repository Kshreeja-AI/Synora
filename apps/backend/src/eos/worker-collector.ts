import { engineeringEventBus } from './event-bus.js';
import type { Worker, Job } from 'bullmq';

export function attachWorkerCollector(worker: Worker, queueName: string): void {
  worker.on('completed', (job: Job) => {
    engineeringEventBus.emit({
      type: 'worker.job.completed',
      timestamp: Date.now(),
      source: `worker:${queueName}`,
      payload: {
        queue: queueName,
        jobId: job.id ?? 'unknown',
        durationMs: job.finishedOn && job.processedOn
          ? job.finishedOn - job.processedOn
          : undefined,
      },
    });
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    engineeringEventBus.emit({
      type: 'worker.job.failed',
      timestamp: Date.now(),
      source: `worker:${queueName}`,
      payload: {
        queue: queueName,
        jobId: job?.id ?? 'unknown',
        error: error.message,
        attempts: job?.attemptsMade,
      },
    });
  });
}
