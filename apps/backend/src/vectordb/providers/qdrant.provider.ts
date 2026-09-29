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

/** No official hard cap is documented for Qdrant's point-upsert endpoint; 500 is a conservative default for a single request. */
const QDRANT_DEFAULT_MAX_UPSERT_BATCH_SIZE = 500;

/**
 * Qdrant has no native "namespace" concept — only collections. Rather than
 * creating one collection per workspace/namespace (heavier to manage, and
 * requiring the collection's vector dimension to be known upfront per
 * namespace), this provider uses a single collection and stores the
 * computed namespace string as a payload field, filtered on every
 * operation — the same "single collection + filter" strategy `weaviate`
 * and `milvus` providers use, and the only one that's dimension-agnostic
 * at the collection level.
 */
const NAMESPACE_FIELD = '_namespace';
const COLLECTION_NAME = 'synora_vectors';

interface QdrantSearchResponse {
  result: Array<{ id: string; score: number; vector?: number[]; payload?: Record<string, unknown> }>;
}

function translateFilterCondition(field: string, condition: FilterCondition | string | number | boolean): unknown {
  if (condition === null || typeof condition !== 'object') {
    return { key: field, match: { value: condition } };
  }
  const [op, value] = Object.entries(condition)[0] as [keyof FilterCondition, unknown];
  switch (op) {
    case 'eq':
      return { key: field, match: { value } };
    case 'ne':
      return { key: field, match: { except: [value] } };
    case 'in':
      return { key: field, match: { any: value } };
    case 'nin':
      return { key: field, match: { except: value } };
    case 'gt':
      return { key: field, range: { gt: value } };
    case 'gte':
      return { key: field, range: { gte: value } };
    case 'lt':
      return { key: field, range: { lt: value } };
    case 'lte':
      return { key: field, range: { lte: value } };
  }
}

function buildQdrantFilter(namespace: string, filter?: MetadataFilter): Record<string, unknown> {
  const must: unknown[] = [{ key: NAMESPACE_FIELD, match: { value: namespace } }];
  if (filter) {
    for (const [field, condition] of Object.entries(filter)) {
      must.push(translateFilterCondition(field, condition));
    }
  }
  return { must };
}

/**
 * Qdrant — self-hosted or Qdrant Cloud, plain REST API, no Node SDK used
 * here (same posture as every other provider in this module — see
 * PROVIDERS.md). The collection is created lazily on first upsert, once
 * the vector dimensionality is known.
 */
export class QdrantProvider implements VectorDBProvider {
  readonly id = 'qdrant';
  readonly supportsHybridSearch = false; // Qdrant supports sparse vectors via named vectors, not modeled by this adapter yet.
  private collectionEnsured = false;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly maxUpsertBatchSize: number
  ) {}

  async upsert(request: UpsertRequest): Promise<UpsertResult> {
    try {
      await this.ensureCollection(request.vectors[0].values.length);
      const namespace = buildNamespace(request.workspaceId, request.namespace);

      await requestJson(`${this.baseUrl}/collections/${COLLECTION_NAME}/points`, {
        method: 'PUT',
        headers: this.headers(),
        body: {
          points: request.vectors.map((v) => ({
            id: v.id,
            vector: [...v.values],
            payload: { ...v.metadata, [NAMESPACE_FIELD]: namespace },
          })),
        },
      });
      return { upsertedCount: request.vectors.length };
    } catch (error) {
      throw this.wrapError('upsert', error);
    }
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    try {
      const namespace = buildNamespace(request.workspaceId, request.namespace);
      const response = await requestJson<QdrantSearchResponse>(
        `${this.baseUrl}/collections/${COLLECTION_NAME}/points/search`,
        {
          method: 'POST',
          headers: this.headers(),
          body: {
            vector: [...request.vector],
            limit: request.topK,
            filter: buildQdrantFilter(namespace, request.filter),
            with_payload: request.includeMetadata ?? true,
            with_vector: request.includeValues ?? false,
          },
        }
      );

      const matches: VectorMatch[] = response.result.map((r) => {
        const payload = { ...r.payload };
        delete payload[NAMESPACE_FIELD];
        return { id: r.id, score: r.score, values: r.vector, metadata: payload };
      });

      return { matches };
    } catch (error) {
      throw this.wrapError('query', error);
    }
  }

  async delete(request: DeleteRequest): Promise<DeleteResult> {
    try {
      const namespace = buildNamespace(request.workspaceId, request.namespace);

      if (request.ids) {
        await requestJson(`${this.baseUrl}/collections/${COLLECTION_NAME}/points/delete`, {
          method: 'POST',
          headers: this.headers(),
          body: { points: [...request.ids] },
        });
      } else {
        // Both `filter` and `deleteAll` reduce to "delete everything matching
        // the namespace filter (plus any extra caller filter)" — deleteAll
        // has no extra filter conditions beyond the namespace scope itself.
        await requestJson(`${this.baseUrl}/collections/${COLLECTION_NAME}/points/delete`, {
          method: 'POST',
          headers: this.headers(),
          body: { filter: buildQdrantFilter(namespace, request.filter) },
        });
      }
      return {};
    } catch (error) {
      throw this.wrapError('delete', error);
    }
  }

  private async ensureCollection(dimensions: number): Promise<void> {
    if (this.collectionEnsured) return;

    const exists = await fetch(`${this.baseUrl}/collections/${COLLECTION_NAME}`, { headers: this.headers() });
    if (exists.ok) {
      this.collectionEnsured = true;
      return;
    }

    await requestJson(`${this.baseUrl}/collections/${COLLECTION_NAME}`, {
      method: 'PUT',
      headers: this.headers(),
      body: { vectors: { size: dimensions, distance: 'Cosine' } },
    });
    this.collectionEnsured = true;
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { 'api-key': this.apiKey } : {};
  }

  private wrapError(operation: string, error: unknown): VectorDBProviderError {
    return new VectorDBProviderError(
      `qdrant ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      this.id,
      error
    );
  }
}

export const qdrantVectorDBDescriptor: VectorDBProviderDescriptor = {
  id: 'qdrant',
  displayName: 'Qdrant',
  async isConfigured() {
    return Boolean(getConfig().vectordb.qdrantUrl);
  },
  async create() {
    const { qdrantUrl, qdrantMaxUpsertBatchSize } = getConfig().vectordb;
    if (!qdrantUrl) {
      throw new Error('Qdrant requires VECTORDB_QDRANT_URL to be set.');
    }
    // tryGetReal: the key is optional (self-hosted, no auth), and sending a
    // generated placeholder as a real API key would break exactly that case.
    const apiKey = await secretsManager.tryGetReal('QDRANT_API_KEY', 'vectordb:qdrant');
    return new QdrantProvider(qdrantUrl, apiKey, qdrantMaxUpsertBatchSize ?? QDRANT_DEFAULT_MAX_UPSERT_BATCH_SIZE);
  },
};
