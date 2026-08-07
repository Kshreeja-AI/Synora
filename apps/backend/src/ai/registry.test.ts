import { describe, it, expect } from 'vitest';
import { PROVIDER_REGISTRY, getProviderDescriptor, providersForCapability } from './registry';
import { AICapability } from './types';

describe('PROVIDER_REGISTRY', () => {
  it('contains at least 10 providers', () => {
    expect(PROVIDER_REGISTRY.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique provider IDs', () => {
    const ids = PROVIDER_REGISTRY.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has valid display names for all providers', () => {
    PROVIDER_REGISTRY.forEach((provider) => {
      expect(provider.displayName).toBeTruthy();
      expect(typeof provider.displayName).toBe('string');
    });
  });

  it('has capabilities for all providers', () => {
    PROVIDER_REGISTRY.forEach((provider) => {
      expect(Array.isArray(provider.capabilities)).toBe(true);
      expect(provider.capabilities.length).toBeGreaterThan(0);
    });
  });

  it('has isConfigured method for all providers', () => {
    PROVIDER_REGISTRY.forEach((provider) => {
      expect(typeof provider.isConfigured).toBe('function');
    });
  });

  it('has create method for all providers', () => {
    PROVIDER_REGISTRY.forEach((provider) => {
      expect(typeof provider.create).toBe('function');
    });
  });

  it('includes Anthropic as first provider', () => {
    expect(PROVIDER_REGISTRY[0].id).toBe('anthropic');
  });

  it('includes all expected provider IDs', () => {
    const providerIds = PROVIDER_REGISTRY.map((p) => p.id);
    const expectedProviders = [
      'anthropic',
      'openai',
      'together',
      'deepseek',
      'openrouter',
      'xai',
      'azure-openai',
      'gemini',
      'bedrock',
      'ollama',
      'groq',
      'self-hosted',
    ];
    expectedProviders.forEach((id) => {
      expect(providerIds).toContain(id);
    });
  });
});

describe('getProviderDescriptor', () => {
  it('returns provider descriptor for valid ID', () => {
    const descriptor = getProviderDescriptor('anthropic');
    expect(descriptor).toBeDefined();
    expect(descriptor!.id).toBe('anthropic');
  });

  it('returns undefined for invalid ID', () => {
    const descriptor = getProviderDescriptor('invalid-provider');
    expect(descriptor).toBeUndefined();
  });

  it('returns correct descriptor for each provider ID', () => {
    PROVIDER_REGISTRY.forEach((provider) => {
      const descriptor = getProviderDescriptor(provider.id);
      expect(descriptor).toBeDefined();
      expect(descriptor?.id).toBe(provider.id);
    });
  });
});

describe('providersForCapability', () => {
  it('returns providers for text-generation capability', () => {
    const providers = providersForCapability('text-generation');
    expect(providers.length).toBeGreaterThan(0);
    providers.forEach((p) => {
      expect(p.capabilities).toContain('text-generation');
    });
  });

  it('returns providers for code-generation capability', () => {
    const providers = providersForCapability('code-generation');
    expect(providers.length).toBeGreaterThan(0);
    providers.forEach((p) => {
      expect(p.capabilities).toContain('code-generation');
    });
  });

  it('returns providers in registry order', () => {
    const providers = providersForCapability('text-generation');
    const allIds = PROVIDER_REGISTRY.map((p) => p.id);
    const filteredIds = providers.map((p) => p.id);
    filteredIds.forEach((id, index) => {
      const registryIndex = allIds.indexOf(id);
      const nextId = filteredIds[index + 1];
      if (nextId) {
        const nextRegistryIndex = allIds.indexOf(nextId);
        expect(registryIndex).toBeLessThan(nextRegistryIndex);
      }
    });
  });

  it('returns providers filtering to requested capability', () => {
    const providers = providersForCapability('text-generation');
    expect(providers.length).toBeGreaterThan(0);

    providers.forEach((p) => {
      expect(p.capabilities).toContain('text-generation');
    });
  });

  it('handles non-existent capability gracefully', () => {
    const providers = providersForCapability('non-existent-capability' as AICapability);
    expect(Array.isArray(providers)).toBe(true);
  });

  it('all returned providers support the requested capability', () => {
    const capabilities: AICapability[] = [
      'text-generation',
      'code-generation',
      'image-generation',
      'embeddings',
    ];

    capabilities.forEach((capability) => {
      const providers = providersForCapability(capability);
      providers.forEach((p) => {
        expect(p.capabilities).toContain(capability);
      });
    });
  });

  it('filters capabilities correctly', () => {
    const textProviders = providersForCapability('text-generation');
    const codeProviders = providersForCapability('code-generation');

    expect(textProviders.length).toBeGreaterThan(0);
    expect(codeProviders.length).toBeGreaterThan(0);

    textProviders.forEach((p) => {
      expect(p.capabilities).toContain('text-generation');
    });

    codeProviders.forEach((p) => {
      expect(p.capabilities).toContain('code-generation');
    });
  });
});
