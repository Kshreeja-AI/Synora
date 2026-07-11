# @synora/infra-llm-openrouter

**Infrastructure layer** adapter for `DEFAULT_LLM_PROVIDER=openrouter` and
`DEFAULT_EMBEDDING_PROVIDER=openai-compatible`. Uses Node's built-in `fetch` against the
OpenAI-compatible chat-completions/embeddings HTTP API (no vendor SDK dependency —
OpenRouter, and most "openai-compatible" providers, only need a base URL + bearer token).

- `OpenRouterLlmProvider implements LlmProvider`
- `OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider`

Both take an injected `fetch`-like function so tests don't hit the network.
