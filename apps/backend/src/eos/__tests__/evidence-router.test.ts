/**
 * Evidence router tests.
 *
 * This is the first component whose output could change what a customer
 * receives, so the properties under test are mostly about restraint: it
 * recommends rather than intercepts, it refuses to rank on thin data, it
 * never treats an unmeasured cost as free, and it says which basis a
 * decision came from so "we had no evidence" can never be mistaken for
 * "the evidence favoured this".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  rankCandidates,
  recommendRoute,
  DEFAULT_WEIGHTS,
  type RoutingCandidate,
} from '../evidence-router';
import {
  recordProviderObservation,
  startProviderObservatory,
  stopProviderObservatory,
} from '../provider-observatory';

const fast = { providerId: 'anthropic', modelId: 'claude-fast' };
const slow = { providerId: 'openai', modelId: 'gpt-slow' };
const candidates: RoutingCandidate[] = [fast, slow];

function observe(
  candidate: RoutingCandidate,
  n: number,
  opts: { latencyMs: number; success: boolean; costCents?: number },
) {
  for (let i = 0; i < n; i++) {
    recordProviderObservation({
      ...candidate,
      latencyMs: opts.latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      costCents: opts.costCents ?? 0,
      success: opts.success,
      tokenPriced: opts.costCents !== undefined,
    });
  }
}

describe('evidence-router', () => {
  beforeEach(stopProviderObservatory);

  describe('what it is not', () => {
    it('exposes no way to intercept or override a request path', async () => {
      const module = await import('../evidence-router');

      // It recommends. Adopting a recommendation is a deliberate change at
      // a call site, not a behaviour that switches on by itself.
      expect(
        Object.keys(module).some((key) => /intercept|override|apply|install|patch/i.test(key)),
      ).toBe(false);
    });
  });

  describe('without evidence', () => {
    it('keeps the configured order and says the basis was configuration', () => {
      const decision = recommendRoute(candidates)!;

      expect(decision.chosen).toEqual(fast);
      expect(decision.basis).toBe('configuration');
      // "We had no evidence" must never read as "the evidence favoured this".
      expect(decision.reasoning).toMatch(/absence of evidence, not a judgement/i);
      expect(decision.scoredCandidates).toBe(0);
    });

    it('explains per candidate why it could not be scored', () => {
      startProviderObservatory();
      observe(fast, 5, { latencyMs: 100, success: true });

      const [first, second] = rankCandidates(candidates);

      expect(first.score).toBeNull();
      expect(first.unscoredReason).toMatch(/Only 5 requests recorded/);
      expect(second.unscoredReason).toMatch(/No traffic has ever been recorded/);
    });

    it('returns null for an empty candidate list rather than inventing one', () => {
      expect(recommendRoute([])).toBeNull();
    });
  });

  describe('with evidence', () => {
    it('prefers the more reliable candidate over the faster one', () => {
      startProviderObservatory();
      // Fast but failing a fifth of the time.
      observe(fast, 40, { latencyMs: 100, success: true, costCents: 1 });
      observe(fast, 10, { latencyMs: 100, success: false, costCents: 1 });
      // Slower, but never fails.
      observe(slow, 50, { latencyMs: 400, success: true, costCents: 1 });

      const decision = recommendRoute(candidates)!;

      // Reliability is weighted highest because a failed response has no
      // value however quickly it arrives.
      expect(decision.chosen).toEqual(slow);
      expect(decision.basis).toBe('evidence');
    });

    it('prefers the faster candidate when reliability is equal', () => {
      startProviderObservatory();
      observe(fast, 50, { latencyMs: 100, success: true, costCents: 1 });
      observe(slow, 50, { latencyMs: 900, success: true, costCents: 1 });

      expect(recommendRoute(candidates)!.chosen).toEqual(fast);
    });

    it('reports the numbers behind the choice, not just the choice', () => {
      startProviderObservatory();
      observe(fast, 50, { latencyMs: 120, success: true, costCents: 2 });
      observe(slow, 50, { latencyMs: 900, success: true, costCents: 2 });

      const decision = recommendRoute(candidates)!;

      expect(decision.reasoning).toContain('success 100%');
      expect(decision.reasoning).toContain('120 ms');
      expect(decision.reasoning).toMatch(/per request/);
    });

    it('ranks only candidates with enough traffic, and says how many', () => {
      startProviderObservatory();
      observe(fast, 50, { latencyMs: 100, success: true, costCents: 1 });
      observe(slow, 3, { latencyMs: 50, success: true, costCents: 1 });

      const decision = recommendRoute(candidates)!;

      // The barely-observed candidate looks better on both dimensions and
      // is still not ranked — three requests prove nothing.
      expect(decision.scoredCandidates).toBe(1);
      expect(decision.chosen).toEqual(fast);
    });
  });

  describe('cost handling', () => {
    it('never treats an unmeasured cost as free', () => {
      startProviderObservatory();
      // Identical on reliability and latency; one reports cost, one does not.
      observe(fast, 50, { latencyMs: 100, success: true, costCents: 5 });
      observe(slow, 50, { latencyMs: 100, success: true }); // no cost fields

      const ranked = rankCandidates(candidates);
      const unpriced = ranked.find((r) => r.modelId === 'gpt-slow')!;

      // Null, not zero — and it must not win the cost dimension by virtue
      // of nobody having measured it.
      expect(unpriced.costPerRequestCents).toBeNull();
      const priced = ranked.find((r) => r.modelId === 'claude-fast')!;
      expect(priced.score).toBeGreaterThanOrEqual(unpriced.score as number);
    });

    it('prefers the cheaper candidate when reliability and speed match', () => {
      startProviderObservatory();
      observe(fast, 50, { latencyMs: 100, success: true, costCents: 1 });
      observe(slow, 50, { latencyMs: 100, success: true, costCents: 10 });

      expect(recommendRoute(candidates)!.chosen).toEqual(fast);
    });
  });

  describe('weights', () => {
    it('reports the weights it used, because they are a judgement not a measurement', () => {
      const decision = recommendRoute(candidates)!;
      expect(decision.weights).toEqual(DEFAULT_WEIGHTS);
    });

    it('honours a caller that values cost above all else', () => {
      startProviderObservatory();
      // Cheap but unreliable.
      observe(fast, 45, { latencyMs: 100, success: true, costCents: 1 });
      observe(fast, 5, { latencyMs: 100, success: false, costCents: 1 });
      // Perfect but expensive.
      observe(slow, 50, { latencyMs: 100, success: true, costCents: 50 });

      const balanced = recommendRoute(candidates)!;
      const costFirst = recommendRoute(candidates, { reliability: 0, latency: 0, cost: 1 })!;

      expect(balanced.chosen).toEqual(slow);
      // A different judgement produces a different answer, and the weights
      // travel with the decision so the difference is explicable.
      expect(costFirst.chosen).toEqual(fast);
      expect(costFirst.weights.cost).toBe(1);
    });
  });
});

describe('evidence-router near-ties', () => {
  beforeEach(stopProviderObservatory);

  it('flags a near-tie, because a relative score makes one look decisive', () => {
    startProviderObservatory();
    // Practically identical: 100% vs 100%, 100ms vs 102ms.
    observe(fast, 50, { latencyMs: 100, success: true, costCents: 1 });
    observe(slow, 50, { latencyMs: 102, success: true, costCents: 1 });

    const decision = recommendRoute(candidates)!;

    // Relative normalisation stretches a 2ms gap into a full 1.00 vs 0.00
    // on the latency dimension. Without this flag the recommendation would
    // read as confident when the underlying difference is noise.
    expect(decision.closeCall).toBe(true);
    expect(decision.reasoning).toMatch(/within measurement noise/i);
  });

  it('does not flag a genuine difference as a near-tie', () => {
    startProviderObservatory();
    observe(fast, 50, { latencyMs: 100, success: true, costCents: 1 });
    observe(slow, 50, { latencyMs: 900, success: true, costCents: 1 });

    const decision = recommendRoute(candidates)!;

    expect(decision.closeCall).toBe(false);
    expect(decision.reasoning).not.toMatch(/within measurement noise/i);
  });
});
