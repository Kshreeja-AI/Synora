import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingAccumulator, TokenAccountant } from '../../../src/ai/streaming/accumulator';

describe('StreamingAccumulator', () => {
  let accumulator: StreamingAccumulator;

  beforeEach(() => {
    accumulator = new StreamingAccumulator();
  });

  it('should accumulate tokens correctly', () => {
    accumulator.addChunk('Hello');
    accumulator.addChunk(' ');
    accumulator.addChunk('world');

    expect(accumulator.getText()).toBe('Hello world');
    expect(accumulator.getTokenCount()).toBe(3);
  });

  it('should track elapsed time', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));

    // Node's timers are not guaranteed to fire at-or-after their exact
    // delay (a loaded event loop can clamp a 100ms timer to ~99ms), so
    // this asserts against a tolerance rather than the literal delay —
    // the previous hard `>= 100` flaked in CI on timing that was
    // correct to within a millisecond.
    expect(accumulator.getElapsedMs()).toBeGreaterThanOrEqual(90);
  });

  it('should calculate tokens per second', async () => {
    accumulator.addChunk('a');
    await new Promise(resolve => setTimeout(resolve, 100));
    accumulator.addChunk('b');

    const tps = accumulator.getTokensPerSecond();
    expect(tps).toBeGreaterThan(0);
  });

  it('should report progress at token intervals', () => {
    for (let i = 0; i < 49; i++) {
      accumulator.addChunk('t');
    }
    expect(accumulator.shouldReportProgress()).toBe(false);

    accumulator.addChunk('t');
    expect(accumulator.shouldReportProgress()).toBe(true);
  });

  it('should report progress at time intervals', async () => {
    accumulator.addChunk('t');
    expect(accumulator.shouldReportProgress(50, 100)).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 150));
    expect(accumulator.shouldReportProgress(50, 100)).toBe(true);
  });

  it('should mark progress reported', () => {
    for (let i = 0; i < 50; i++) {
      accumulator.addChunk('t');
    }
    expect(accumulator.shouldReportProgress()).toBe(true);

    accumulator.markProgressReported();
    expect(accumulator.shouldReportProgress()).toBe(false);
  });

  it('should reset state', () => {
    accumulator.addChunk('test');
    expect(accumulator.getTokenCount()).toBe(1);

    accumulator.reset();
    expect(accumulator.getTokenCount()).toBe(0);
    expect(accumulator.getText()).toBe('');
  });

  it('should provide summary', () => {
    accumulator.addChunk('Hello');
    const summary = accumulator.getSummary();

    expect(summary.text).toBe('Hello');
    expect(summary.tokenCount).toBe(1);
    expect(summary.tokensPerSecond).toBeGreaterThanOrEqual(0);
  });
});

describe('TokenAccountant', () => {
  let accountant: TokenAccountant;

  beforeEach(() => {
    accountant = new TokenAccountant('gpt-4', 'openai');
  });

  it('should track input tokens', () => {
    accountant.setInputTokens(1000);
    const summary = accountant.getSummary();

    expect(summary.inputTokens).toBe(1000);
    expect(summary.provider).toBe('openai');
    expect(summary.model).toBe('gpt-4');
  });

  it('should accumulate output tokens', () => {
    accountant.incrementOutputTokens(100);
    accountant.incrementOutputTokens(50);

    expect(accountant.getSummary().outputTokens).toBe(150);
  });

  it('should set estimated cost', () => {
    accountant.setEstimatedCost(123);

    expect(accountant.getSummary().estimatedCostCents).toBe(123);
  });

  it('should report progress at intervals', async () => {
    expect(accountant.shouldReportProgress()).toBe(true);

    accountant.markProgressReported();
    expect(accountant.shouldReportProgress()).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 5100));
    expect(accountant.shouldReportProgress()).toBe(true);
  }, 10000);

  it('should return summary with all fields', () => {
    accountant.setInputTokens(500);
    accountant.incrementOutputTokens(200);
    accountant.setEstimatedCost(75);

    const summary = accountant.getSummary();

    expect(summary).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      estimatedCostCents: 75,
      model: 'gpt-4',
      provider: 'openai'
    });
  });
});
