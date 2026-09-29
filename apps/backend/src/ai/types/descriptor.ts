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
/**
 * The result of asking a provider whether its credential actually works.
 *
 * Four states, deliberately never collapsed into a boolean:
 * - `verified`      the provider accepted the credential.
 * - `rejected`      the provider answered and said no. The key is wrong.
 * - `unreachable`   network/timeout. Says NOTHING about the key's validity.
 * - `not-verifiable` this provider has no cheap check; only a real call proves it.
 *
 * Merging `unreachable` into `rejected` would send an operator hunting a
 * credential problem that does not exist; merging it into `verified` would
 * hide a real one.
 */
export interface CredentialVerification {
  status: 'verified' | 'rejected' | 'unreachable' | 'not-verifiable';
  detail: string;
}

export interface AIProviderDescriptor<TProvider = TextGenerationProvider> {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly AICapability[];
  /**
   * Optional: make the cheapest possible AUTHENTICATED call to prove the
   * credential is accepted. Distinct from `isConfigured()`, which only
   * reports that a secret is present and must stay network-free because it
   * runs on every request's resolution path.
   *
   * Optional rather than required so a provider without a cheap check
   * reports `not-verifiable` honestly instead of being forced to fake a
   * passing grade.
   */
  verifyCredential?(): Promise<CredentialVerification>;
  /**
   * Cheap, no-network-call check: are this provider's required secrets/
   * config present? Used both for auto-detection and to give a clear error
   * when a provider is explicitly selected but not configured.
   */
  isConfigured(): Promise<boolean>;
  /**
   * Whether calls to this provider cost money per token.
   *
   * REQUIRED, and deliberately not optional with a default. A new provider
   * must state its own economics, because the alternative — inferring
   * "free" from the absence of a price-table entry — cannot tell a
   * genuinely free local runtime apart from a paid model nobody has priced
   * yet. Those two look identical to a cost calculation and are opposites
   * to a bill. Declared, never guessed, for the same reason an executor
   * declares its own undo target rather than letting a caller infer one.
   *
   *  - `unmetered`: a local or self-hosted runtime the operator already
   *    owns (Ollama and friends). Tokens are genuinely free, so a cost cap
   *    can never bind it and the TOKEN cap is what bounds it.
   *  - `metered`: a hosted service that bills. Its spend must be charged
   *    even when this deployment cannot price the exact model, so an
   *    unknown price is charged a ceiling rather than nothing.
   */
  readonly metering: 'metered' | 'unmetered';
  /**
   * Construct a working provider instance. Only called after isConfigured()
   * has returned true.
   */
  create(): Promise<TProvider>;
}
