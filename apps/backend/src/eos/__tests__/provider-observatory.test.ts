import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  recordProviderObservation,
  getProviderMatrix,
  startProviderObservatory,
  stopProviderObservatory,
} from '../provider-observatory';

describe('provider-observatory', () => {
  beforeEach(() => {
    stopProviderObservatory();
  });

  it('aggregates observations per provider:model', () => {
    recordProviderObservation({
      providerId: 'anthropic', modelId: 'claude-sonnet', latencyMs: 100,
      inputTokens: 500, outputTokens: 200, costCents: 3, success: true,
    });
    recordProviderObservation({
      providerId: 'anthropic', modelId: 'claude-sonnet', latencyMs: 300,
      inputTokens: 1000, outputTokens: 400, costCents: 6, success: true,
    });

    const matrix = getProviderMatrix();
    expect(matrix).toHaveLength(1);
    expect(matrix[0].providerId).toBe('anthropic');
    expect(matrix[0].requests).toBe(2);
    expect(matrix[0].successes).toBe(2);
    expect(matrix[0].successRate).toBe(1);
    expect(matrix[0].totalInputTokens).toBe(1500);
    expect(matrix[0].totalOutputTokens).toBe(600);
    expect(matrix[0].totalCostCents).toBe(9);
    expect(matrix[0].p50LatencyMs).toBe(100);
    expect(matrix[0].p95LatencyMs).toBe(300);
  });

  it('tracks failures and error codes', () => {
    recordProviderObservation({
      providerId: 'openai', modelId: 'gpt-4', latencyMs: 50,
      inputTokens: 0, outputTokens: 0, costCents: 0, success: false, errorCode: 'RATE_LIMITED',
    });
    recordProviderObservation({
      providerId: 'openai', modelId: 'gpt-4', latencyMs: 60,
      inputTokens: 0, outputTokens: 0, costCents: 0, success: false, errorCode: 'RATE_LIMITED',
    });
    recordProviderObservation({
      providerId: 'openai', modelId: 'gpt-4', latencyMs: 200,
      inputTokens: 100, outputTokens: 50, costCents: 2, success: true,
    });

    const matrix = getProviderMatrix();
    expect(matrix[0].failures).toBe(2);
    expect(matrix[0].successRate).toBeCloseTo(1 / 3);
    expect(matrix[0].errorCodes).toEqual({ RATE_LIMITED: 2 });
  });

  it('separates entries by provider and model', () => {
    recordProviderObservation({
      providerId: 'anthropic', modelId: 'claude-opus', latencyMs: 100,
      inputTokens: 1, outputTokens: 1, costCents: 1, success: true,
    });
    recordProviderObservation({
      providerId: 'anthropic', modelId: 'claude-haiku', latencyMs: 50,
      inputTokens: 1, outputTokens: 1, costCents: 1, success: true,
    });
    recordProviderObservation({
      providerId: 'openai', modelId: 'gpt-4', latencyMs: 150,
      inputTokens: 1, outputTokens: 1, costCents: 1, success: true,
    });

    const matrix = getProviderMatrix();
    expect(matrix).toHaveLength(3);
  });

  it('ingests observations from the event bus when started', () => {
    startProviderObservatory();

    engineeringEventBus.emit({
      type: 'ai.provider.observation',
      timestamp: Date.now(),
      source: 'ai-orchestrator',
      payload: {
        providerId: 'ollama', modelId: 'llama3', latencyMs: 400,
        inputTokens: 300, outputTokens: 150, costCents: 0, success: true,
      },
    });

    const matrix = getProviderMatrix();
    expect(matrix).toHaveLength(1);
    expect(matrix[0].providerId).toBe('ollama');
    expect(matrix[0].requests).toBe(1);
  });

  it('stops ingesting after stopProviderObservatory', () => {
    startProviderObservatory();
    stopProviderObservatory();

    engineeringEventBus.emit({
      type: 'ai.provider.observation',
      timestamp: Date.now(),
      source: 'ai-orchestrator',
      payload: {
        providerId: 'ollama', modelId: 'llama3', latencyMs: 400,
        inputTokens: 300, outputTokens: 150, costCents: 0, success: true,
      },
    });

    expect(getProviderMatrix()).toHaveLength(0);
  });

  it('startProviderObservatory is idempotent (no double ingestion)', () => {
    startProviderObservatory();
    startProviderObservatory();

    engineeringEventBus.emit({
      type: 'ai.provider.observation',
      timestamp: Date.now(),
      source: 'ai-orchestrator',
      payload: {
        providerId: 'anthropic', modelId: 'claude-sonnet', latencyMs: 100,
        inputTokens: 1, outputTokens: 1, costCents: 1, success: true,
      },
    });

    const matrix = getProviderMatrix();
    expect(matrix[0].requests).toBe(1);
  });

  it('sorts matrix by request count descending', () => {
    for (let i = 0; i < 3; i++) {
      recordProviderObservation({
        providerId: 'busy', modelId: 'm', latencyMs: 10,
        inputTokens: 1, outputTokens: 1, costCents: 0, success: true,
      });
    }
    recordProviderObservation({
      providerId: 'quiet', modelId: 'm', latencyMs: 10,
      inputTokens: 1, outputTokens: 1, costCents: 0, success: true,
    });

    const matrix = getProviderMatrix();
    expect(matrix[0].providerId).toBe('busy');
    expect(matrix[1].providerId).toBe('quiet');
  });
});
