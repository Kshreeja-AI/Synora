// Implementation moved to src/resilience/rateLimiter.ts so the text
// stack can share it — one definition of how Synora paces itself toward
// vendors, never two that drift. This re-export keeps every existing
// embeddings import stable. The module-level singleton remains the
// embeddings stack's own; the text stack constructs its own instance.
export * from '../resilience/rateLimiter';
