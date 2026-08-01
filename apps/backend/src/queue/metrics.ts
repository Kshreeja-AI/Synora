import { Queue } from 'bullmq';
import { JobType, QueueMetrics, WorkerHealth } from './types';
import { logger } from '../utils/logger';

class QueueMetricsCollector {
  private queues: Map<JobType, Queue> = new Map();
  private workers: Map<string, WorkerHealth> = new Map();
  private metricsCache: Map<JobType, QueueMetrics> = new Map();

  registerQueue(jobType: JobType, queue: Queue): void {
    this.queues.set(jobType, queue);
  }

  registerWorker(workerId: string, health: WorkerHealth): void {
    this.workers.set(workerId, health);
  }

  async collectMetrics(jobType: JobType): Promise<QueueMetrics> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      throw new Error(`Queue for job type "${jobType}" not registered`);
    }

    try {
      const counts = await queue.getJobCounts();
      const failedJobs = await queue.getFailed(0, 100);

      const metrics: QueueMetrics = {
        processed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        paused: counts.paused || 0,
        errors: failedJobs.map(job => ({
          jobId: job.id!,
          error: job.failedReason || 'Unknown error',
          timestamp: new Date(job.finishedOn || 0),
        })),
      };

      this.metricsCache.set(jobType, metrics);
      return metrics;
    } catch (error) {
      logger.error('[QueueMetrics] Failed to collect metrics', {
        jobType,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        processed: 0,
        failed: 0,
        delayed: 0,
        waiting: 0,
        active: 0,
        completed: 0,
        paused: 0,
        errors: [],
      };
    }
  }

  async collectAllMetrics(): Promise<Map<JobType, QueueMetrics>> {
    const results = new Map<JobType, QueueMetrics>();

    for (const [jobType] of this.queues) {
      try {
        const metrics = await this.collectMetrics(jobType);
        results.set(jobType, metrics);
      } catch (error) {
        logger.error('[QueueMetrics] Failed to collect metrics for job type', {
          jobType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  recordWorkerHealth(workerId: string, health: Partial<WorkerHealth>): void {
    const existing = this.workers.get(workerId) || {
      status: 'healthy',
      workerId,
      processedCount: 0,
      failedCount: 0,
      uptime: 0,
      lastHeartbeat: new Date(),
      activeJobs: 0,
    };

    const updated = {
      ...existing,
      ...health,
      lastHeartbeat: new Date(),
    };

    this.workers.set(workerId, updated);
  }

  getWorkerHealth(workerId: string): WorkerHealth | null {
    return this.workers.get(workerId) || null;
  }

  getAllWorkerHealth(): Map<string, WorkerHealth> {
    return new Map(this.workers);
  }

  incrementWorkerProcessed(workerId: string): void {
    const health = this.workers.get(workerId);
    if (health) {
      health.processedCount++;
      health.lastHeartbeat = new Date();
    }
  }

  incrementWorkerFailed(workerId: string): void {
    const health = this.workers.get(workerId);
    if (health) {
      health.failedCount++;
      health.lastHeartbeat = new Date();
    }
  }

  getCachedMetrics(jobType: JobType): QueueMetrics | null {
    return this.metricsCache.get(jobType) || null;
  }
}

let metricsCollector: QueueMetricsCollector | null = null;

export function getMetricsCollector(): QueueMetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new QueueMetricsCollector();
  }
  return metricsCollector;
}

export function initMetricsCollector(): QueueMetricsCollector {
  metricsCollector = new QueueMetricsCollector();
  return metricsCollector;
}

export function resetMetricsCollectorForTests(): void {
  metricsCollector = null;
}
