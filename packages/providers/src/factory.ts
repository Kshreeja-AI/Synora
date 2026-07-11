import type { ModelProviderRegistry } from '@synora/core';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import { InMemoryModelProviderRegistry } from './registry.js';

export interface ProviderCredentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

/**
 * Builds a registry pre-populated with every provider for which
 * credentials were supplied. Products resolve a ModelProvider by id
 * (e.g. "anthropic") through this registry — never by importing a
 * vendor SDK directly — which is what makes swapping or adding a
 * provider a one-file change.
 */
export function createDefaultProviderRegistry(
  credentials: ProviderCredentials,
): ModelProviderRegistry {
  const registry = new InMemoryModelProviderRegistry();
  if (credentials.anthropicApiKey) {
    registry.register(new AnthropicProvider({ apiKey: credentials.anthropicApiKey }));
  }
  if (credentials.openaiApiKey) {
    registry.register(new OpenAiProvider({ apiKey: credentials.openaiApiKey }));
  }
  return registry;
}
