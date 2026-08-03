/**
 * Media pricing tests.
 *
 * This is the one table of expectations the platform permits, because an
 * image provider bills per image and reports no cost with the response —
 * there is nothing to measure. These tests hold it to the constraints that
 * make it safe: a missing price yields nothing rather than zero, a derived
 * figure stays marked as stated rather than observed, and a per-image cost
 * never masquerades as token pricing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMediaPrice,
  getMediaPrice,
  listMediaPrices,
  priceMediaUsage,
  priceAgeDays,
  resetMediaPrices,
} from '../media-pricing';
import { recordAiInteraction } from '../instrumentation';
import { getProviderMatrix, startProviderObservatory, stopProviderObservatory } from '../provider-observatory';
import { startCostMonitor, stopCostMonitor, getCostReport } from '../cost-monitor';

const imagePrice = {
  providerId: 'openai',
  modelId: 'gpt-image-1',
  basis: 'per-image' as const,
  centsPerUnit: 4,
  statedOn: '2026-08-01',
  source: 'provider published rate card',
};

describe('media-pricing', () => {
  beforeEach(() => {
    resetMediaPrices();
    stopProviderObservatory();
    stopCostMonitor();
  });

  it('ships with no prices, rather than invented placeholders', () => {
    // A wrong number that looks authoritative is worse than an admitted
    // absence, and a placeholder would flow into cost reporting as real.
    expect(listMediaPrices()).toEqual([]);
  });

  it('returns null for an unpriced model instead of zero', () => {
    expect(priceMediaUsage({ providerId: 'openai', modelId: 'unknown', units: 3 })).toBeNull();
  });

  it('prices usage once a published rate is on record', () => {
    registerMediaPrice(imagePrice);

    const result = priceMediaUsage({ providerId: 'openai', modelId: 'gpt-image-1', units: 3 })!;

    expect(result.costCents).toBe(12);
    expect(result.basis).toBe('per-image');
    // Never 'observed': this came from a table, not from the provider.
    expect(result.provenance).toBe('stated');
    expect(result.statedOn).toBe('2026-08-01');
  });

  it('records where a price came from so it can be rechecked', () => {
    registerMediaPrice(imagePrice);
    expect(getMediaPrice('openai', 'gpt-image-1')!.source).toMatch(/published rate card/);
  });

  it('reports how stale a price is', () => {
    const now = Date.parse('2026-08-31');
    expect(priceAgeDays(imagePrice, now)).toBe(30);
  });

  it('returns null rather than a number for an unparseable date', () => {
    expect(priceAgeDays({ ...imagePrice, statedOn: 'sometime' })).toBeNull();
  });

  it('refuses negative or non-finite units', () => {
    registerMediaPrice(imagePrice);
    expect(priceMediaUsage({ providerId: 'openai', modelId: 'gpt-image-1', units: -1 })).toBeNull();
    expect(priceMediaUsage({ providerId: 'openai', modelId: 'gpt-image-1', units: NaN })).toBeNull();
  });

  describe('flowing into the matrix', () => {
    it('a per-image cost is not reported as token pricing', () => {
      startProviderObservatory();
      registerMediaPrice(imagePrice);
      const priced = priceMediaUsage({ providerId: 'openai', modelId: 'gpt-image-1', units: 2 })!;

      recordAiInteraction({
        promptId: 'image.generate',
        providerId: 'openai',
        modelId: 'gpt-image-1',
        success: true,
        latencyMs: 900,
        costCents: priced.costCents,
        pricingBasis: priced.basis,
        costProvenance: priced.provenance,
      });

      const entry = getProviderMatrix()[0];
      expect(entry.totalCostCents).toBe(8);
      expect(entry.pricingBasis).toBe('per-image');
      expect(entry.costProvenance).toBe('stated');
      // The old inference would have flipped this to true the moment a cost
      // appeared, attaching a false basis to a real number.
      expect(entry.tokenPriced).toBe(false);
    });

    it('leaves token-priced chat unchanged', () => {
      startProviderObservatory();
      recordAiInteraction({
        promptId: 'chat.generate',
        providerId: 'anthropic',
        modelId: 'claude-x',
        success: true,
        latencyMs: 100,
        inputTokens: 10,
        outputTokens: 5,
        costCents: 2,
      });

      const entry = getProviderMatrix()[0];
      expect(entry.tokenPriced).toBe(true);
      // Not stated: the provider reported this cost.
      expect(entry.costProvenance).toBeUndefined();
    });

    it('an unpriced media call still reports no cost at all', () => {
      startProviderObservatory();
      recordAiInteraction({
        promptId: 'image.generate',
        providerId: 'openai',
        modelId: 'gpt-image-1',
        success: true,
        latencyMs: 900,
      });

      const entry = getProviderMatrix()[0];
      expect(entry.tokenPriced).toBe(false);
      expect(entry.pricingBasis).toBeUndefined();
    });
  });

  describe('flowing into cost monitoring', () => {
    it('brings media spend into anomaly detection once it is priced', () => {
      startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });
      registerMediaPrice(imagePrice);

      const emit = (units: number) => {
        const priced = priceMediaUsage({ providerId: 'openai', modelId: 'gpt-image-1', units })!;
        recordAiInteraction({
          promptId: 'image.generate',
          providerId: 'openai',
          modelId: 'gpt-image-1',
          success: true,
          latencyMs: 900,
          costCents: priced.costCents,
          pricingBasis: priced.basis,
          costProvenance: priced.provenance,
        });
      };

      for (let i = 0; i < 25; i++) emit(1);

      const entry = getCostReport()[0];
      expect(entry.providerId).toBe('openai');
      expect(entry.requests).toBe(25);
    });

    it('still ignores media calls that carry no price', () => {
      startCostMonitor({ windowSize: 5, minBaselineSamples: 20 });

      for (let i = 0; i < 30; i++) {
        recordAiInteraction({
          promptId: 'image.generate',
          providerId: 'openai',
          modelId: 'gpt-image-1',
          success: true,
          latencyMs: 900,
        });
      }

      // No published price means no basis, so nothing is tracked — as
      // distinct from tracking it as free.
      expect(getCostReport()).toHaveLength(0);
    });
  });
});
