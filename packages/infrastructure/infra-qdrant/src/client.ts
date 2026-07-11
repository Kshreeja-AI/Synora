import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantClientOptions {
  url: string;
  apiKey?: string;
}

export function createQdrantClient(options: QdrantClientOptions): QdrantClient {
  return new QdrantClient({
    url: options.url,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  });
}
