/** Port for vector similarity search (default provider: Qdrant — see infra-qdrant). */
export interface VectorRecord {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VectorMatch {
  readonly id: string;
  readonly score: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VectorStore {
  upsert(collection: string, records: readonly VectorRecord[]): Promise<void>;
  query(collection: string, vector: readonly number[], topK: number): Promise<VectorMatch[]>;
  deleteCollection(collection: string): Promise<void>;
}
