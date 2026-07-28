import type { AICapability, TextGenerationProvider } from '../types.js';

/**
 * What a provider module publishes about itself. The registry and resolver
 * only ever interact with this shape — never with a provider's underlying
 * SDK, its auth mechanism, or its request/response wire format. That detail
 * is entirely inside each provider's own file under `./providers/`.
 */
export interface AIProviderDescriptor {
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
  create(): Promise<TextGenerationProvider>;
}
