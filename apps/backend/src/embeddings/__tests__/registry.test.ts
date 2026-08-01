import { describe, it, expect } from 'vitest';
import { EMBEDDING_PROVIDER_REGISTRY, getEmbeddingProviderDescriptor } from '../registry';

describe('EMBEDDING_PROVIDER_REGISTRY', () => {
  it('includes every provider named in the product requirement', () => {
    const ids = EMBEDDING_PROVIDER_REGISTRY.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['openai', 'gemini', 'claude', 'voyage', 'cohere', 'ollama', 'self-hosted'])
    );
  });

  it('has no duplicate ids', () => {
    const ids = EMBEDDING_PROVIDER_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks claude as structurally unsupported', () => {
    const claude = getEmbeddingProviderDescriptor('claude');
    expect(claude?.unsupportedReason).toBeDefined();
  });

  it('does not mark any other provider as unsupported', () => {
    const supported = EMBEDDING_PROVIDER_REGISTRY.filter((p) => p.id !== 'claude');
    for (const descriptor of supported) {
      expect(descriptor.unsupportedReason).toBeUndefined();
    }
  });
});

describe('getEmbeddingProviderDescriptor', () => {
  it('finds a known provider by id', () => {
    expect(getEmbeddingProviderDescriptor('openai')?.displayName).toBe('OpenAI');
  });

  it('returns undefined for an unknown id', () => {
    expect(getEmbeddingProviderDescriptor('not-a-real-provider')).toBeUndefined();
  });
});
