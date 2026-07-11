import {
  type EmbeddingProvider,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryStore,
  type ScoredMemory,
  type VectorStore,
  asMemoryId,
} from '@synora/core';
import { v4 as uuidv4 } from 'uuid';

/**
 * MemoryStore implementation: embeds content through an
 * EmbeddingProvider, persists via a VectorStore, and layers on
 * tenant/agent/kind scoping so unrelated agents (or tenants) never
 * retrieve each other's memories even though they may share the same
 * underlying vector index.
 */
export class VectorMemoryStore implements MemoryStore {
  constructor(
    private readonly vectorStore: VectorStore,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async write(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord> {
    const [vector] = await this.embeddings.embed([record.content]);
    if (!vector) throw new Error('Embedding provider returned no vector');

    const full: MemoryRecord = {
      ...record,
      id: asMemoryId(uuidv4()),
      createdAt: new Date().toISOString(),
    };

    await this.vectorStore.upsert([
      {
        id: full.id,
        vector,
        metadata: {
          tenantId: full.tenantId,
          agentId: full.agentId,
          kind: full.kind,
          content: full.content,
          createdAt: full.createdAt,
          importance: full.importance ?? 0,
          ...full.metadata,
        },
      },
    ]);

    return full;
  }

  async search(query: MemoryQuery): Promise<ScoredMemory[]> {
    const [vector] = query.text
      ? await this.embeddings.embed([query.text])
      : [new Array(this.embeddings.dimensions).fill(0)];
    if (!vector) throw new Error('Embedding provider returned no vector');

    const filter: Record<string, unknown> = {
      tenantId: query.tenantId,
      agentId: query.agentId,
      ...(query.kind ? { kind: query.kind } : {}),
      ...query.metadataFilter,
    };

    const results = await this.vectorStore.query(vector, { topK: query.topK ?? 10, filter });

    return results
      .filter((r) => (query.minScore === undefined ? true : r.score >= query.minScore))
      .map(
        (r): ScoredMemory => ({
          score: r.score,
          record: {
            id: asMemoryId(r.id),
            tenantId: r.metadata.tenantId as MemoryRecord['tenantId'],
            agentId: r.metadata.agentId as MemoryRecord['agentId'],
            kind: r.metadata.kind as MemoryRecord['kind'],
            content: r.metadata.content as string,
            importance: r.metadata.importance as number | undefined,
            createdAt: r.metadata.createdAt as string,
            metadata: r.metadata,
          },
        }),
      );
  }

  async forget(id: string): Promise<void> {
    await this.vectorStore.delete([id]);
  }

  async touch(_id: string): Promise<void> {
    // Access-time bumps are a future optimization (recency-weighted recall);
    // no-op keeps the port stable until a store needs it.
  }
}
