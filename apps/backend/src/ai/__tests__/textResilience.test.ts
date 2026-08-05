/**
 * Text-path resilience — the behavior a real outage will exercise.
 *
 * No provider is contacted: a fake TextGenerationProvider simulates the
 * failure shapes (transient blip, permanent refusal, stall, sustained
 * outage) and the assertions pin how Synora responds to each. The rules
 * under test are the SAME shared modules the embeddings stack runs, so
 * these tests also guard against the two stacks drifting apart.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateWithResilience, resetTextResilienceForTests } from '../textResilience';
import { AIProviderError } from '../types';
import type { TextGenerationProvider, TextGenerationResult } from '../types';

const okResult: TextGenerationResult = {
  text: 'hello',
  provider: 'fake',
  model: 'fake-model',
};

function providerWith(
  generate: () => Promise<TextGenerationResult>,
): TextGenerationProvider {
  return {
    id: 'fake',
    capabilities: ['text-generation'],
    generateText: vi.fn(generate),
  };
}

beforeEach(() => {
  resetTextResilienceForTests();
  vi.clearAllMocks();
});

describe('generateWithResilience', () => {
  it('passes a healthy call straight through', async () => {
    const provider = providerWith(async () => okResult);
    const result = await generateWithResilience(provider, { prompt: 'hi' });
    expect(result.text).toBe('hello');
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it('absorbs a transient blip inside one call', async () => {
    let calls = 0;
    const provider = providerWith(async () => {
      calls += 1;
      if (calls === 1) throw new Error('503 service unavailable');
      return okResult;
    });

    const result = await generateWithResilience(provider, { prompt: 'hi' });
    // The user sees a slightly slower success, never the blip.
    expect(result.text).toBe('hello');
    expect(calls).toBe(2);
  });

  it('does not retry a permanent refusal — repeating a 401 only repeats it', async () => {
    const provider = providerWith(async () => {
      throw new Error('401 invalid api key');
    });

    await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow(/401/);
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget, not never', async () => {
    const provider = providerWith(async () => {
      throw new Error('network timeout');
    });

    await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow(/timeout/);
    // 3 attempts total: the budget bounds latency; infinity is not a policy.
    expect(provider.generateText).toHaveBeenCalledTimes(3);
  });

  it('fails fast once a provider has failed repeatedly, instead of making every user wait', async () => {
    // A non-retryable failure shape (so each call is a single attempt and
    // the test does not sleep out real backoff): the breaker counts
    // FAILED CALLS, not attempts, and it counts permanent refusals too —
    // five 401s in a row is just as much a down provider as five 502s.
    const provider = providerWith(async () => {
      throw new Error('401 invalid api key');
    });

    // Threshold is 5 consecutive failed calls.
    for (let i = 0; i < 5; i++) {
      await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow();
    }
    const callsBeforeTrip = vi.mocked(provider.generateText).mock.calls.length;

    // The 6th call must not touch the provider at all.
    await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow(
      AIProviderError,
    );
    await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow(
      /temporarily unavailable/,
    );
    expect(vi.mocked(provider.generateText).mock.calls.length).toBe(callsBeforeTrip);
  });

  it('says the pause is temporary and self-healing, not that the provider is broken forever', async () => {
    const provider = providerWith(async () => {
      throw new Error('403 forbidden');
    });
    for (let i = 0; i < 5; i++) {
      await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow();
    }

    await expect(generateWithResilience(provider, { prompt: 'hi' })).rejects.toThrow(
      /resume automatically/i,
    );
  });
});
