// Implementation moved to src/resilience/retry.ts so the text stack can
// share it — one retry policy, never two that drift. This re-export keeps
// every existing embeddings import stable.
export * from '../resilience/retry';
