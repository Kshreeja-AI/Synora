import { Queue } from 'bullmq';
import { getRedis } from './redis';
import { getMetricsCollector } from './metrics';
import { QueueHealthCheck, QueueMetrics, WorkerHealth, JobType } from './types';
import type { QueueWorker } from './worker';
import { logger } from '../utils/logger';

export class HealthChecker {
  private queues: Map<JobType, Queue> = new Map();
  private workers: Map<string, QueueWorker> = new Map();
  private lastHealthCheckTime: Date | null = null;

  registerQueue(jobType: JobType, queue: Queue): void {
    this.queues.set(jobType, queue);
  }

  registerWorker(workerId: string, worker: QueueWorker): void {
    this.workers.set(workerId, worker);
  }

  async check(): Promise<QueueHealthCheck> {
    this.lastHealthCheckTime = new Date();

    const redisManager = getRedis();
    const metricsCollector = getMetricsCollector();
    const isRedisHealthy = await redisManager.ping();

    const queuesMetrics = new Map<JobType, QueueMetrics>();
    for (const [jobType] of this.queues) {
      try {
        const metrics = await metricsCollector.collectMetrics(jobType);
        queuesMetrics.set(jobType, metrics);
      } catch (error) {
        logger.error('[HealthChecker] Failed to collect metrics for queue', {
          jobType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const workersHealth = new Map<string, WorkerHealth>();
    for (const [workerId] of this.workers) {
      const health = metricsCollector.getWorkerHealth(workerId);
      if (health) {
        workersHealth.set(workerId, health);
      }
    }

    const overallStatus = this.determineOverallStatus(isRedisHealthy, queuesMetrics, workersHealth);

    return {
      status: overallStatus,
      redis: {
        status: isRedisHealthy ? 'connected' : 'disconnected',
      },
      queues: queuesMetrics,
      workers: workersHealth,
    };
  }

  private determineOverallStatus(
    isRedisHealthy: boolean,
    queuesMetrics: Map<JobType, QueueMetrics>,
    workersHealth: Map<string, WorkerHealth>
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (!isRedisHealthy) {
      return 'unhealthy';
    }

    let hasIssues = false;

    for (const metrics of queuesMetrics.values()) {
      const errorRate = metrics.failed / (metrics.processed + metrics.failed + 1);
      if (errorRate > 0.1) {
        hasIssues = true;
      }
    }

    for (const health of workersHealth.values()) {
      const timeSinceHeartbeat = Date.now() - new Date(health.lastHeartbeat).getTime();
      if (timeSinceHeartbeat > 60000) {
        hasIssues = true;
      }
    }

    return hasIssues ? 'degraded' : 'healthy';
  }

  getLastHealthCheckTime(): Date | null {
    return this.lastHealthCheckTime;
  }
}

let healthChecker: HealthChecker | null = null;

export function initHealthChecker(): HealthChecker {
  healthChecker = new HealthChecker();
  return healthChecker;
}

export function getHealthChecker(): HealthChecker {
  if (!healthChecker) {
    healthChecker = new HealthChecker();
  }
  return healthChecker;
}

export function resetHealthCheckerForTests(): void {
  healthChecker = null;
}
