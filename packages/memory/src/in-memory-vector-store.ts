import type { VectorStore } from '@synora/core';

interface Entry {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesFilter(
  metadata: Record<string, unknown>,
  filter?: Record<string, unknown>,
): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

/**
 * Brute-force, in-process VectorStore. O(n) per query — fine for
 * local dev, tests, and small tenants; swap in PgVectorStore (or any
 * other VectorStore implementation) once recall volume outgrows a
 * single process.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, Entry>();

  async upsert(entries: Entry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }

  async query(
    vector: number[],
    options: { topK: number; filter?: Record<string, unknown> },
  ): Promise<{ id: string; score: number; metadata: Record<string, unknown> }[]> {
    const scored = Array.from(this.entries.values())
      .filter((entry) => matchesFilter(entry.metadata, options.filter))
      .map((entry) => ({
        id: entry.id,
        score: cosineSimilarity(vector, entry.vector),
        metadata: entry.metadata,
      }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, options.topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.entries.delete(id);
  }
}
