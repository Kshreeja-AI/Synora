import { describe, it, expect, vi, afterEach } from 'vitest';
import { CircuitBreaker } from '../circuitBreaker';

describe('CircuitBreaker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and allows attempts', () => {
    const breaker = new CircuitBreaker('openai', {
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenSuccessThreshold: 1,
    });
    expect(breaker.getState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('opens after reaching the failure threshold', () => {
    const breaker = new CircuitBreaker('openai', {
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenSuccessThreshold: 1,
    });

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');
    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('resets the failure count on success', () => {
    const breaker = new CircuitBreaker('openai', {
      failureThreshold: 3,
      cooldownMs: 1000,
      halfOpenSuccessThreshold: 1,
    });

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    // Two failures after the reset — still below threshold of 3.
    expect(breaker.getState()).toBe('closed');
  });

  it('transitions to half-open after the cooldown elapses', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker('openai', {
      failureThreshold: 1,
      cooldownMs: 5000,
      halfOpenSuccessThreshold: 1,
    });

    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');

    vi.advanceTimersByTime(5001);
    expect(breaker.getState()).toBe('half-open');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('closes again after enough half-open successes', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker('openai', {
      failureThreshold: 1,
      cooldownMs: 1000,
      halfOpenSuccessThreshold: 2,
    });

    breaker.recordFailure();
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe('half-open');

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('half-open');
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('closed');
  });

  it('reopens immediately on a half-open failure', () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker('openai', {
      failureThreshold: 1,
      cooldownMs: 1000,
      halfOpenSuccessThreshold: 2,
    });

    breaker.recordFailure();
    vi.advanceTimersByTime(1001);
    expect(breaker.getState()).toBe('half-open');

    breaker.recordFailure();
    expect(breaker.getState()).toBe('open');
  });
});
