import type { EmbeddingProvider, MemoryStore, VectorStore } from '@synora/core';
import { InMemoryVectorStore } from './in-memory-vector-store.js';
import { PgVectorStore } from './pgvector-store.js';
import { VectorMemoryStore } from './vector-memory-store.js';

export type VectorStoreDriver = 'in-memory' | 'pgvector';

export function createVectorStore(
  driver: VectorStoreDriver,
  options: { connectionString?: string; dimensions: number },
): VectorStore {
  switch (driver) {
    case 'in-memory':
      return new InMemoryVectorStore();
    case 'pgvector':
      if (!options.connectionString) {
        throw new Error('DATABASE_URL is required when VECTOR_STORE_DRIVER=pgvector');
      }
      return new PgVectorStore({
        connectionString: options.connectionString,
        dimensions: options.dimensions,
      });
    default:
      throw new Error(`Unknown vector store driver: ${driver satisfies never}`);
  }
}

export function createMemoryStore(
  vectorStore: VectorStore,
  embeddings: EmbeddingProvider,
): MemoryStore {
  return new VectorMemoryStore(vectorStore, embeddings);
}
