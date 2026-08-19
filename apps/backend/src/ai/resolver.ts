import { getConfig } from '../config';
import { PROVIDER_REGISTRY, getProviderDescriptor, providersForCapability } from './registry';
import { AICapability, NoProviderConfiguredError, TextGenerationProvider } from './types';

/**
 * Selects and constructs the active text-generation provider.
 *
 * Selection rule (this is the entire "provider agnosticism" contract):
 * 1. If `options.explicitProviderId` is passed, that provider is used —
 *    this is how a caller with its own notion of "which provider" (e.g.
 *    Release 3's `Conversation.provider`) overrides the process-wide
 *    default, without affecting any other caller.
 * 2. Otherwise, if `AI_PROVIDER` is set, that provider is used. It must
 *    exist, support the requested capability, and be configured —
 *    otherwise this throws a specific, actionable error rather than
 *    silently falling back, because an explicit choice that can't be
 *    honored should never be silently ignored. This rule is identical for
 *    both `options.explicitProviderId` and `AI_PROVIDER` — the only
 *    difference is which one takes priority when both could apply.
 * 3. If neither is set, the first configured provider in
 *    `PROVIDER_REGISTRY`'s order that supports the capability is used
 *    (Anthropic first, per Release 1's default).
 * 4. If nothing is configured, throws `NoProviderConfiguredError` listing
 *    every provider that was checked.
 *
 * This function contains the *only* place provider selection happens.
 * Nothing else in the application — routes, other services — ever imports
 * a provider directly.
 */
export async function resolveProvider(
  capability: AICapability,
  options?: { explicitProviderId?: string }
): Promise<TextGenerationProvider> {
  const explicitId = options?.explicitProviderId ?? getConfig().ai.provider;
  const explicitSource = options?.explicitProviderId ? 'the requested provider' : 'AI_PROVIDER';

  if (explicitId) {
    const descriptor = getProviderDescriptor(explicitId);
    if (!descriptor) {
      // THE VALUE IS NOT ECHOED. This message used to interpolate
      // `explicitId` directly, which is safe exactly as long as everybody
      // puts a provider id in the selection variable. On 2026-08-12 an
      // OpenRouter API key was found in `AI_PROVIDER` on this deployment —
      // and this error is thrown on the request path, where it is logged, and
      // may be surfaced to a caller. That would have written a live
      // credential into the application log.
      //
      // A misconfiguration message does not need to quote the
      // misconfiguration to be actionable: naming the VARIABLE and listing
      // the valid values tells an operator everything, and they can read
      // their own env file.
      throw new Error(
        `${explicitSource} is set to a value that is not a known provider. ` +
          `Known providers: ${PROVIDER_REGISTRY.map((p) => p.id).join(', ')}. ` +
          'The offending value is not shown here because a mistyped selection ' +
          'variable has been observed to contain an API key.'
      );
    }
    if (!descriptor.capabilities.includes(capability)) {
      throw new Error(
        `${explicitSource} is set to "${explicitId}", which does not support "${capability}".`
      );
    }
    if (!(await descriptor.isConfigured())) {
      throw new Error(
        `${explicitSource} is set to "${explicitId}", but it is not configured — ` +
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
