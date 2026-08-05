// Implementation moved to src/resilience/circuitBreaker.ts so the text
// stack can share it — one set of trip/recover rules, never two that
// drift. This re-export keeps every existing embeddings import stable.
export * from '../resilience/circuitBreaker';
