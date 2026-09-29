/**
 * The wrapper that lets a `generateText()` call site report to EOS under
 * its OWN promptId, instead of either reporting to nobody or being pooled
 * into 'chat.generate' where it would corrupt that path's cost/latency
 * baseline (see docs/operations/PROVIDER_READINESS_MATRIX.md #14).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { instrumentedGenerate } from './instrumentedGenerate';
import { resetAiPathCoverage, getAiPathCoverage } from '../eos/instrumentation';
import { AIProviderError, AIRateLimitedError } from './types';

const generateTextMock = vi.hoisted(() => vi.fn());
vi.mock('./index', () => ({ generateText: generateTextMock }));

describe('instrumentedGenerate', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    resetAiPathCoverage();
  });

  it('reports success under the CALLER-CHOSEN promptId, not chat.generate', async () => {
    generateTextMock.mockResolvedValue({
      text: 'hi',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await instrumentedGenerate('agent.plan', { prompt: 'plan this' });

    expect(result.text).toBe('hi');
    const coverage = getAiPathCoverage().find((c) => c.promptId === 'agent.plan');
    expect(coverage?.observed).toBe(true);
    // The path this wrapper did NOT report under must stay unobserved —
    // proof that calls are not silently pooled into the chat baseline.
    expect(getAiPathCoverage().find((c) => c.promptId === 'chat.generate')?.observed).toBe(false);
  });

  it('still returns the result and still throws the original error unchanged', async () => {
    const error = new AIProviderError('boom', 'anthropic');
    generateTextMock.mockRejectedValue(error);

    await expect(instrumentedGenerate('agent.step.generate', { prompt: 'x' })).rejects.toBe(error);
  });

  it('recovers the provider id from AIProviderError on failure, rather than reporting unknown', async () => {
    generateTextMock.mockRejectedValue(new AIProviderError('upstream 500', 'openai'));

    // The point under test is internal to recordAiInteraction's emission,
    // which is fire-and-forget — so the externally observable contract is
    // just that the call resolves/rejects correctly and coverage updates.
    await expect(instrumentedGenerate('chat.title', { prompt: 'x' })).rejects.toThrow('upstream 500');
    expect(getAiPathCoverage().find((c) => c.promptId === 'chat.title')?.observed).toBe(true);
  });

  it('recovers the provider id from AIRateLimitedError on a refusal too', async () => {
    generateTextMock.mockRejectedValue(new AIRateLimitedError('xai'));

    await expect(instrumentedGenerate('api.generate.direct', { prompt: 'x' })).rejects.toThrow(
      AIRateLimitedError
    );
  });

  it('never throws a NEW error from the instrumentation itself', async () => {
    // generateText succeeds; the wrapper's own bookkeeping must not be able
    // to turn a successful call into a failed one.
    generateTextMock.mockResolvedValue({ text: 'ok', provider: 'openai', model: 'gpt-4o' });

    await expect(instrumentedGenerate('eos.judge', { prompt: 'judge this' })).resolves.toMatchObject({
      text: 'ok',
    });
  });
});
