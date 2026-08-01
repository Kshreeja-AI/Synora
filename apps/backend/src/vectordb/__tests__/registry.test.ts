import { describe, it, expect } from 'vitest';
import { VECTORDB_PROVIDER_REGISTRY, getVectorDBProviderDescriptor } from '../registry';

describe('VECTORDB_PROVIDER_REGISTRY', () => {
  it('includes every provider named in the product requirement', () => {
    const ids = VECTORDB_PROVIDER_REGISTRY.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['pinecone', 'qdrant', 'weaviate', 'milvus', 'pgvector']));
  });

  it('has no duplicate ids', () => {
    const ids = VECTORDB_PROVIDER_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists pgvector last, so a real vector DB always wins auto-detection when both are configured', () => {
    expect(VECTORDB_PROVIDER_REGISTRY[VECTORDB_PROVIDER_REGISTRY.length - 1].id).toBe('pgvector');
  });
});

describe('getVectorDBProviderDescriptor', () => {
  it('finds a known provider by id', () => {
    expect(getVectorDBProviderDescriptor('pinecone')?.displayName).toBe('Pinecone');
  });

  it('returns undefined for an unknown id', () => {
    expect(getVectorDBProviderDescriptor('not-a-real-provider')).toBeUndefined();
  });
});
