import { describe, it, expect, beforeEach } from 'vitest';
import { engineeringEventBus } from '../event-bus';
import {
  recordAiInteraction,
  declareAiPath,
  getAiPathCoverage,
  resetAiPathCoverage,
  KNOWN_AI_PATHS,
} from '../instrumentation';
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

  it('marks a record token-priced only when token or cost fields are supplied', () => {
    startProviderObservatory();
    recordAiInteraction(base);
    recordAiInteraction({ ...base, providerId: 'openai', modelId: 'gpt-image-1', inputTokens: undefined, outputTokens: undefined, costCents: undefined });

    const matrix = getProviderMatrix();
    const chat = matrix.find((m) => m.modelId === 'claude-x')!;
    const image = matrix.find((m) => m.modelId === 'gpt-image-1')!;

    expect(chat.tokenPriced).toBe(true);
    // Image supplied no token or cost fields at all, so it is not
    // token-priced — as distinct from costing zero.
    expect(image.tokenPriced).toBe(false);
  });

  it('a token-priced call costing zero stays token-priced', () => {
    startProviderObservatory();
    recordAiInteraction({ ...base, inputTokens: 0, outputTokens: 0, costCents: 0 });

    // The previous display heuristic inferred pricing from a non-zero cost
    // and would have mislabelled this row.
    expect(getProviderMatrix()[0].tokenPriced).toBe(true);
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

  describe('path coverage', () => {
    it('reports every known path, defaulting to uninstrumented', () => {
      resetAiPathCoverage();
      const coverage = getAiPathCoverage();

      expect(coverage).toHaveLength(KNOWN_AI_PATHS.length);
      // A capability that exists but never instruments itself must appear as
      // a gap, not vanish from the reckoning.
      expect(coverage.every((c) => !c.instrumented)).toBe(true);
      expect(coverage.map((c) => c.promptId)).toContain('video.generate');
    });

    it('marks a path instrumented once it declares itself', () => {
      resetAiPathCoverage();
      declareAiPath('chat.generate');

      const chat = getAiPathCoverage().find((c) => c.promptId === 'chat.generate')!;
      expect(chat.instrumented).toBe(true);
      // Declared but not yet exercised — a distinction the dashboard shows.
      expect(chat.observed).toBe(false);
    });

    it('marks a path observed once it actually reports', () => {
      resetAiPathCoverage();
      declareAiPath('chat.generate');
      recordAiInteraction(base);

      const chat = getAiPathCoverage().find((c) => c.promptId === 'chat.generate')!;
      expect(chat.instrumented).toBe(true);
      expect(chat.observed).toBe(true);
    });

    it('an undeclared path that reports still shows as uninstrumented', () => {
      resetAiPathCoverage();
      recordAiInteraction({ ...base, promptId: 'image.generate' });

      // Observation without declaration means someone instrumented a path
      // but forgot to declare it — surfaced rather than silently accepted.
      const image = getAiPathCoverage().find((c) => c.promptId === 'image.generate')!;
      expect(image.observed).toBe(true);
      expect(image.instrumented).toBe(false);
    });
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
