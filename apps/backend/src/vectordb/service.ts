import { VectorDBMetricsCollector } from './metrics';
import { HealthChecker, VectorDBHealthCheck } from './health';
import { withSpan } from './tracing';
import {
  validateDeleteRequest,
  validateQueryVector,
  validateUpsertBatch,
  validateWorkspaceId,
  VectorDBSecurityLimits,
} from './security';
import { resolveVectorDBProvider } from './resolver';
import {
  DeleteResult,
  MetadataFilter,
  QueryResult,
  UpsertResult,
  VectorDBProvider,
  VectorMatch,
  VectorRecord,
  VectorScope,
} from './types';

export interface UpsertOptions extends VectorScope {
  providerId?: string;
}

export interface QueryOptions extends VectorScope {
  vector: readonly number[];
  topK: number;
  filter?: MetadataFilter;
  includeValues?: boolean;
  includeMetadata?: boolean;
  sparseVector?: { indices: readonly number[]; values: readonly number[] };
  hybridAlpha?: number;
  providerId?: string;
  /**
   * Defense-in-depth permission enforcement, re-checked on every returned
   * match regardless of whether the underlying provider's filter
   * push-down honored an equivalent condition in `filter` — Weaviate and
   * Milvus's adapters only push a fixed set of fields down into their
   * native filter, so a caller relying solely on `filter` for a field
   * outside that set would get an unfiltered result from those two
   * providers. This callback is provider-independent and always applied,
   * so results are never mistakenly leaked past whatever the client
   * considers permitted.
   */
  permissionFilter?: (match: VectorMatch) => boolean;
}

export interface DeleteOptions extends VectorScope {
  ids?: readonly string[];
  filter?: MetadataFilter;
  deleteAll?: boolean;
  providerId?: string;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * The single orchestrator every caller (routes, other services) talks to.
 * Everything about *how* a vector operation is served — which provider,
 * namespace/workspace scoping, permission enforcement, bulk-write
 * batching, metrics, tracing, and health — is handled here. Nothing
 * outside this module ever calls a provider's `upsert()`/`query()`/
 * `delete()` directly. Mirrors `../embeddings/service.ts`'s role for the
 * embeddings subsystem and `../queue/manager.ts`'s role for the queue
 * subsystem.
 */
export class VectorDBService {
  constructor(
    private readonly metrics: VectorDBMetricsCollector,
    private readonly health: HealthChecker,
    private readonly securityLimits: VectorDBSecurityLimits
  ) {}

  /** Bulk (or single, as a batch of one) upsert — auto-chunked into `provider.maxUpsertBatchSize`-sized groups internally. */
  async upsert(vectors: readonly VectorRecord[], options: UpsertOptions): Promise<UpsertResult> {
    validateWorkspaceId(options.workspaceId);
    validateUpsertBatch(vectors, this.securityLimits);

    const provider = await resolveVectorDBProvider({ explicitProviderId: options.providerId });

    return withSpan(
      'vectordb.upsert',
      { providerId: provider.id, workspaceId: options.workspaceId, namespace: options.namespace, count: vectors.length },
      async () => {
        const groups = chunk(vectors, provider.maxUpsertBatchSize);
        let upsertedCount = 0;

        for (const group of groups) {
          upsertedCount += await this.callProvider(provider, 'upsert', group.length, () =>
            provider.upsert({ workspaceId: options.workspaceId, namespace: options.namespace, vectors: group })
          ).then((result) => result.upsertedCount);
        }

        return { upsertedCount };
      }
    );
  }

  /** Single-vector convenience wrapper over `upsert()` — incremental indexing after an initial bulk load. */
  async upsertOne(vector: VectorRecord, options: UpsertOptions): Promise<UpsertResult> {
    return this.upsert([vector], options);
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    validateWorkspaceId(options.workspaceId);
    validateQueryVector(options.vector, options.topK, this.securityLimits);

    const provider = await resolveVectorDBProvider({ explicitProviderId: options.providerId });

    return withSpan(
      'vectordb.query',
      { providerId: provider.id, workspaceId: options.workspaceId, namespace: options.namespace, topK: options.topK },
      async () => {
        const result = await this.callProvider(provider, 'query', 0, () =>
          provider.query({
            workspaceId: options.workspaceId,
            namespace: options.namespace,
            vector: options.vector,
            topK: options.topK,
            filter: options.filter,
            includeValues: options.includeValues,
            includeMetadata: options.includeMetadata,
            sparseVector: provider.supportsHybridSearch ? options.sparseVector : undefined,
            hybridAlpha: provider.supportsHybridSearch ? options.hybridAlpha : undefined,
          })
        );

        const matches = options.permissionFilter
          ? result.matches.filter(options.permissionFilter)
          : result.matches;

        return { matches };
      }
    );
  }

  async delete(options: DeleteOptions): Promise<DeleteResult> {
    validateWorkspaceId(options.workspaceId);
    validateDeleteRequest(options);

    const provider = await resolveVectorDBProvider({ explicitProviderId: options.providerId });

    return withSpan(
      'vectordb.delete',
      { providerId: provider.id, workspaceId: options.workspaceId, namespace: options.namespace },
      () =>
        this.callProvider(provider, 'delete', options.ids?.length ?? 0, () =>
          provider.delete({
            workspaceId: options.workspaceId,
            namespace: options.namespace,
            ids: options.ids,
            filter: options.filter,
            deleteAll: options.deleteAll,
          })
        )
    );
  }

  /** Deletes every vector in every namespace under this workspace. */
  async deleteByWorkspace(workspaceId: string, providerId?: string): Promise<DeleteResult> {
    return this.delete({ workspaceId, deleteAll: true, providerId });
  }

  /** Deletes every vector tagged with this conversationId, within the given workspace (and optional namespace). */
  async deleteByConversation(
    workspaceId: string,
    conversationId: string,
    options?: { namespace?: string; providerId?: string }
  ): Promise<DeleteResult> {
    return this.delete({
      workspaceId,
      namespace: options?.namespace,
      filter: { conversationId: { eq: conversationId } },
      providerId: options?.providerId,
    });
  }

  getHealth(providerId: string): VectorDBHealthCheck {
    return this.health.check(providerId);
  }

  private async callProvider<T extends { upsertedCount?: number } | QueryResult | DeleteResult>(
    provider: VectorDBProvider,
    operation: 'upsert' | 'query' | 'delete',
    vectorCount: number,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.metrics.recordCall({
        providerId: provider.id,
        operation,
        latencyMs: Date.now() - start,
        vectorCount,
        success: true,
      });
      return result;
    } catch (error) {
      this.metrics.recordCall({
        providerId: provider.id,
        operation,
        latencyMs: Date.now() - start,
        vectorCount,
        success: false,
      });
      throw error;
    }
  }
}
