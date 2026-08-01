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

/** No official hard cap is documented for Weaviate's batch-objects endpoint; 200 is a conservative default. */
const WEAVIATE_DEFAULT_MAX_UPSERT_BATCH_SIZE = 200;

const CLASS_NAME = 'SynoraVector';

/**
 * Weaviate requires a fixed, pre-declared schema (a "class" with typed
 * properties) — unlike Pinecone/Qdrant, which accept arbitrary JSON
 * metadata per vector. This provider declares three queryable properties
 * (`namespace`, `workspaceId`, `conversationId` — exactly the fields the
 * `deleteByWorkspace`/`deleteByConversation` convenience operations in
 * `../service.ts` need to filter on) plus a `metadataJson` property that
 * round-trips the full caller-supplied metadata for retrieval. A
 * `MetadataFilter` condition on any field *other* than those three is
 * still round-tripped for post-query filtering by `VectorDBService`, but
 * is not pushed down into Weaviate's own `where` clause — the same
 * documented constraint as Milvus's provider (see PROVIDERS.md).
 */
const FILTERABLE_FIELDS = new Set(['namespace', 'workspaceId', 'conversationId']);

interface WeaviateGraphQLResponse {
  data?: {
    Get?: {
      [CLASS_NAME]?: Array<{
        _additional: { id: string; distance?: number; vector?: number[] };
        namespace: string;
        workspaceId: string;
        conversationId?: string;
        metadataJson?: string;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

function translateWhereOperand(field: string, condition: FilterCondition | string | number | boolean): string {
  const valueOf = (v: unknown) => (typeof v === 'string' ? `"${v}"` : String(v));

  if (condition === null || typeof condition !== 'object') {
    return `{path: ["${field}"], operator: Equal, valueText: ${valueOf(condition)}}`;
  }
  const [op, value] = Object.entries(condition)[0] as [keyof FilterCondition, unknown];
  switch (op) {
    case 'eq':
      return `{path: ["${field}"], operator: Equal, valueText: ${valueOf(value)}}`;
    case 'ne':
      return `{path: ["${field}"], operator: NotEqual, valueText: ${valueOf(value)}}`;
    case 'gt':
      return `{path: ["${field}"], operator: GreaterThan, valueNumber: ${value}}`;
    case 'gte':
      return `{path: ["${field}"], operator: GreaterThanEqual, valueNumber: ${value}}`;
    case 'lt':
      return `{path: ["${field}"], operator: LessThan, valueNumber: ${value}}`;
    case 'lte':
      return `{path: ["${field}"], operator: LessThanEqual, valueNumber: ${value}}`;
    case 'in':
    case 'nin':
      // Weaviate's `where` has no direct "in list" operator for a single
      // field the way Pinecone/Qdrant do; falls back to an Or/And of
      // Equal/NotEqual clauses over the list.
      return `{operator: ${op === 'in' ? 'Or' : 'And'}, operands: [${(value as (string | number)[])
        .map((v) => `{path: ["${field}"], operator: ${op === 'in' ? 'Equal' : 'NotEqual'}, valueText: ${valueOf(v)}}`)
        .join(', ')}]}`;
    default: {
      const exhaustiveCheck: never = op;
      throw new Error(`Unknown filter operator: ${String(exhaustiveCheck)}`);
    }
  }
}

function buildWhereFilter(namespace: string, filter?: MetadataFilter): string {
  const operands = [`{path: ["namespace"], operator: Equal, valueText: "${namespace}"}`];
  if (filter) {
    for (const [field, condition] of Object.entries(filter)) {
      if (FILTERABLE_FIELDS.has(field)) {
        operands.push(translateWhereOperand(field, condition));
      }
    }
  }
  return operands.length === 1 ? operands[0] : `{operator: And, operands: [${operands.join(', ')}]}`;
}

/**
 * Weaviate — self-hosted or Weaviate Cloud, called via its REST batch API
 * (writes) and GraphQL API (search), no Node SDK used here (same posture
 * as every other provider in this module).
 */
export class WeaviateProvider implements VectorDBProvider {
  readonly id = 'weaviate';
  readonly supportsHybridSearch = false; // Weaviate's native hybrid search (BM25 + vector) is not modeled by this adapter yet.

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly maxUpsertBatchSize: number
  ) {}

  async upsert(request: UpsertRequest): Promise<UpsertResult> {
    try {
      const namespace = buildNamespace(request.workspaceId, request.namespace);
      await requestJson(`${this.baseUrl}/v1/batch/objects`, {
        method: 'POST',
        headers: this.headers(),
        body: {
          objects: request.vectors.map((v) => ({
            class: CLASS_NAME,
            id: v.id,
            vector: [...v.values],
            properties: {
              namespace,
              workspaceId: request.workspaceId,
              conversationId: v.metadata?.conversationId,
              metadataJson: JSON.stringify(v.metadata ?? {}),
            },
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
      const where = buildWhereFilter(namespace, request.filter);
      const query = `{
        Get {
          ${CLASS_NAME}(
            nearVector: { vector: [${request.vector.join(',')}] }
            limit: ${request.topK}
            where: ${where}
          ) {
            namespace
            workspaceId
            conversationId
            metadataJson
            _additional { id distance ${request.includeValues ? 'vector' : ''} }
          }
        }
      }`;

      const response = await requestJson<WeaviateGraphQLResponse>(`${this.baseUrl}/v1/graphql`, {
        method: 'POST',
        headers: this.headers(),
        body: { query },
      });

      if (response.errors?.length) {
        throw new Error(response.errors.map((e) => e.message).join('; '));
      }

      const objects = response.data?.Get?.[CLASS_NAME] ?? [];
      const matches: VectorMatch[] = objects.map((obj) => ({
        id: obj._additional.id,
        // Weaviate returns cosine *distance* (lower is more similar); this
        // adapter converts it to a similarity score (higher is more
        // similar) so callers get a consistent "higher = better" score
        // across every provider in this module.
        score: obj._additional.distance !== undefined ? 1 - obj._additional.distance : 0,
        values: obj._additional.vector,
        metadata: request.includeMetadata === false ? undefined : JSON.parse(obj.metadataJson ?? '{}'),
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
        for (const id of request.ids) {
          await requestJson(`${this.baseUrl}/v1/objects/${CLASS_NAME}/${id}`, {
            method: 'DELETE',
            headers: this.headers(),
          });
        }
      } else {
        await requestJson(`${this.baseUrl}/v1/batch/objects`, {
          method: 'DELETE',
          headers: this.headers(),
          body: { match: { class: CLASS_NAME, where: JSON.parse(this.whereAsJson(namespace, request.filter)) } },
        });
      }
      return {};
    } catch (error) {
      throw this.wrapError('delete', error);
    }
  }

  /** Batch-delete's `where` must be JSON, not a GraphQL literal — reuses the same field-filtering logic via a small JSON builder. */
  private whereAsJson(namespace: string, filter?: MetadataFilter): string {
    const operands: Record<string, unknown>[] = [
      { path: ['namespace'], operator: 'Equal', valueText: namespace },
    ];
    if (filter) {
      for (const [field] of Object.entries(filter)) {
        if (FILTERABLE_FIELDS.has(field)) {
          // Only equality is supported for the JSON delete-filter path, matching the common "delete by workspace/conversation" use case.
          const condition = filter[field];
          const value = condition !== null && typeof condition === 'object' ? (condition as { eq?: unknown }).eq : condition;
          operands.push({ path: [field], operator: 'Equal', valueText: value });
        }
      }
    }
    return JSON.stringify(operands.length === 1 ? operands[0] : { operator: 'And', operands });
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private wrapError(operation: string, error: unknown): VectorDBProviderError {
    return new VectorDBProviderError(
      `weaviate ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      this.id,
      error
    );
  }
}

export const weaviateVectorDBDescriptor: VectorDBProviderDescriptor = {
  id: 'weaviate',
  displayName: 'Weaviate',
  async isConfigured() {
    return Boolean(getConfig().vectordb.weaviateUrl);
  },
  async create() {
    const { weaviateUrl, weaviateMaxUpsertBatchSize } = getConfig().vectordb;
    if (!weaviateUrl) {
      throw new Error('Weaviate requires VECTORDB_WEAVIATE_URL to be set.');
    }
    const apiKey = await secretsManager.tryGet('WEAVIATE_API_KEY', 'vectordb:weaviate');
    return new WeaviateProvider(
      weaviateUrl,
      apiKey,
      weaviateMaxUpsertBatchSize ?? WEAVIATE_DEFAULT_MAX_UPSERT_BATCH_SIZE
    );
  },
};
