import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { listAvailableModels, getModelsForProvider, modelCatalogGaps } from '../models';
import { initConfig, __resetConfigForTests } from '../../config';

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

describe('config-driven endpoint catalogs', () => {
  // Which models a GPU box serves is a deployment fact only the deployment
  // knows — so these catalogs are built from configuration at call time,
  // never hand-maintained. (The hardcoded card this replaced advertised
  // 'llama3.3' while the config default was 'llama3.1' — stale by
  // construction, exactly as predicted.)
  afterEach(async () => {
    delete process.env.OLLAMA_MODELS;
    delete process.env.OLLAMA_MODEL;
    delete process.env.SELF_HOSTED_TEXT_MODEL;
    delete process.env.SELF_HOSTED_TEXT_MODELS;
    __resetConfigForTests();
    await initConfig();
  });

  async function reloadWith(env: Record<string, string>): Promise<void> {
    Object.assign(process.env, env);
    __resetConfigForTests();
    await initConfig();
  }

  it('lists every named model from OLLAMA_MODELS plus the default', async () => {
    await reloadWith({ OLLAMA_MODEL: 'llama3.1', OLLAMA_MODELS: 'qwen2.5-coder,phi4' });
    const ids = getModelsForProvider('ollama').map((m) => m.id);
    expect(ids).toEqual(['llama3.1', 'qwen2.5-coder', 'phi4']);
  });

  it('deduplicates when the default model is repeated in the list', async () => {
    // Non-vacuity for the dedup: a blind concatenation would yield 3 cards.
    await reloadWith({ OLLAMA_MODEL: 'llama3.1', OLLAMA_MODELS: 'llama3.1,phi4' });
    const ids = getModelsForProvider('ollama').map((m) => m.id);
    expect(ids).toEqual(['llama3.1', 'phi4']);
  });

  it('keeps the catalog gaps empty with and without the env set', async () => {
    // Every registered provider id must yield at least one card, or the
    // picker renders a configured provider with nothing selectable.
    expect(modelCatalogGaps()).toEqual({ providersWithoutModels: [], orphanedCatalogKeys: [] });
    await reloadWith({ OLLAMA_MODELS: 'a,b,c' });
    expect(modelCatalogGaps()).toEqual({ providersWithoutModels: [], orphanedCatalogKeys: [] });
  });

  it('builds the self-hosted catalog from its own config, not from Ollama config', async () => {
    await reloadWith({
      SELF_HOSTED_TEXT_MODEL: 'meta-llama/Llama-3.1-8B-Instruct',
      SELF_HOSTED_TEXT_MODELS: 'Qwen/Qwen2.5-7B-Instruct',
    });
    const ids = getModelsForProvider('self-hosted').map((m) => m.id);
    expect(ids).toEqual(['meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen2.5-7B-Instruct']);
  });

  it('understates the context window rather than guessing a big one', async () => {
    // The true limit belongs to the serving endpoint. Understating degrades
    // gracefully; overstating truncates someone's document mid-thought.
    await reloadWith({ OLLAMA_MODELS: 'qwen2.5' });
    for (const card of getModelsForProvider('ollama')) {
      expect(card.contextWindow).toBeLessThanOrEqual(8_000);
    }
  });
});
