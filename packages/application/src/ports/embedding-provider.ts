/** Port for text embeddings (default provider: openai-compatible — see infra-llm-openrouter). */
export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<number[][]>;
}
