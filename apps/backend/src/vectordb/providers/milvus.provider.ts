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

/** No official hard cap is documented for Milvus's REST upsert endpoint; 500 is a conservative default. */
const MILVUS_DEFAULT_MAX_UPSERT_BATCH_SIZE = 500;

const COLLECTION_NAME = 'synora_vectors';

/**
 * Milvus, like Weaviate, requires a fixed schema declared upfront
 * (including vector dimension). Same "single collection + scalar filter
 * fields, arbitrary metadata round-tripped as JSON" strategy as
 * `weaviate.provider.ts` — see that file and PROVIDERS.md for the full
 * reasoning.
 */
const FILTERABLE_FIELDS = new Set(['namespace', 'workspaceId', 'conversationId']);

interface MilvusSearchResponse {
  data: Array<{ id: string; distance: number; namespace: string; workspaceId: string; conversationId?: string; metadataJson?: string }>;
}

function translateExpr(field: string, condition: FilterCondition | string | number | boolean): string {
  const quote = (v: unknown) => (typeof v === 'string' ? `"${v}"` : String(v));

  if (condition === null || typeof condition !== 'object') {
    return `${field} == ${quote(condition)}`;
  }
  const [op, value] = Object.entries(condition)[0] as [keyof FilterCondition, unknown];
  switch (op) {
    case 'eq':
      return `${field} == ${quote(value)}`;
    case 'ne':
      return `${field} != ${quote(value)}`;
    case 'gt':
      return `${field} > ${value}`;
    case 'gte':
      return `${field} >= ${value}`;
    case 'lt':
      return `${field} < ${value}`;
    case 'lte':
      return `${field} <= ${value}`;
    case 'in':
      return `${field} in [${(value as (string | number)[]).map(quote).join(', ')}]`;
    case 'nin':
      return `${field} not in [${(value as (string | number)[]).map(quote).join(', ')}]`;
    default: {
      const exhaustiveCheck: never = op;
      throw new Error(`Unknown filter operator: ${String(exhaustiveCheck)}`);
    }
  }
}

function buildMilvusFilterExpr(namespace: string, filter?: MetadataFilter): string {
  const clauses = [`namespace == "${namespace}"`];
  if (filter) {
    for (const [field, condition] of Object.entries(filter)) {
      if (FILTERABLE_FIELDS.has(field)) {
        clauses.push(translateExpr(field, condition));
      }
    }
  }
  return clauses.join(' && ');
}

/**
 * Milvus (self-hosted 2.3+, or Zilliz Cloud) — called via Milvus's native
 * RESTful `/v2/vectordb/*` API (not the gRPC protocol, which would need a
 * dedicated SDK dependency), consistent with every other provider in this
 * module using plain HTTP.
 */
export class MilvusProvider implements VectorDBProvider {
  readonly id = 'milvus';
  readonly supportsHybridSearch = false; // Milvus's sparse-dense hybrid search is not modeled by this adapter yet.
  private collectionEnsured = false;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
    readonly maxUpsertBatchSize: number
  ) {}

  async upsert(request: UpsertRequest): Promise<UpsertResult> {
    try {
      await this.ensureCollection(request.vectors[0].values.length);
      const namespace = buildNamespace(request.workspaceId, request.namespace);

      await requestJson(`${this.baseUrl}/v2/vectordb/entities/upsert`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          collectionName: COLLECTION_NAME,
          data: request.vectors.map((v) => ({
            id: v.id,
            vector: [...v.values],
            namespace,
            workspaceId: request.workspaceId,
            conversationId: (v.metadata?.conversationId as string) ?? '',
            metadataJson: JSON.stringify(v.metadata ?? {}),
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
      const response = await requestJson<MilvusSearchResponse>(`${this.baseUrl}/v2/vectordb/entities/search`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          collectionName: COLLECTION_NAME,
          data: [[...request.vector]],
          limit: request.topK,
          filter: buildMilvusFilterExpr(namespace, request.filter),
          outputFields: ['namespace', 'workspaceId', 'conversationId', 'metadataJson'],
        },
      });

      const matches: VectorMatch[] = response.data.map((item) => ({
        id: item.id,
        score: item.distance,
        metadata: request.includeMetadata === false ? undefined : JSON.parse(item.metadataJson ?? '{}'),
      }));

      return { matches };
    } catch (error) {
      throw this.wrapError('query', error);
    }
  }

  async delete(request: DeleteRequest): Promise<DeleteResult> {
    try {
      const namespace = buildNamespace(request.workspaceId, request.namespace);

      if (request.ids) {
        await requestJson(`${this.baseUrl}/v2/vectordb/entities/delete`, {
          method: 'POST',
          headers: this.headers(),
          body: { collectionName: COLLECTION_NAME, filter: `id in [${request.ids.map((id) => `"${id}"`).join(', ')}]` },
        });
      } else {
        await requestJson(`${this.baseUrl}/v2/vectordb/entities/delete`, {
          method: 'POST',
          headers: this.headers(),
          body: { collectionName: COLLECTION_NAME, filter: buildMilvusFilterExpr(namespace, request.filter) },
        });
      }
      return {};
    } catch (error) {
      throw this.wrapError('delete', error);
    }
  }

  private async ensureCollection(dimensions: number): Promise<void> {
    if (this.collectionEnsured) return;

    const hasResponse = await requestJson<{ data: { has: boolean } }>(
      `${this.baseUrl}/v2/vectordb/collections/has`,
      { method: 'POST', headers: this.headers(), body: { collectionName: COLLECTION_NAME } }
    );

    if (hasResponse.data.has) {
      this.collectionEnsured = true;
      return;
    }

    await requestJson(`${this.baseUrl}/v2/vectordb/collections/create`, {
      method: 'POST',
      headers: this.headers(),
      body: {
        collectionName: COLLECTION_NAME,
        dimension: dimensions,
        metricType: 'COSINE',
      },
    });
    this.collectionEnsured = true;
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private wrapError(operation: string, error: unknown): VectorDBProviderError {
    return new VectorDBProviderError(
      `milvus ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      this.id,
      error
    );
  }
}

export const milvusVectorDBDescriptor: VectorDBProviderDescriptor = {
  id: 'milvus',
  displayName: 'Milvus',
  async isConfigured() {
    return Boolean(getConfig().vectordb.milvusUrl);
  },
  async create() {
    const { milvusUrl, milvusMaxUpsertBatchSize } = getConfig().vectordb;
    if (!milvusUrl) {
      throw new Error('Milvus requires VECTORDB_MILVUS_URL to be set.');
    }
    // tryGetReal: the token is optional (self-hosted, no auth), and sending a
    // generated placeholder as a real token would break exactly that case.
    const token = await secretsManager.tryGetReal('MILVUS_TOKEN', 'vectordb:milvus');
    return new MilvusProvider(milvusUrl, token, milvusMaxUpsertBatchSize ?? MILVUS_DEFAULT_MAX_UPSERT_BATCH_SIZE);
  },
};
