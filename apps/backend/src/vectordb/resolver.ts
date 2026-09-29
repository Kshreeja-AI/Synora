import { getConfig } from '../config';
import { VECTORDB_PROVIDER_REGISTRY, getVectorDBProviderDescriptor } from './registry';
import { NoVectorDBProviderConfiguredError, VectorDBProvider } from './types';

/**
 * Selects and constructs the active vector DB provider. Mirrors
 * `../embeddings/resolver.ts`'s selection rule exactly:
 *
 * 1. `options.explicitProviderId`, if passed, wins outright.
 * 2. Otherwise `VECTORDB_PROVIDER`, if set, wins. It must exist and be
 *    configured — otherwise this throws a specific, actionable error
 *    rather than silently falling back.
 * 3. If neither is set, the first configured provider in
 *    `VECTORDB_PROVIDER_REGISTRY`'s order is used (Pinecone first).
 * 4. If nothing is configured, throws `NoVectorDBProviderConfiguredError`
 *    listing every provider checked.
 *
 * This function contains the *only* place vector DB provider selection
 * happens. Nothing else in the application ever imports a provider directly.
 */
export async function resolveVectorDBProvider(options?: {
  explicitProviderId?: string;
}): Promise<VectorDBProvider> {
  const explicitId = options?.explicitProviderId ?? getConfig().vectordb.provider;
  const explicitSource = options?.explicitProviderId ? 'the requested provider' : 'VECTORDB_PROVIDER';

  if (explicitId) {
    const descriptor = getVectorDBProviderDescriptor(explicitId);
    if (!descriptor) {
      throw new Error(
        `${explicitSource} is set to a value that is not a known vector DB provider. ` +
          // Value withheld: a mistyped selection variable has been observed
          // to contain an API key, and this error is logged.

          `Known providers: ${VECTORDB_PROVIDER_REGISTRY.map((p) => p.id).join(', ')}.`
      );
    }
    if (!(await descriptor.isConfigured())) {
      throw new Error(
        `${explicitSource} is set to "${explicitId}", but it is not configured — ` +
          `its required connection secret/config is missing. See apps/backend/docs/vectordb/ARCHITECTURE.md.`
      );
    }
    return descriptor.create();
  }

  for (const descriptor of VECTORDB_PROVIDER_REGISTRY) {
    if (await descriptor.isConfigured()) {
      return descriptor.create();
    }
  }

  throw new NoVectorDBProviderConfiguredError(VECTORDB_PROVIDER_REGISTRY.map((p) => p.id));
}
