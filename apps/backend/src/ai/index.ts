import { resolveTextGenerationProvider } from './resolver';
import { TextGenerationRequest, TextGenerationResult } from './types';

export type {
  AICapability,
  TextGenerationMode,
  TextGenerationRequest,
  TextGenerationResult,
  TextGenerationUsage,
  TextGenerationProvider,
} from './types';
export { AIProviderError, NoProviderConfiguredError } from './types';
export { PROVIDER_REGISTRY, getProviderDescriptor, providersForCapability } from './registry';
export type { AIProviderDescriptor } from './registry';
export { resolveProvider, resolveTextGenerationProvider } from './resolver';

/**
 * The one function the rest of the application calls to generate text or
 * code. Everything about *which* provider serves the request — Anthropic by
 * default, any other configured provider otherwise, entirely via
 * environment variables — is resolved internally. No caller of this
 * function ever names a provider, imports a provider's SDK, or needs to
 * change when a provider is added, removed, or swapped.
 */
export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
  const provider = await resolveTextGenerationProvider();
  return provider.generateText(request);
}
