import type { ModelProvider } from '@synora/core';
import { describe, expect, it } from 'vitest';
import { InMemoryModelProviderRegistry } from './registry.js';

function fakeProvider(id: string): ModelProvider {
  return {
    id,
    capabilities: { streaming: false, toolCalling: false, vision: false, embeddings: false },
    generate: async () => {
      throw new Error('not implemented');
    },
    stream: async function* () {},
  };
}

describe('InMemoryModelProviderRegistry', () => {
  it('registers and resolves providers by id', () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register(fakeProvider('anthropic'));
    registry.register(fakeProvider('openai'));

    expect(registry.get('anthropic').id).toBe('anthropic');
    expect(registry.list()).toHaveLength(2);
  });

  it('throws a descriptive error for an unregistered provider', () => {
    const registry = new InMemoryModelProviderRegistry();
    registry.register(fakeProvider('anthropic'));
    expect(() => registry.get('bedrock')).toThrow(/Unknown model provider "bedrock"/);
  });
});
