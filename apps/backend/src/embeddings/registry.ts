import type { EmbeddingProviderDescriptor } from './descriptor';

/**
 * The complete list of embedding providers this application knows how to
 * talk to, in auto-detection priority order (first configured wins when
 * `EMBEDDING_PROVIDER` is not set explicitly). Mirrors `../ai/registry.ts`.
 *
 * Adding a new provider means adding one entry here and one new file under
 * `./providers/` — nothing else in the application changes.
 */
import { openaiEmbeddingDescriptor } from './providers/openai.provider';
import { geminiEmbeddingDescriptor } from './providers/gemini.provider';
import { claudeEmbeddingDescriptor } from './providers/claude.provider';
import { voyageEmbeddingDescriptor } from './providers/voyage.provider';
import { cohereEmbeddingDescriptor } from './providers/cohere.provider';
import { ollamaEmbeddingDescriptor } from './providers/ollama.provider';
import { selfHostedEmbeddingDescriptor } from './providers/selfHosted.provider';

export const EMBEDDING_PROVIDER_REGISTRY: readonly EmbeddingProviderDescriptor[] = [
  openaiEmbeddingDescriptor,
  voyageEmbeddingDescriptor,
  geminiEmbeddingDescriptor,
  cohereEmbeddingDescriptor,
  claudeEmbeddingDescriptor,
  ollamaEmbeddingDescriptor,
  selfHostedEmbeddingDescriptor,
];

export function getEmbeddingProviderDescriptor(id: string): EmbeddingProviderDescriptor | undefined {
  return EMBEDDING_PROVIDER_REGISTRY.find((p) => p.id === id);
}
