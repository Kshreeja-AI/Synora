import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import { recordAiInteraction } from '../instrumentation';
import { getProviderMatrix, startProviderObservatory, stopProviderObservatory } from '../provider-observatory';
import { getPromptReport, startPromptIntelligence, stopPromptIntelligence } from '../prompt-intelligence';
import { getCases, resetDatasets } from '../evaluation-datasets';
import { startCaseCapture, stopCaseCapture } from '../case-capture';

const base = {
  promptId: 'chat.generate',
  providerId: 'anthropic',
  modelId: 'claude-x',
  success: true,
  latencyMs: 120,
  inputTokens: 100,
  outputTokens: 50,
  costCents: 3,
};

describe('instrumentation', () => {
  beforeEach(() => {
    stopProviderObservatory();
    stopPromptIntelligence();
    stopCaseCapture();
    resetDatasets();
  });

  it('emits provider observation and prompt outcome from a single call', () => {
    const types: string[] = [];
    const unsub = engineeringEventBus.onAll((e) => types.push(e.type));

    recordAiInteraction(base);

    expect(types).toContain('ai.provider.observation');
    expect(types).toContain('ai.prompt.outcome');
    unsub();
  });

  it('feeds the provider matrix end to end', () => {
    startProviderObservatory();
    recordAiInteraction(base);
    recordAiInteraction({ ...base, success: false, errorCode: 'timeout' });

    const matrix = getProviderMatrix();
    expect(matrix).toHaveLength(1);
    expect(matrix[0].providerId).toBe('anthropic');
    expect(matrix[0].requests).toBe(2);
    expect(matrix[0].successRate).toBe(0.5);
    expect(matrix[0].errorCodes.timeout).toBe(1);
  });

  it('feeds prompt intelligence end to end', () => {
    startPromptIntelligence();
    recordAiInteraction(base);
    recordAiInteraction({ ...base, success: false });

    const report = getPromptReport();
    expect(report).toHaveLength(1);
    expect(report[0].promptId).toBe('chat.generate');
    expect(report[0].executions).toBe(2);
    expect(report[0].successRate).toBe(0.5);
  });

  it('does not emit interaction text when content is omitted', () => {
    const events: unknown[] = [];
    const unsub = engineeringEventBus.on('ai.interaction.completed', (e) => events.push(e));

    recordAiInteraction(base);

    // No content means no case can ever be captured — the safe default.
    expect(events).toHaveLength(0);
    unsub();
  });

  it('captures a case end to end when content is supplied with consent', () => {
    startCaseCapture({ datasetId: 'ds' });
    recordAiInteraction({
      ...base,
      success: false,
      content: { input: 'the question', output: 'the bad answer', consented: true },
    });

    const cases = getCases('ds');
    expect(cases).toHaveLength(1);
    expect(cases[0].origin).toBe('real');
    expect(cases[0].input).toBe('the question');
  });

  it('captures nothing when consent is false', () => {
    startCaseCapture({ datasetId: 'ds' });
    recordAiInteraction({
      ...base,
      success: false,
      content: { input: 'q', output: 'a', consented: false },
    });

    expect(getCases('ds')).toHaveLength(0);
  });

  it('redacts captured text', () => {
    startCaseCapture({ datasetId: 'ds' });
    recordAiInteraction({
      ...base,
      success: false,
      content: { input: 'reach me at keshav@synora.ai', output: 'ok', consented: true },
    });

    expect(getCases('ds')[0].input).toContain('[REDACTED_EMAIL]');
  });

  it('a throwing subscriber never propagates to the caller', () => {
    const unsub = engineeringEventBus.on('ai.provider.observation', () => {
      throw new Error('subscriber exploded');
    });

    // Observability must never fail a customer-facing request.
    expect(() => recordAiInteraction(base)).not.toThrow();
    unsub();
  });

  it('one failing subscriber does not prevent the others receiving events', () => {
    const seen: string[] = [];
    const bad = engineeringEventBus.on('ai.provider.observation', () => {
      throw new Error('boom');
    });
    const good = engineeringEventBus.on('ai.prompt.outcome', (e) => seen.push(e.type));

    recordAiInteraction(base);

    expect(seen).toEqual(['ai.prompt.outcome']);
    bad();
    good();
  });
});
