/**
 * Universal Memory System - Public API
 * Provider-independent long-term memory engine for conversations
 */

export * from './types';
export { MemoryService } from './memory.service';
export { PostgresMemoryProvider } from './providers/postgres.provider';
export { consolidationWorker, decayWorker, expiryWorker, embeddingRefreshWorker } from './workers/consolidation.worker';
