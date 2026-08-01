import { logger } from '../utils/logger';
import { getQueueAuditLog } from './audit';
import { JobType } from './types';

interface RetryConfig {
  attempts: number;
  backoffMs: number;
  backoffStrategy: 'exponential' | 'fixed';
}

export class RetryPolicy {
  private config: RetryConfig;

  constructor(config: RetryConfig = {
    attempts: 3,
    backoffMs: 1000,
    backoffStrategy: 'exponential',
  }) {
    this.config = config;
  }

  isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      'econnrefused',
      'enotfound',
      'etimedout',
      'ehostunreach',
      'enetunreach',
      'timeout',
      'network',
      'unavailable',
      'temporarily',
    ];

    const message = error.message.toLowerCase();
    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  calculateDelay(attemptNumber: number): number {
    if (this.config.backoffStrategy === 'fixed') {
      return this.config.backoffMs;
    }

    return this.config.backoffMs * Math.pow(2, attemptNumber - 1);
  }

  shouldRetry(attemptNumber: number, error: Error): boolean {
    if (attemptNumber >= this.config.attempts) {
      logger.warn('[RetryPolicy] Max retry attempts reached', {
        attempts: attemptNumber,
        error: error.message,
      });
      return false;
    }

    if (!this.isRetryableError(error)) {
      logger.warn('[RetryPolicy] Non-retryable error', {
        error: error.message,
      });
      return false;
    }

    return true;
  }

  getNextDelayMs(attemptNumber: number): number {
    const delay = this.calculateDelay(attemptNumber);
    logger.debug('[RetryPolicy] Calculated retry delay', {
      attemptNumber,
      delayMs: delay,
      strategy: this.config.backoffStrategy,
    });
    return delay;
  }
}

export class RetryManager {
  private retryPolicy: RetryPolicy;
  private activeRetries: Map<string, number> = new Map();
  private auditLog = getQueueAuditLog();

  constructor(config?: RetryConfig) {
    this.retryPolicy = new RetryPolicy(config);
  }

  recordRetry(jobId: string, jobType: JobType, attemptNumber: number, error: string): void {
    this.activeRetries.set(jobId, attemptNumber);
    this.auditLog.recordJobRetried(jobType, jobId, attemptNumber);

    logger.info('[RetryManager] Retrying job', {
      jobId,
      jobType,
      attemptNumber,
      error,
      nextDelayMs: this.retryPolicy.getNextDelayMs(attemptNumber),
    });
  }

  getRetryAttempt(jobId: string): number {
    return this.activeRetries.get(jobId) || 0;
  }

  clearRetry(jobId: string): void {
    this.activeRetries.delete(jobId);
  }

  shouldRetry(attemptNumber: number, error: Error): boolean {
    return this.retryPolicy.shouldRetry(attemptNumber, error);
  }

  getNextDelay(attemptNumber: number): number {
    return this.retryPolicy.getNextDelayMs(attemptNumber);
  }
}

let retryManager: RetryManager | null = null;

export function getRetryManager(config?: RetryConfig): RetryManager {
  if (!retryManager) {
    retryManager = new RetryManager(config);
  }
  return retryManager;
}

export function initRetryManager(config: RetryConfig): RetryManager {
  retryManager = new RetryManager(config);
  return retryManager;
}

export function resetRetryManagerForTests(): void {
  retryManager = null;
}
