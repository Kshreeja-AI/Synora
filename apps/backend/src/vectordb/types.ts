/**
 * Provider-agnostic vector database contracts.
 *
 * Mirrors the pattern in `../ai/`, `../queue/`, and `../embeddings/`: the
 * rest of the application depends only on the types and functions in this
 * module and `./index.ts`, never on a concrete provider or its SDK/API.
 *
 * A vector database is a distinct capability from embeddings generation
 * (`../embeddings/`) — it stores and searches vectors that embeddings
 * *produce*, with its own request/response shape (upsert/query/delete
 * against an index, not text-in-vector-out) and its own production
 * concerns (namespace isolation, metadata filtering, bulk write patterns).
 * It is a sibling module, not a sub-feature of embeddings.
 */

export interface VectorRecord {
  id: string;
  values: readonly number[];
  metadata?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  values?: readonly number[];
  metadata?: Record<string, unknown>;
}

/**
 * Every operation is scoped by both `workspaceId` (mandatory — the tenant
 * isolation boundary) and an optional `namespace` (finer-grained scoping
 * *within* a workspace, e.g. separating a "documents" vector space from a
 * "conversations" vector space). The service computes the effective
 * provider-level namespace as `` workspace:{workspaceId} `` or
 * `` workspace:{workspaceId}:{namespace} `` — see `service.ts`.
 */
export interface VectorScope {
  workspaceId: string;
  namespace?: string;
}

/** Simple, provider-agnostic metadata filter DSL — translated to each provider's native filter syntax by its adapter. */
export type FilterCondition =
  | { eq: string | number | boolean }
  | { ne: string | number | boolean }
  | { in: readonly (string | number)[] }
  | { nin: readonly (string | number)[] }
  | { gt: number }
  | { gte: number }
  | { lt: number }
  | { lte: number };

export type MetadataFilter = Record<string, FilterCondition | string | number | boolean>;

export interface UpsertRequest extends VectorScope {
  vectors: readonly VectorRecord[];
}

export interface UpsertResult {
  upsertedCount: number;
}

export interface DeleteRequest extends VectorScope {
  /** Delete these specific ids. Mutually exclusive with `filter`/`deleteAll`. */
  ids?: readonly string[];
  /** Delete every vector matching this metadata filter. Mutually exclusive with `ids`/`deleteAll`. */
  filter?: MetadataFilter;
  /** Delete every vector in this scope (namespace, or entire workspace if `namespace` is omitted). Mutually exclusive with `ids`/`filter`. */
  deleteAll?: boolean;
}

export interface DeleteResult {
  deletedCount?: number;
}

/**
 * A sparse vector for hybrid (dense + sparse) search — the `indices`/
 * `values` pair format used by Pinecone, Qdrant, and Weaviate alike for
 * sparse (e.g. BM25/SPLADE) vectors. Providers that don't support hybrid
 * search ignore this field entirely and fall back to dense-only search —
 * see `PROVIDERS.md` for which providers actually honor it.
 */
export interface SparseVector {
  indices: readonly number[];
  values: readonly number[];
}

export interface QueryRequest extends VectorScope {
  vector: readonly number[];
  topK: number;
  filter?: MetadataFilter;
  includeValues?: boolean;
  includeMetadata?: boolean;
  /** Hybrid-ready: optional sparse component, honored only by providers that support hybrid search. */
  sparseVector?: SparseVector;
  /** Dense/sparse weighting for hybrid search, 0 (sparse-only) to 1 (dense-only). Ignored by dense-only providers. */
  hybridAlpha?: number;
}

export interface QueryResult {
  matches: readonly VectorMatch[];
}

/** Implemented by any provider that can serve vector storage/search. */
export interface VectorDBProvider {
  readonly id: string;
  /** Maximum number of vectors this provider accepts in a single upsert call. */
  readonly maxUpsertBatchSize: number;
  /** True if this provider honors `sparseVector`/`hybridAlpha` for hybrid search; false if it silently ignores them. */
  readonly supportsHybridSearch: boolean;
  upsert(request: UpsertRequest): Promise<UpsertResult>;
  query(request: QueryRequest): Promise<QueryResult>;
  delete(request: DeleteRequest): Promise<DeleteResult>;
}

/**
 * Thrown when a provider call fails for a reason the caller can act on —
 * never a raw SDK/HTTP error, so callers never need to know which provider
 * failed or how that provider's API shapes its errors.
 */
export class VectorDBProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'VectorDBProviderError';
  }
}

/** Thrown by the resolver when no provider is configured for vector storage. */
export class NoVectorDBProviderConfiguredError extends Error {
  constructor(checkedProviders: readonly string[]) {
    super(
      `No vector database provider is configured. Checked: ${checkedProviders.join(', ')}. ` +
        `Set one of their connection secrets, or set VECTORDB_PROVIDER explicitly. ` +
        `See apps/backend/docs/vectordb/ARCHITECTURE.md.`
    );
    this.name = 'NoVectorDBProviderConfiguredError';
  }
}

export class VectorDBValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorDBValidationError';
  }
}

export class VectorDBDimensionMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`Vector dimension mismatch: expected ${expected}, got ${actual}.`);
    this.name = 'VectorDBDimensionMismatchError';
  }
}
