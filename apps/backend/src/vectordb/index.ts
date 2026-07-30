import { getVectorDBService } from './factory';
import { DeleteOptions, QueryOptions, UpsertOptions } from './service';
import { DeleteResult, QueryResult, UpsertResult, VectorRecord } from './types';

export type {
  VectorRecord,
  VectorMatch,
  VectorScope,
  FilterCondition,
  MetadataFilter,
  UpsertRequest,
  UpsertResult,
  DeleteRequest,
  DeleteResult,
  SparseVector,
  QueryRequest,
  QueryResult,
  VectorDBProvider,
} from './types';
export {
  VectorDBProviderError,
  NoVectorDBProviderConfiguredError,
  VectorDBValidationError,
  VectorDBDimensionMismatchError,
} from './types';
export type { VectorDBProviderDescriptor } from './descriptor';
export { VECTORDB_PROVIDER_REGISTRY, getVectorDBProviderDescriptor } from './registry';
export { resolveVectorDBProvider } from './resolver';
export { VectorDBService } from './service';
export type { UpsertOptions, QueryOptions, DeleteOptions } from './service';
export {
  createVectorDBService,
  initVectorDBService,
  getVectorDBService,
  resetVectorDBServiceForTests,
} from './factory';
export { getMetricsCollector as getVectorDBMetricsCollector } from './metrics';
export type { VectorDBProviderMetrics, VectorDBOperationMetrics } from './metrics';
export { getHealthChecker as getVectorDBHealthChecker } from './health';
export type { VectorDBHealthCheck, VectorDBHealthStatus } from './health';
export { buildNamespace } from './shared';

/**
 * The functions most callers need. Every production concern — provider
 * selection, namespace/workspace scoping, permission-filter enforcement,
 * bulk-write batching, metrics, tracing — is handled internally by
 * `VectorDBService`. No caller of these functions ever names a provider or
 * imports a provider's SDK/API.
 */
export async function upsertVectors(
  vectors: readonly VectorRecord[],
  options: UpsertOptions
): Promise<UpsertResult> {
  return getVectorDBService().upsert(vectors, options);
}

export async function queryVectors(options: QueryOptions): Promise<QueryResult> {
  return getVectorDBService().query(options);
}

export async function deleteVectors(options: DeleteOptions): Promise<DeleteResult> {
  return getVectorDBService().delete(options);
}

export async function deleteVectorsByWorkspace(workspaceId: string): Promise<DeleteResult> {
  return getVectorDBService().deleteByWorkspace(workspaceId);
}

export async function deleteVectorsByConversation(
  workspaceId: string,
  conversationId: string
): Promise<DeleteResult> {
  return getVectorDBService().deleteByConversation(workspaceId, conversationId);
}
