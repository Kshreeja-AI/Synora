import { describe, it, expect } from 'vitest';
import { resolveTextGenerationProvider } from './resolver';
import { PROVIDER_REGISTRY } from './registry';

describe('resolveTextGenerationProvider', () => {
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
