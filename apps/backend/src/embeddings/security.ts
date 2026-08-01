import { EmbeddingValidationError } from './types';

export interface EmbeddingSecurityLimits {
  /** Maximum characters accepted in a single text input. */
  maxInputChars: number;
  /** Maximum number of texts accepted in a single `embedBatch` call, before internal batching to the provider's own limit. */
  maxBatchRequestSize: number;
}

/**
 * Input validation for the embeddings subsystem. Deliberately validates at
 * the `EmbeddingService` boundary (see `./service.ts`) rather than inside
 * individual providers: a provider should never receive input this
 * application hasn't already judged safe to send to a third-party API.
 */
export function validateWorkspaceId(workspaceId: string): void {
  if (!workspaceId || workspaceId.trim().length === 0) {
    throw new EmbeddingValidationError('workspaceId is required and cannot be empty.');
  }
}

export function validateText(text: string, limits: EmbeddingSecurityLimits): void {
  if (typeof text !== 'string' || text.length === 0) {
    throw new EmbeddingValidationError('Embedding text must be a non-empty string.');
  }
  if (text.length > limits.maxInputChars) {
    throw new EmbeddingValidationError(
      `Embedding text exceeds the maximum allowed length (${text.length} > ${limits.maxInputChars} characters).`
    );
  }
}

export function validateBatch(texts: readonly string[], limits: EmbeddingSecurityLimits): void {
  if (texts.length === 0) {
    throw new EmbeddingValidationError('Embedding batch must contain at least one text.');
  }
  if (texts.length > limits.maxBatchRequestSize) {
    throw new EmbeddingValidationError(
      `Embedding batch exceeds the maximum allowed size (${texts.length} > ${limits.maxBatchRequestSize} texts).`
    );
  }
  for (const text of texts) {
    validateText(text, limits);
  }
}

/**
 * Produces a log-safe preview of embedding input: length plus a short,
 * truncated prefix — never the full text. Embedding input frequently
 * contains user documents, messages, or other sensitive content, so it must
 * never be written to logs/traces/metrics in full, unlike an API key (which
 * `SecretsManager`'s audit log already handles by never logging values,
 * only which key was read).
 */
export function redactTextForLogging(text: string): string {
  const preview = text.slice(0, 40).replace(/\s+/g, ' ').trim();
  return `"${preview}${text.length > 40 ? '…' : ''}" (${text.length} chars)`;
}
