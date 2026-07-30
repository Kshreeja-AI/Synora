import { describe, it, expect, beforeEach } from 'vitest';
import { RetryPolicy, initRetryManager, resetRetryManagerForTests } from '../retry';

describe('RetryPolicy', () => {
  it('should calculate exponential backoff', () => {
    const policy = new RetryPolicy({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    expect(policy.calculateDelay(1)).toBe(1000);
    expect(policy.calculateDelay(2)).toBe(2000);
    expect(policy.calculateDelay(3)).toBe(4000);
  });

  it('should calculate fixed backoff', () => {
    const policy = new RetryPolicy({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'fixed',
    });

    expect(policy.calculateDelay(1)).toBe(1000);
    expect(policy.calculateDelay(2)).toBe(1000);
    expect(policy.calculateDelay(3)).toBe(1000);
  });

  it('should identify retryable errors', () => {
    const policy = new RetryPolicy();

    expect(policy.isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(policy.isRetryableError(new Error('Connection timeout'))).toBe(true);
    expect(policy.isRetryableError(new Error('Network unavailable'))).toBe(true);
    expect(policy.isRetryableError(new Error('Invalid input'))).toBe(false);
  });

  it('should determine if retry should happen', () => {
    const policy = new RetryPolicy({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    const retryableError = new Error('ECONNREFUSED');
    const nonRetryableError = new Error('Invalid input');

    expect(policy.shouldRetry(1, retryableError)).toBe(true);
    expect(policy.shouldRetry(2, retryableError)).toBe(true);
    expect(policy.shouldRetry(3, retryableError)).toBe(false);
    expect(policy.shouldRetry(1, nonRetryableError)).toBe(false);
  });
});

describe('RetryManager', () => {
  beforeEach(() => {
    resetRetryManagerForTests();
  });

  it('should record retry attempt', () => {
    const manager = initRetryManager({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    manager.recordRetry('job-1', 'generate_response', 1, 'Connection timeout');
    expect(manager.getRetryAttempt('job-1')).toBe(1);
  });

  it('should clear retry record', () => {
    const manager = initRetryManager({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    manager.recordRetry('job-1', 'generate_response', 1, 'Connection timeout');
    manager.clearRetry('job-1');
    expect(manager.getRetryAttempt('job-1')).toBe(0);
  });

  it('should get next delay with exponential backoff', () => {
    const manager = initRetryManager({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    expect(manager.getNextDelay(1)).toBe(1000);
    expect(manager.getNextDelay(2)).toBe(2000);
    expect(manager.getNextDelay(3)).toBe(4000);
  });

  it('should determine retry eligibility', () => {
    const manager = initRetryManager({
      attempts: 3,
      backoffMs: 1000,
      backoffStrategy: 'exponential',
    });

    const retryableError = new Error('ECONNREFUSED');
    expect(manager.shouldRetry(1, retryableError)).toBe(true);
    expect(manager.shouldRetry(3, retryableError)).toBe(false);
  });
});
