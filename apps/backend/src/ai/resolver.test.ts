import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveProvider, resolveTextGenerationProvider } from './resolver';
import { PROVIDER_REGISTRY } from './registry';
import { initConfig, __resetConfigForTests } from '../config';

describe('resolveTextGenerationProvider', () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    // No SDK call is made by resolution itself — descriptor.create() only
    // constructs the vendor client. A fake key is enough to exercise real
    // fallback-to-first-configured-provider selection with no network I/O.
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    await initConfig();
  });

  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = previousKey;
    __resetConfigForTests();
  });

  it('returns a text generation provider', async () => {
    const provider = await resolveTextGenerationProvider();
    expect(provider).toBeDefined();
    expect(provider.generateText).toBeDefined();
  });

  it('returns provider with required generateText method', async () => {
    const provider = await resolveTextGenerationProvider();
    expect(typeof provider.generateText).toBe('function');
  });

  it('returns provider supporting text-generation capability', async () => {
    const provider = await resolveTextGenerationProvider();
    const descriptor = PROVIDER_REGISTRY.find((p) => p.id === provider.id);
    expect(descriptor?.capabilities).toContain('text-generation');
  });

  it('filters to providers supporting text-generation', async () => {
    const provider = await resolveTextGenerationProvider();
    expect(provider).toBeDefined();
    const descriptor = PROVIDER_REGISTRY.find((p) => p.id === provider.id);
    expect(descriptor).toBeDefined();
  });

  describe('explicitProviderId (Release 3 M2 — Conversation.provider override)', () => {
    it('honors an explicit provider id, taking priority over auto-detection', async () => {
      const provider = await resolveProvider('text-generation', { explicitProviderId: 'anthropic' });
      expect(provider.id).toBe('anthropic');
    });

    it('throws a clear, source-labeled error for an unknown explicit provider id', async () => {
      await expect(
        resolveProvider('text-generation', { explicitProviderId: 'not-a-real-provider' })
      ).rejects.toThrow(/the requested provider is set to "not-a-real-provider"/i);
    });

    it('throws when the explicit provider does not support the requested capability', async () => {
      await expect(
        resolveProvider('embeddings', { explicitProviderId: 'anthropic' })
      ).rejects.toThrow(/does not support "embeddings"/);
    });

    it('does not affect resolveTextGenerationProvider, which passes no override', async () => {
      // Same call site as every existing caller (`/api/ai/generate`) —
      // confirms the additive parameter is fully backward compatible.
      const provider = await resolveTextGenerationProvider();
      expect(provider).toBeDefined();
    });
  });
});
