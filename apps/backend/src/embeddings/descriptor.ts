import type { EmbeddingProvider } from './types';

/**
 * What a provider module publishes about itself. The registry and resolver
 * only ever interact with this shape — never with a provider's underlying
 * SDK, its auth mechanism, or its request/response wire format. Mirrors
 * `../ai/types/descriptor.ts`'s `AIProviderDescriptor`.
 */
export interface EmbeddingProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  /**
   * Set only by providers that structurally cannot support embeddings at
   * all (Anthropic/Claude — see `./providers/claude.provider.ts`), as
   * distinct from merely being unconfigured. When set, the resolver skips
   * this provider during auto-detection (same as `isConfigured()` false)
   * but throws `EmbeddingProviderUnsupportedError` with this reason —
   * rather than the generic "not configured" error — if a caller explicitly
   * requests this provider by id.
   */
  readonly unsupportedReason?: string;
  /**
   * Cheap, no-network-call check: are this provider's required secrets/
   * config present? Used both for auto-detection and to give a clear error
   * when a provider is explicitly selected but not configured. Providers
   * with `unsupportedReason` set always return false here.
   */
  isConfigured(): Promise<boolean>;
  /**
   * Construct a working provider instance. Only called after isConfigured()
   * has returned true.
   */
  create(): Promise<EmbeddingProvider>;
}
