# @synora/infra-qdrant

**Infrastructure layer** adapter for `DEFAULT_VECTOR_DATABASE=qdrant` and
`ENABLE_VECTOR_MEMORY=true`. `QdrantVectorStore` implements the `VectorStore` port from
`@synora/application` against a minimal `VectorClientLike` interface, not the concrete SDK
client, so tests inject a fake instead of needing a live Qdrant instance.
