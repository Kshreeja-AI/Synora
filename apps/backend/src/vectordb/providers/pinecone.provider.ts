import { secretsManager } from '../../secrets';
import { getConfig } from '../../config';
import {
  DeleteRequest,
  DeleteResult,
  FilterCondition,
  MetadataFilter,
  QueryRequest,
  QueryResult,
  UpsertRequest,
  UpsertResult,
  VectorDBProvider,
  VectorDBProviderError,
  VectorMatch,
} from '../types';
import type { VectorDBProviderDescriptor } from '../descriptor';
import { requestJson, buildNamespace } from '../shared';

/**
 * Pinecone's documented per-request limit is 2MB of payload, commonly
 * cited as ~1000 vectors for typical (1536-dim) embeddings — but that
 * shrinks with higher dimensionality. 100 is a conservative default sized
 * to stay well under the payload cap regardless of dimension, configurable
 * via `VECTORDB_PINECONE_MAX_UPSERT_BATCH_SIZE`.
 */
const PINECONE_DEFAULT_MAX_UPSERT_BATCH_SIZE = 100;

const FILTER_OPERATOR_MAP: Record<keyof FilterCondition, string> = {
  eq: '$eq',
  ne: '$ne',
  in: '$in',
  nin: '$nin',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
};

/** Pinecone's filter DSL already uses `$eq`/`$ne`/`$in`/... keys — this just adds the `$` prefix our generic DSL omits. */
function translateFilter(filter: MetadataFilter): Record<string, unknown> {
  const translated: Record<string, unknown> = {};
  for (const [field, condition] of Object.entries(filter)) {
    if (condition !== null && typeof condition === 'object') {
      const [op, value] = Object.entries(condition)[0] as [keyof FilterCondition, unknown];
      translated[field] = { [FILTER_OPERATOR_MAP[op]]: value };
    } else {
      translated[field] = { $eq: condition };
    }
  }
  return translated;
}

interface PineconeQueryResponse {
  matches: Array<{ id: string; score: number; values?: number[]; metadata?: Record<string, unknown> }>;
}

/**
 * Pinecone's data-plane API is index-specific (each index has its own
 * host, e.g. `my-index-abc123.svc.us-east1-aws.pinecone.io`) — there is no
 * generic endpoint, so this provider requires an explicit
 * `VECTORDB_PINECONE_HOST` rather than trying to auto-discover it via
 * Pinecone's separate control-plane API, the same "no assumed defaults"
 * posture `../ai/providers/ollama.provider.ts` takes for its base URL.
 */
export class PineconeProvider implements VectorDBProvider {
  readonly id = 'pinecone';
  readonly supportsHybridSearch = true;

  constructor(
    private readonly host: string,
    private readonly apiKey: string,
    readonly maxUpsertBatchSize: number
  ) {}

  async upsert(request: UpsertRequest): Promise<UpsertResult> {
    try {
      await requestJson(`https://${this.host}/vectors/upsert`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          namespace: buildNamespace(request.workspaceId, request.namespace),
          vectors: request.vectors.map((v) => ({ id: v.id, values: [...v.values], metadata: v.metadata })),
        },
      });
      return { upsertedCount: request.vectors.length };
    } catch (error) {
      throw this.wrapError('upsert', error);
    }
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    try {
      const response = await requestJson<PineconeQueryResponse>(`https://${this.host}/query`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          namespace: buildNamespace(request.workspaceId, request.namespace),
          vector: [...request.vector],
          sparseVector: request.sparseVector
            ? { indices: [...request.sparseVector.indices], values: [...request.sparseVector.values] }
            : undefined,
          topK: request.topK,
          filter: request.filter ? translateFilter(request.filter) : undefined,
          includeValues: request.includeValues ?? false,
          includeMetadata: request.includeMetadata ?? true,
        },
      });

      const matches: VectorMatch[] = response.matches.map((m) => ({
        id: m.id,
        score: m.score,
        values: m.values,
        metadata: m.metadata,
      }));

      return { matches };
    } catch (error) {
      throw this.wrapError('query', error);
    }
  }

  async delete(request: DeleteRequest): Promise<DeleteResult> {
    try {
      await requestJson(`https://${this.host}/vectors/delete`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          namespace: buildNamespace(request.workspaceId, request.namespace),
          ids: request.ids ? [...request.ids] : undefined,
          filter: request.filter ? translateFilter(request.filter) : undefined,
          deleteAll: request.deleteAll,
        },
      });
      return {};
    } catch (error) {
      throw this.wrapError('delete', error);
    }
  }

  private headers(): Record<string, string> {
    return { 'Api-Key': this.apiKey };
  }

  private wrapError(operation: string, error: unknown): VectorDBProviderError {
    return new VectorDBProviderError(
      `pinecone ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      this.id,
      error
    );
  }
}

export const pineconeVectorDBDescriptor: VectorDBProviderDescriptor = {
  id: 'pinecone',
  displayName: 'Pinecone',
  async isConfigured() {
    const apiKey = await secretsManager.tryGet('PINECONE_API_KEY', 'vectordb:pinecone');
    return apiKey !== undefined && Boolean(getConfig().vectordb.pineconeHost);
  },
  async create() {
    const apiKey = await secretsManager.get('PINECONE_API_KEY', 'vectordb:pinecone');
    const { pineconeHost, pineconeMaxUpsertBatchSize } = getConfig().vectordb;
    if (!pineconeHost) {
      throw new Error('Pinecone requires VECTORDB_PINECONE_HOST to be set.');
    }
    return new PineconeProvider(
      pineconeHost,
      apiKey,
      pineconeMaxUpsertBatchSize ?? PINECONE_DEFAULT_MAX_UPSERT_BATCH_SIZE
    );
  },
};
