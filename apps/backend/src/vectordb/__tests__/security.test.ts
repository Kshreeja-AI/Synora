import { describe, it, expect } from 'vitest';
import {
  validateWorkspaceId,
  validateVectorRecord,
  validateUpsertBatch,
  validateQueryVector,
  validateDeleteRequest,
} from '../security';
import { VectorDBDimensionMismatchError, VectorDBValidationError } from '../types';

const limits = { maxUpsertRequestSize: 3, maxTopK: 100, maxDimensions: 5 };

describe('validateWorkspaceId', () => {
  it('accepts a non-empty workspaceId', () => {
    expect(() => validateWorkspaceId('ws-1')).not.toThrow();
  });

  it('rejects an empty or whitespace-only workspaceId', () => {
    expect(() => validateWorkspaceId('')).toThrow(VectorDBValidationError);
    expect(() => validateWorkspaceId('   ')).toThrow(VectorDBValidationError);
  });
});

describe('validateVectorRecord', () => {
  it('accepts a well-formed record', () => {
    expect(() => validateVectorRecord({ id: 'v1', values: [1, 2, 3] }, limits)).not.toThrow();
  });

  it('rejects a record with an empty id', () => {
    expect(() => validateVectorRecord({ id: '', values: [1] }, limits)).toThrow(/id is required/);
  });

  it('rejects a record with an empty values array', () => {
    expect(() => validateVectorRecord({ id: 'v1', values: [] }, limits)).toThrow(/non-empty values/);
  });

  it('rejects a record exceeding maxDimensions', () => {
    expect(() => validateVectorRecord({ id: 'v1', values: [1, 2, 3, 4, 5, 6] }, limits)).toThrow(
      /exceeds the maximum allowed dimensionality/
    );
  });
});

describe('validateUpsertBatch', () => {
  it('accepts a batch within limits with consistent dimensions', () => {
    expect(() =>
      validateUpsertBatch([{ id: 'a', values: [1, 2] }, { id: 'b', values: [3, 4] }], limits)
    ).not.toThrow();
  });

  it('rejects an empty batch', () => {
    expect(() => validateUpsertBatch([], limits)).toThrow(/at least one vector/);
  });

  it('rejects a batch exceeding maxUpsertRequestSize', () => {
    const vectors = [
      { id: 'a', values: [1] },
      { id: 'b', values: [1] },
      { id: 'c', values: [1] },
      { id: 'd', values: [1] },
    ];
    expect(() => validateUpsertBatch(vectors, limits)).toThrow(/exceeds the maximum allowed size/);
  });

  it('rejects inconsistent dimensions across the batch', () => {
    expect(() =>
      validateUpsertBatch([{ id: 'a', values: [1, 2] }, { id: 'b', values: [1, 2, 3] }], limits)
    ).toThrow(VectorDBDimensionMismatchError);
  });
});

describe('validateQueryVector', () => {
  it('accepts a well-formed query', () => {
    expect(() => validateQueryVector([1, 2, 3], 10, limits)).not.toThrow();
  });

  it('rejects an empty vector', () => {
    expect(() => validateQueryVector([], 10, limits)).toThrow(/non-empty array/);
  });

  it('rejects a vector exceeding maxDimensions', () => {
    expect(() => validateQueryVector([1, 2, 3, 4, 5, 6], 10, limits)).toThrow(/exceeds the maximum allowed dimensionality/);
  });

  it('rejects a non-positive topK', () => {
    expect(() => validateQueryVector([1], 0, limits)).toThrow(/positive integer/);
    expect(() => validateQueryVector([1], -1, limits)).toThrow(/positive integer/);
  });

  it('rejects a topK exceeding maxTopK', () => {
    expect(() => validateQueryVector([1], 101, limits)).toThrow(/exceeds the maximum allowed value/);
  });
});

describe('validateDeleteRequest', () => {
  it('accepts a request with exactly one of ids/filter/deleteAll', () => {
    expect(() => validateDeleteRequest({ ids: ['a'] })).not.toThrow();
    expect(() => validateDeleteRequest({ filter: { a: 1 } })).not.toThrow();
    expect(() => validateDeleteRequest({ deleteAll: true })).not.toThrow();
  });

  it('rejects a request specifying none of ids/filter/deleteAll', () => {
    expect(() => validateDeleteRequest({})).toThrow(/must specify one of/);
  });

  it('rejects a request specifying more than one of ids/filter/deleteAll', () => {
    expect(() => validateDeleteRequest({ ids: ['a'], deleteAll: true })).toThrow(/not more than one/);
  });
});
