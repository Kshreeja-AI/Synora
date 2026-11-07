import type { AICapability, WebSearchProvider } from './types';
import { NoProviderConfiguredError } from './types';
import type { AIProviderDescriptor } from './types/descriptor';
import { searxngSearchDescriptor, wikipediaSearchDescriptor } from './providers/webSearch.providers';

/**
 * Web-search providers. Self-hosted SearXNG is listed before Wikipedia so a
 * broader index wins when the operator runs one; Wikipedia is the keyless
 * floor that makes search work with zero setup.
 */
export const SEARCH_PROVIDER_REGISTRY: readonly AIProviderDescriptor<WebSearchProvider>[] = [
  searxngSearchDescriptor,
  wikipediaSearchDescriptor,
];

const SEARCH_CAPABILITY: AICapability = 'web-search';

/** The first configured provider; throws `NoProviderConfiguredError` rather than faking one. */
export async function resolveSearchProvider(): Promise<WebSearchProvider> {
  for (const descriptor of SEARCH_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }
  throw new NoProviderConfiguredError(
    SEARCH_CAPABILITY,
    SEARCH_PROVIDER_REGISTRY.map((p) => p.id)
  );
}
