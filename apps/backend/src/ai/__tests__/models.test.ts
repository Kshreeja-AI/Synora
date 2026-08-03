import { describe, it, expect, beforeAll } from 'vitest';
import { listAvailableModels, getModelsForProvider } from '../models';
import { initConfig } from '../../config';

// Provider descriptors call getConfig() inside isConfigured(); the app path
// always calls initConfig() at startup, so mirror that here.
beforeAll(async () => {
  await initConfig();
});

describe('AI model catalog', () => {
  it('returns one catalog entry per registered provider', async () => {
    const catalog = await listAvailableModels();
    // 10 providers ship in PROVIDER_REGISTRY today; assert on the shape,
    // not the count — adding a provider should not break this test.
    expect(catalog.length).toBeGreaterThanOrEqual(10);
    for (const entry of catalog) {
      expect(entry).toHaveProperty('providerId');
      expect(entry).toHaveProperty('providerName');
      expect(entry).toHaveProperty('configured');
      expect(typeof entry.configured).toBe('boolean');
      expect(Array.isArray(entry.models)).toBe(true);
    }
  });

  it('never omits an unconfigured provider — the picker still shows them greyed-out', async () => {
    const catalog = await listAvailableModels();
    // In the test environment none of the real provider keys are set, so
    // most/all providers should come back configured=false. What we care
    // about is that they still show up.
    const unconfigured = catalog.filter((c) => !c.configured);
    expect(unconfigured.length).toBeGreaterThan(0);
  });

  it('curates real anthropic models with production-shaped metadata', () => {
    const models = getModelsForProvider('anthropic');
    expect(models.length).toBeGreaterThan(0);
    const sonnet = models.find((m) => m.id === 'claude-sonnet-5');
    expect(sonnet).toBeDefined();
    expect(sonnet!.contextWindow).toBeGreaterThan(0);
    expect(sonnet!.capabilities.streaming).toBe(true);
    // Anthropic frontier models support vision + tool use.
    expect(sonnet!.capabilities.vision).toBe(true);
    expect(sonnet!.capabilities.toolUse).toBe(true);
    // Price is USD per 1M tokens — sanity-check the shape, not the exact
    // number (prices change).
    expect(sonnet!.pricePerMillion?.input).toBeGreaterThan(0);
    expect(sonnet!.pricePerMillion?.output).toBeGreaterThan(0);
  });

  it('returns an empty list for an unknown provider rather than throwing', () => {
    expect(getModelsForProvider('does-not-exist')).toEqual([]);
  });
});
