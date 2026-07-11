import type { ModelProvider, ModelProviderRegistry } from '@synora/core';

export class InMemoryModelProviderRegistry implements ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): ModelProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(
        `Unknown model provider "${providerId}". Registered: [${Array.from(this.providers.keys()).join(', ')}]`,
      );
    }
    return provider;
  }

  list(): ModelProvider[] {
    return Array.from(this.providers.values());
  }
}
