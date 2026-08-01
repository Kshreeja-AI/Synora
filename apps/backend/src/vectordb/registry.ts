import type { VectorDBProviderDescriptor } from './descriptor';

/**
 * The complete list of vector DB providers this application knows how to
 * talk to, in auto-detection priority order (first configured wins when
 * `VECTORDB_PROVIDER` is not set explicitly). Mirrors `../embeddings/registry.ts`.
 *
 * Adding a new provider means adding one entry here and one new file under
 * `./providers/` — nothing else in the application changes.
 */
import { pineconeVectorDBDescriptor } from './providers/pinecone.provider';
import { qdrantVectorDBDescriptor } from './providers/qdrant.provider';
import { weaviateVectorDBDescriptor } from './providers/weaviate.provider';
import { milvusVectorDBDescriptor } from './providers/milvus.provider';
import { pgvectorVectorDBDescriptor } from './providers/pgvector.provider';

export const VECTORDB_PROVIDER_REGISTRY: readonly VectorDBProviderDescriptor[] = [
  pineconeVectorDBDescriptor,
  qdrantVectorDBDescriptor,
  weaviateVectorDBDescriptor,
  milvusVectorDBDescriptor,
  pgvectorVectorDBDescriptor,
];

export function getVectorDBProviderDescriptor(id: string): VectorDBProviderDescriptor | undefined {
  return VECTORDB_PROVIDER_REGISTRY.find((p) => p.id === id);
}
