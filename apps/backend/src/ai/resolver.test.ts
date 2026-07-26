import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveTextGenerationProvider } from './resolver';
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
});
