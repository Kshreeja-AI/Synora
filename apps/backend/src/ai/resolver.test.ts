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
        // The message names the SOURCE and lists the valid values, and
        // deliberately does NOT quote what was actually set. An OpenRouter API
        // key was found in `AI_PROVIDER` on 2026-08-12, and this error is
        // thrown on the request path where it is logged — echoing the value
        // would have written a live credential into the application log.
      ).rejects.toThrow(/the requested provider is set to a value that is not a known provider/i);

      await expect(
        resolveProvider('text-generation', { explicitProviderId: 'not-a-real-provider' })
      ).rejects.toThrow(/known providers:/i);

      // STRONGER than the assertion this replaced: the offending value must
      // be absent from the message entirely.
      //
      // The probe is deliberately NOT credential-shaped. An `sk-…` literal in
      // a tracked file trips secret scanners and reads as real to anybody
      // skimming — and the resolver redacts every unknown value regardless of
      // shape, so a realistic-looking token would test nothing extra.
      const probe = 'value-that-must-never-be-echoed';
      await expect(
        resolveProvider('text-generation', { explicitProviderId: probe })
      ).rejects.not.toThrow(new RegExp(probe));
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
