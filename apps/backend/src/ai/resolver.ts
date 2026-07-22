import { getConfig } from '../config';
import { PROVIDER_REGISTRY, getProviderDescriptor, providersForCapability } from './registry';
import { AICapability, NoProviderConfiguredError, TextGenerationProvider } from './types';

/**
 * Selects and constructs the active text-generation provider.
 *
 * Selection rule (this is the entire "provider agnosticism" contract):
 * 1. If `AI_PROVIDER` is set, that provider is used. It must exist, support
 *    the requested capability, and be configured — otherwise this throws a
 *    specific, actionable error rather than silently falling back, because
 *    an explicit operator choice that can't be honored should never be
 *    silently ignored.
 * 2. If `AI_PROVIDER` is not set, the first configured provider in
 *    `PROVIDER_REGISTRY`'s order that supports the capability is used
 *    (Anthropic first, per Release 1's default).
 * 3. If nothing is configured, throws `NoProviderConfiguredError` listing
 *    every provider that was checked.
 *
 * This function contains the *only* place provider selection happens.
 * Nothing else in the application — routes, other services — ever imports
 * a provider directly.
 */
export async function resolveProvider(
  capability: AICapability
): Promise<TextGenerationProvider> {
  const explicitId = getConfig().ai.provider;

  if (explicitId) {
    const descriptor = getProviderDescriptor(explicitId);
    if (!descriptor) {
      throw new Error(
        `AI_PROVIDER is set to "${explicitId}", which is not a known provider. ` +
          `Known providers: ${PROVIDER_REGISTRY.map((p) => p.id).join(', ')}.`
      );
    }
    if (!descriptor.capabilities.includes(capability)) {
      throw new Error(
        `AI_PROVIDER is set to "${explicitId}", which does not support "${capability}".`
      );
    }
    if (!(await descriptor.isConfigured())) {
      throw new Error(
        `AI_PROVIDER is set to "${explicitId}", but it is not configured — ` +
          `its required API key/secret is missing. See docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md.`
      );
    }
    return descriptor.create();
  }

  const candidates = providersForCapability(capability);
  for (const descriptor of candidates) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }

  throw new NoProviderConfiguredError(
    capability,
    candidates.map((p) => p.id)
  );
}

export async function resolveTextGenerationProvider(): Promise<TextGenerationProvider> {
  return resolveProvider('text-generation');
}
