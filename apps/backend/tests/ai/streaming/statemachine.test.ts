import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  StreamingJobStatus,
  StreamingJobStateMachine,
  StreamingRetryEngine
} from '../../src/ai/streaming/statemachine';
import { TimeoutError, RateLimitError } from '../../src/ai/streaming/types';
import { prisma } from '@synora/database';

vi.mock('@synora/database', () => ({
  prisma: {
    streamingJob: {
      update: vi.fn()
    }
  }
}));

describe('StreamingJobStateMachine', () => {
  let stateMachine: StreamingJobStateMachine;
  const jobId = 'test-job-123';

  beforeEach(() => {
    vi.clearAllMocks();
    stateMachine = new StreamingJobStateMachine(jobId, StreamingJobStatus.PENDING);
  });

  it('should initialize with PENDING status', () => {
    expect(stateMachine.getCurrentStatus()).toBe(StreamingJobStatus.PENDING);
  });

  it('should transition from PENDING to RUNNING', async () => {
    await stateMachine.transition(StreamingJobStatus.RUNNING);

    expect(stateMachine.getCurrentStatus()).toBe(StreamingJobStatus.RUNNING);
    expect(prisma.streamingJob.update).toHaveBeenCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({
        status: StreamingJobStatus.RUNNING,
        startedAt: expect.any(Date)
      })
    });
  });

  it('should transition from RUNNING to COMPLETED', async () => {
    await stateMachine.transition(StreamingJobStatus.RUNNING);
    await stateMachine.transition(StreamingJobStatus.COMPLETED);

    expect(stateMachine.getCurrentStatus()).toBe(StreamingJobStatus.COMPLETED);
    expect(prisma.streamingJob.update).toHaveBeenLastCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({
        status: StreamingJobStatus.COMPLETED,
        completedAt: expect.any(Date)
      })
    });
  });

  it('should reject invalid state transitions', async () => {
    await expect(
      stateMachine.transition(StreamingJobStatus.COMPLETED)
    ).rejects.toThrow('Invalid state transition');
  });

  it('should transition to CANCELLED from RUNNING', async () => {
    await stateMachine.transition(StreamingJobStatus.RUNNING);
    await stateMachine.transition(StreamingJobStatus.CANCELLED);

    expect(stateMachine.getCurrentStatus()).toBe(StreamingJobStatus.CANCELLED);
  });

  it('should transition from FAILED to PENDING for retry', async () => {
    await stateMachine.transition(StreamingJobStatus.RUNNING);
    await stateMachine.transition(StreamingJobStatus.FAILED);
    await stateMachine.transition(StreamingJobStatus.PENDING);

    expect(stateMachine.getCurrentStatus()).toBe(StreamingJobStatus.PENDING);
  });
});

describe('StreamingRetryEngine', () => {
  let retryEngine: StreamingRetryEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    retryEngine = new StreamingRetryEngine();
  });

  it('should succeed on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await retryEngine.executeWithRetry(
      'job-123',
      'testOp',
      operation
    );

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable error', async () => {
    const error = new TimeoutError('Connection timeout');
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('success');

    const result = await retryEngine.executeWithRetry(
      'job-123',
      'testOp',
      operation
    );

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should not retry on non-retryable error', async () => {
    const error = new Error('INVALID_API_KEY');
    error['code'] = 'INVALID_API_KEY';
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      retryEngine.executeWithRetry('job-123', 'testOp', operation)
    ).rejects.toThrow('INVALID_API_KEY');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should exhaust retries and throw', async () => {
    const error = new TimeoutError('Connection timeout');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      retryEngine.executeWithRetry('job-123', 'testOp', operation)
    ).rejects.toThrow();

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should classify RateLimitError as retryable', async () => {
    const error = new RateLimitError('Rate limit exceeded');
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('success');

    const result = await retryEngine.executeWithRetry(
      'job-123',
      'testOp',
      operation
    );

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should classify INSUFFICIENT_QUOTA as non-retryable', async () => {
    const error = new Error('Quota exceeded');
    error['code'] = 'INSUFFICIENT_QUOTA';
    const operation = vi.fn().mockRejectedValue(error);

    await expect(
      retryEngine.executeWithRetry('job-123', 'testOp', operation)
    ).rejects.toThrow('Quota exceeded');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should classify connection errors as retryable', async () => {
    const error = new Error('ECONNRESET');
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('success');

    const result = await retryEngine.executeWithRetry(
      'job-123',
      'testOp',
      operation
    );

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
