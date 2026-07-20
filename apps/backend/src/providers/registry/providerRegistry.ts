import { IProvider, ProviderName } from '../interfaces/provider';

/**
 * Holds provider instances for a single capability (image, video, audio, ...).
 * Business logic never instantiates a provider itself — it asks a registry
 * (via the DI container) for one by name.
 */
export class ProviderRegistry<T extends IProvider> {
  private readonly providers = new Map<ProviderName, T>();

  register(provider: T): void {
    this.providers.set(provider.name, provider);
  }

  get(name: ProviderName): T | undefined {
    return this.providers.get(name);
  }

  has(name: ProviderName): boolean {
    return this.providers.has(name);
  }

  all(): T[] {
    return Array.from(this.providers.values());
  }

  names(): ProviderName[] {
    return Array.from(this.providers.keys());
  }
}
