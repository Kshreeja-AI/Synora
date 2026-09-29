// Implementation moved to src/resilience/tracing.ts so the text stack can
// share it — one span format across every provider-calling stack, not two
// that drift. This re-export keeps every existing embeddings import stable.
export * from '../resilience/tracing';
