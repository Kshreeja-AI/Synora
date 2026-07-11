/** The minimal subset of the Qdrant SDK client QdrantVectorStore needs — lets tests inject a fake. */
export interface QdrantPoint {
  id: string;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface QdrantSearchHit {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
}

export interface VectorClientLike {
  upsert(collection: string, params: { points: QdrantPoint[] }): Promise<unknown>;
  search(
    collection: string,
    params: { vector: number[]; limit: number },
  ): Promise<QdrantSearchHit[]>;
  deleteCollection(collection: string): Promise<unknown>;
}
