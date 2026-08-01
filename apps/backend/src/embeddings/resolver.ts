import { getConfig } from '../config';
import { EMBEDDING_PROVIDER_REGISTRY, getEmbeddingProviderDescriptor } from './registry';
import {
  EmbeddingProvider,
  EmbeddingProviderUnsupportedError,
  NoEmbeddingProviderConfiguredError,
} from './types';

/**
 * Selects and constructs the active embedding provider. Mirrors
 * `../ai/resolver.ts`'s selection rule exactly:
 *
 * 1. `options.explicitProviderId`, if passed, wins outright.
 * 2. Otherwise `EMBEDDING_PROVIDER`, if set, wins. It must exist, not be
 *    structurally unsupported, and be configured — otherwise this throws a
 *    specific, actionable error rather than silently falling back.
 * 3. If neither is set, the first configured provider in
 *    `EMBEDDING_PROVIDER_REGISTRY`'s order is used (OpenAI first).
 * 4. If nothing is configured, throws `NoEmbeddingProviderConfiguredError`
 *    listing every provider that was checked.
 *
 * This function contains the *only* place embedding provider selection
 * happens. Nothing else in the application ever imports a provider directly.
 */
export async function resolveEmbeddingProvider(options?: {
  explicitProviderId?: string;
}): Promise<EmbeddingProvider> {
  const explicitId = options?.explicitProviderId ?? getConfig().embeddings.provider;
  const explicitSource = options?.explicitProviderId ? 'the requested provider' : 'EMBEDDING_PROVIDER';

  if (explicitId) {
    const descriptor = getEmbeddingProviderDescriptor(explicitId);
    if (!descriptor) {
      throw new Error(
        `${explicitSource} is set to "${explicitId}", which is not a known embedding provider. ` +
          `Known providers: ${EMBEDDING_PROVIDER_REGISTRY.map((p) => p.id).join(', ')}.`
      );
    }
    if (descriptor.unsupportedReason) {
      throw new EmbeddingProviderUnsupportedError(explicitId, descriptor.unsupportedReason);
    }
    if (!(await descriptor.isConfigured())) {
      throw new Error(
        `${explicitSource} is set to "${explicitId}", but it is not configured — ` +
          `its required API key/secret is missing. See apps/backend/docs/embeddings/ARCHITECTURE.md.`
      );
    }
    return descriptor.create();
  }

  const candidates = EMBEDDING_PROVIDER_REGISTRY.filter((p) => !p.unsupportedReason);
  for (const descriptor of candidates) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }

  throw new NoEmbeddingProviderConfiguredError(candidates.map((p) => p.id));
}
