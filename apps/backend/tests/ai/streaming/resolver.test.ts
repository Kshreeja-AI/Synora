import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamingProviderResolver, getStreamingResolver } from '../../src/ai/streaming/resolver';
import { ProviderNotFoundError } from '../../src/ai/streaming/types';

describe('StreamingProviderResolver', () => {
  let resolver: StreamingProviderResolver;

  beforeEach(() => {
    resolver = new StreamingProviderResolver();
  });

  it('should register default providers on construction', () => {
    const available = resolver.getAvailableProviders();

    expect(available).toContain('anthropic');
    expect(available).toContain('openai');
    expect(available).toContain('gemini');
    expect(available).toContain('openrouter');
    expect(available).toContain('groq');
    expect(available).toContain('deepseek');
    expect(available).toContain('mock');
  });

  it('should resolve a registered provider', async () => {
    const provider = await resolver.resolve('mock');

    expect(provider).toBeDefined();
    expect(provider.getName()).toBe('mock');
  });

  it('should throw on unregistered provider', async () => {
    await expect(resolver.resolve('unknown')).rejects.toThrow(
      ProviderNotFoundError
    );
  });

  it('should be case-insensitive', async () => {
    const provider = await resolver.resolve('MOCK');

    expect(provider).toBeDefined();
  });

  it('should list configured providers', () => {
    const configured = resolver.getConfiguredProviders();

    expect(Array.isArray(configured)).toBe(true);
    expect(configured.length).toBeGreaterThan(0);
    expect(configured).toContain('mock');
  });

  it('should check provider availability', () => {
    expect(resolver.isAvailable('mock')).toBe(true);
    expect(resolver.isAvailable('unknown')).toBe(false);
  });

  it('should register custom provider', async () => {
    const mockProvider = {
      generateStream: vi.fn(),
      getName: () => 'custom',
      isConfigured: () => true
    };

    resolver.register('custom', mockProvider);
    const provider = await resolver.resolve('custom');

    expect(provider).toBe(mockProvider);
  });
});

describe('getStreamingResolver singleton', () => {
  it('should return same instance on multiple calls', () => {
    const resolver1 = getStreamingResolver();
    const resolver2 = getStreamingResolver();

    expect(resolver1).toBe(resolver2);
  });
});
