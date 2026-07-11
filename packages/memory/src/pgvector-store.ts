import type { VectorStore } from '@synora/core';
import pg from 'pg';

const { Pool } = pg;

export interface PgVectorStoreOptions {
  connectionString: string;
  /** Embedding dimensionality; must match the configured EmbeddingProvider. */
  dimensions: number;
  tableName?: string;
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Postgres + pgvector-backed VectorStore for production deployments.
 * Same VectorStore contract as InMemoryVectorStore, so MemoryStore and
 * everything above it is unaware which one is wired in.
 */
export class PgVectorStore implements VectorStore {
  private readonly pool: pg.Pool;
  private readonly tableName: string;
  private readonly dimensions: number;
  private schemaReady: Promise<void> | undefined;

  constructor(options: PgVectorStoreOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
    this.tableName = options.tableName ?? 'synora_vectors';
    this.dimensions = options.dimensions;
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            id TEXT PRIMARY KEY,
            embedding vector(${this.dimensions}) NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb
          )
        `);
        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx ON ${this.tableName} USING ivfflat (embedding vector_cosine_ops)`,
        );
      })();
    }
    return this.schemaReady;
  }

  async upsert(
    entries: { id: string; vector: number[]; metadata: Record<string, unknown> }[],
  ): Promise<void> {
    await this.ensureSchema();
    if (entries.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        await client.query(
          `INSERT INTO ${this.tableName} (id, embedding, metadata)
           VALUES ($1, $2::vector, $3::jsonb)
           ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
          [entry.id, toVectorLiteral(entry.vector), JSON.stringify(entry.metadata)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async query(
    vector: number[],
    options: { topK: number; filter?: Record<string, unknown> },
  ): Promise<{ id: string; score: number; metadata: Record<string, unknown> }[]> {
    await this.ensureSchema();
    const filterClause = options.filter ? 'AND metadata @> $3::jsonb' : '';
    const params: unknown[] = [toVectorLiteral(vector), options.topK];
    if (options.filter) params.push(JSON.stringify(options.filter));

    const { rows } = await this.pool.query(
      `SELECT id, metadata, 1 - (embedding <=> $1::vector) AS score
       FROM ${this.tableName}
       WHERE TRUE ${filterClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      params,
    );
    return rows.map((row) => ({ id: row.id, score: Number(row.score), metadata: row.metadata }));
  }

  async delete(ids: string[]): Promise<void> {
    await this.ensureSchema();
    if (ids.length === 0) return;
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = ANY($1)`, [ids]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
