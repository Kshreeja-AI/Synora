import type { VectorMatch, VectorRecord, VectorStore } from '@synora/application';
import type { VectorClientLike } from './vector-client-like.js';

export class QdrantVectorStore implements VectorStore {
  constructor(private readonly client: VectorClientLike) {}

  async upsert(collection: string, records: readonly VectorRecord[]): Promise<void> {
    await this.client.upsert(collection, {
      points: records.map((record) => ({
        id: record.id,
        vector: [...record.vector],
        ...(record.metadata ? { payload: { ...record.metadata } } : {}),
      })),
    });
  }

  async query(collection: string, vector: readonly number[], topK: number): Promise<VectorMatch[]> {
    const hits = await this.client.search(collection, { vector: [...vector], limit: topK });
    return hits.map((hit) => ({
      id: String(hit.id),
      score: hit.score,
      ...(hit.payload ? { metadata: hit.payload } : {}),
    }));
  }

  async deleteCollection(collection: string): Promise<void> {
    await this.client.deleteCollection(collection);
  }
}
