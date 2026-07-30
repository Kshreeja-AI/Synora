import { VectorDBDimensionMismatchError, VectorDBValidationError, VectorRecord } from './types';

export interface VectorDBSecurityLimits {
  /** Maximum vectors accepted in a single upsert() call, before internal batching to the provider's own limit. */
  maxUpsertRequestSize: number;
  /** Maximum `topK` accepted on a query(). */
  maxTopK: number;
  /** Maximum vector dimensionality accepted — guards against a caller accidentally sending a wildly oversized vector. */
  maxDimensions: number;
}

/**
 * Input validation for the vector DB subsystem, enforced at the
 * `VectorDBService` boundary (`./service.ts`) — a provider never receives
 * input this application hasn't already judged safe to send.
 */
export function validateWorkspaceId(workspaceId: string): void {
  if (!workspaceId || workspaceId.trim().length === 0) {
    throw new VectorDBValidationError('workspaceId is required and cannot be empty.');
  }
}

export function validateVectorRecord(record: VectorRecord, limits: VectorDBSecurityLimits): void {
  if (!record.id || record.id.trim().length === 0) {
    throw new VectorDBValidationError('Vector record id is required and cannot be empty.');
  }
  if (!Array.isArray(record.values) || record.values.length === 0) {
    throw new VectorDBValidationError(`Vector record "${record.id}" must have a non-empty values array.`);
  }
  if (record.values.length > limits.maxDimensions) {
    throw new VectorDBValidationError(
      `Vector record "${record.id}" exceeds the maximum allowed dimensionality (${record.values.length} > ${limits.maxDimensions}).`
    );
  }
}

export function validateUpsertBatch(vectors: readonly VectorRecord[], limits: VectorDBSecurityLimits): void {
  if (vectors.length === 0) {
    throw new VectorDBValidationError('Upsert batch must contain at least one vector.');
  }
  if (vectors.length > limits.maxUpsertRequestSize) {
    throw new VectorDBValidationError(
      `Upsert batch exceeds the maximum allowed size (${vectors.length} > ${limits.maxUpsertRequestSize} vectors).`
    );
  }

  const expectedDimensions = vectors[0].values.length;
  for (const record of vectors) {
    validateVectorRecord(record, limits);
    if (record.values.length !== expectedDimensions) {
      throw new VectorDBDimensionMismatchError(expectedDimensions, record.values.length);
    }
  }
}

export function validateQueryVector(vector: readonly number[], topK: number, limits: VectorDBSecurityLimits): void {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new VectorDBValidationError('Query vector must be a non-empty array.');
  }
  if (vector.length > limits.maxDimensions) {
    throw new VectorDBValidationError(
      `Query vector exceeds the maximum allowed dimensionality (${vector.length} > ${limits.maxDimensions}).`
    );
  }
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new VectorDBValidationError('topK must be a positive integer.');
  }
  if (topK > limits.maxTopK) {
    throw new VectorDBValidationError(`topK exceeds the maximum allowed value (${topK} > ${limits.maxTopK}).`);
  }
}

export function validateDeleteRequest(request: {
  ids?: readonly string[];
  filter?: unknown;
  deleteAll?: boolean;
}): void {
  const modesSpecified = [request.ids !== undefined, request.filter !== undefined, request.deleteAll === true].filter(
    Boolean
  ).length;

  if (modesSpecified === 0) {
    throw new VectorDBValidationError('A delete request must specify one of: ids, filter, or deleteAll.');
  }
  if (modesSpecified > 1) {
    throw new VectorDBValidationError('A delete request must specify exactly one of: ids, filter, or deleteAll — not more than one.');
  }
}
