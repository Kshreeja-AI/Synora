import type { EmbeddingProviderDescriptor } from '../descriptor';
import { EmbeddingProviderUnsupportedError } from '../types';

/**
 * Anthropic/Claude has no text-embedding endpoint — Anthropic's own
 * documentation directs customers to Voyage AI (`./voyage.provider.ts`) for
 * embeddings instead of exposing one themselves. This descriptor exists so
 * "claude" appears in the registry (per the product requirement that every
 * provider name in scope is representable), is skipped automatically during
 * auto-detection (`isConfigured()` is always `false`), and gives a precise,
 * actionable error — rather than a generic "not configured" — if a caller
 * ever explicitly requests `EMBEDDING_PROVIDER=claude`.
 *
 * This is a deliberate, documented API limitation, not a placeholder or a
 * TODO: there is nothing to "finish implementing" here short of Anthropic
 * shipping an embeddings endpoint.
 */
export const claudeEmbeddingDescriptor: EmbeddingProviderDescriptor = {
  id: 'claude',
  displayName: 'Anthropic Claude',
  unsupportedReason:
    'Anthropic does not offer a text-embedding API. Use "voyage" (Anthropic\'s recommended embedding partner), or another configured provider.',
  async isConfigured() {
    return false;
  },
  async create() {
    throw new EmbeddingProviderUnsupportedError(
      'claude',
      'Anthropic does not offer a text-embedding API. Use "voyage" instead.'
    );
  },
};
