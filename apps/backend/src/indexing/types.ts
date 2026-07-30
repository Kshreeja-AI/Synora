/**
 * Indexing infrastructure contracts.
 *
 * This is the orchestration layer that ties `../queue/` (Phase 1),
 * `../embeddings/` (Phase 2), and `../vectordb/` (Phase 3) together into
 * an actual document-indexing pipeline: split a document into chunks,
 * embed them, store the vectors, and index the text for full-text search
 * — tracking per-document state so re-indexing is incremental, background
 * jobs can recover from a crash mid-index, and failures are visible.
 *
 * Unlike `../ai`, `../queue`, `../embeddings`, and `../vectordb` — which
 * are independent siblings that never import each other — this module's
 * entire purpose is gluing those three together, so it legitimately
 * depends on all of them.
 */

export type DocumentType = 'plain' | 'markdown' | 'code';

/** The unit of work handed to the indexing pipeline. */
export interface IndexableDocument {
  id: string;
  workspaceId: string;
  content: string;
  type?: DocumentType;
  /** Arbitrary caller metadata copied onto every chunk's vector record — e.g. `{ conversationId, title }`. */
  metadata?: Record<string, unknown>;
}

export interface DocumentSection {
  /** Heading path for structured formats, e.g. `["Introduction", "Background"]` for a markdown doc; empty for plain text. */
  path: readonly string[];
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface IndexChunk {
  id: string;
  documentId: string;
  index: number;
  text: string;
  tokenCount: number;
  sectionPath: readonly string[];
  startOffset: number;
  endOffset: number;
}

export type IndexStatus = 'pending' | 'indexing' | 'completed' | 'failed';

/**
 * Per-document indexing state — the source of truth for incremental
 * indexing (skip re-embedding unchanged content), recovery (detect a
 * document stuck mid-index after a crash), and status reporting.
 */
export interface IndexMetadata {
  documentId: string;
  workspaceId: string;
  status: IndexStatus;
  /** SHA-256 of the document's content at last successful index — the incremental-indexing skip check. */
  contentHash: string;
  chunkCount: number;
  tokenCount: number;
  version: number;
  lastIndexedAt: Date | null;
  lastAttemptAt: Date;
  errorMessage?: string;
}

export interface IndexOptions {
  /** Force re-indexing even if `contentHash` matches the last indexed version. */
  force?: boolean;
  embeddingProviderId?: string;
  vectorDBProviderId?: string;
  chunking?: {
    maxTokensPerChunk?: number;
    overlapTokens?: number;
  };
}

export interface IndexResult {
  documentId: string;
  status: IndexStatus;
  /** True if indexing was skipped because content was unchanged since the last successful index (`IndexOptions.force` not set). */
  skipped: boolean;
  chunkCount: number;
  tokenCount: number;
  durationMs: number;
}

export class IndexingError extends Error {
  constructor(
    message: string,
    readonly documentId: string,
    readonly stage: 'split' | 'chunk' | 'embed' | 'vector-upsert' | 'fts-index' | 'metadata',
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'IndexingError';
  }
}

export class IndexingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexingValidationError';
  }
}
