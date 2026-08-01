/**
 * Streaming job state machine
 * Manages lifecycle of streaming generation jobs
 */

import { prisma } from '@synora/database';
// Re-exported from the Prisma-generated enum rather than redeclared here —
// `streaming.service.ts` (Release 3 M2) already models StreamingJob's
// status against this same enum (spelled `CANCELED`, matching the
// `StreamingJob` model's migration); a second, differently-spelled local
// enum would silently desync from the actual column values.
import { StreamingJobStatus } from '@prisma/client';
import { logger } from '../../utils/logger';
import { TimeoutError, RateLimitError } from './types';

export { StreamingJobStatus };

const VALID_TRANSITIONS: Record<StreamingJobStatus, StreamingJobStatus[]> = {
  [StreamingJobStatus.PENDING]: [StreamingJobStatus.RUNNING, StreamingJobStatus.FAILED],
  [StreamingJobStatus.RUNNING]: [
    StreamingJobStatus.COMPLETED,
    StreamingJobStatus.FAILED,
    StreamingJobStatus.CANCELED
  ],
  [StreamingJobStatus.COMPLETED]: [],
  [StreamingJobStatus.FAILED]: [StreamingJobStatus.PENDING],
  [StreamingJobStatus.CANCELED]: []
};

export class StreamingJobStateMachine {
  private jobId: string;
  private currentStatus: StreamingJobStatus;

  constructor(jobId: string, initialStatus: StreamingJobStatus = StreamingJobStatus.PENDING) {
    this.jobId = jobId;
    this.currentStatus = initialStatus;
  }

  /**
   * Validate and perform state transition
   */
  async transition(
    to: StreamingJobStatus,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.isValidTransition(this.currentStatus, to)) {
      throw new Error(
        `Invalid state transition from ${this.currentStatus} to ${to}`
      );
    }

    logger.debug('[StateMachine] Transitioning', {
      jobId: this.jobId,
      from: this.currentStatus,
      to,
      metadata
    });

    this.currentStatus = to;

    // Persist state. `StreamingJob` only has a single `completedAt`
    // timestamp (see schema / `streaming.service.ts`) covering every
    // terminal state — there's no separate startedAt/failedAt/cancelledAt
    // column, and no metadata column, so `metadata` above is logged for
    // observability but not persisted.
    const isTerminal =
      to === StreamingJobStatus.COMPLETED ||
      to === StreamingJobStatus.FAILED ||
      to === StreamingJobStatus.CANCELED;

    await prisma.streamingJob.update({
      where: { id: this.jobId },
      data: {
        status: to,
        ...(isTerminal && { completedAt: new Date() }),
      }
    });
  }

  /**
   * Get current status
   */
  getCurrentStatus(): StreamingJobStatus {
    return this.currentStatus;
  }

  /**
   * Check if transition is valid
   */
  private isValidTransition(from: StreamingJobStatus, to: StreamingJobStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }
}

/**
 * Retry engine for streaming with exponential backoff
 */
export class StreamingRetryEngine {
  private readonly MAX_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_MS = [500, 1500];

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry<T>(
    jobId: string,
    operationName: string,
    operation: (attempt: number) => Promise<T>
  ): Promise<T> {
    const stateMachine = new StreamingJobStateMachine(jobId);

    for (let attempt = 0; attempt < this.MAX_ATTEMPTS; attempt++) {
      try {
        logger.info(`[Retry] Attempt ${attempt + 1}/${this.MAX_ATTEMPTS}`, {
          jobId,
          operation: operationName
        });

        await stateMachine.transition(StreamingJobStatus.RUNNING, { attempt });

        const result = await operation(attempt);

        logger.info('[Retry] Success', {
          jobId,
          operation: operationName,
          attempt: attempt + 1
        });

        return result;
      } catch (error: any) {
        const isRetryable = this.isRetryable(error);
        const isLastAttempt = attempt === this.MAX_ATTEMPTS - 1;

        logger.warn('[Retry] Attempt failed', {
          jobId,
          operation: operationName,
          attempt: attempt + 1,
          error: error.message,
          retryable: isRetryable,
          lastAttempt: isLastAttempt
        });

        // Update job with error
        await prisma.streamingJob.update({
          where: { id: jobId },
          data: {
            lastError: error.message,
            status: isLastAttempt && isRetryable ? StreamingJobStatus.FAILED : StreamingJobStatus.PENDING
          }
        });

        // If not retryable or last attempt, throw
        if (!isRetryable || isLastAttempt) {
          await stateMachine.transition(StreamingJobStatus.FAILED);
          throw error;
        }

        // Wait before retry
        const backoffMs = this.RETRY_BACKOFF_MS[attempt];
        logger.info('[Retry] Backoff', { jobId, backoffMs });
        await this.sleep(backoffMs);
      }
    }

    throw new Error(`Operation exhausted all ${this.MAX_ATTEMPTS} retry attempts`);
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(error: any): boolean {
    // Retryable errors
    if (error instanceof TimeoutError) return true;
    if (error instanceof RateLimitError) return true;
    if (error.message?.includes('ECONNRESET')) return true;
    if (error.message?.includes('ETIMEDOUT')) return true;
    if (error.code === 'SERVICE_OVERLOADED') return true;

    // Non-retryable errors
    if (error.code === 'INVALID_API_KEY') return false;
    if (error.code === 'INVALID_MODEL') return false;
    if (error.code === 'AUTHENTICATION_ERROR') return false;
    if (error.code === 'INSUFFICIENT_QUOTA') return false;

    // Default: don't retry unknown errors
    return false;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
