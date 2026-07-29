import type { AICapability, TextGenerationProvider } from '../types.js';

/**
 * What a provider module publishes about itself. The registry and resolver
 * only ever interact with this shape — never with a provider's underlying
 * SDK, its auth mechanism, or its request/response wire format. That detail
 * is entirely inside each provider's own file under `./providers/`.
 *
 * Generic over the provider interface it constructs, defaulting to
 * `TextGenerationProvider` — every descriptor in `PROVIDER_REGISTRY` today
 * is exactly that, so nothing about today's registry, resolver, or provider
 * files changes. The parameter exists so a future capability that isn't
 * text generation (`embeddings`, `agent`) can declare its own descriptor
 * type — e.g. `AIProviderDescriptor<EmbeddingProvider>` — and its own
 * registry, the same way `storage` and `mail` already have their own
 * descriptor + registry pairs, instead of contorting an embedding provider
 * into fake-implementing `generateText()` just to satisfy this type.
 */
export interface AIProviderDescriptor<TProvider = TextGenerationProvider> {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly AICapability[];
  /**
   * Cheap, no-network-call check: are this provider's required secrets/
   * config present? Used both for auto-detection and to give a clear error
   * when a provider is explicitly selected but not configured.
   */
  isConfigured(): Promise<boolean>;
  /**
   * Construct a working provider instance. Only called after isConfigured()
   * has returned true.
   */
  create(): Promise<TProvider>;
}
