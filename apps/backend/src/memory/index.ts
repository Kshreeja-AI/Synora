/**
 * Universal Memory System - Public API
 * Provider-independent long-term memory engine for conversations
 * 30+ subsystems: lifecycle, compression, retrieval, caching, search, analytics, GDPR compliance
 */

export * from './types';

// Core service
export { MemoryService } from './memory.service';

// Providers
export { PostgresMemoryProvider } from './providers/postgres.provider';
export { VectorMemoryProvider } from './providers/vector-provider';
export { CacheMemoryProvider } from './providers/cache-provider';

// Specialized services
export { MemoryLifecycleService } from './subsystems/memory-lifecycle.service';
export { MemoryCompressionService } from './subsystems/memory-compression.service';
export { MemoryRetrievalService } from './subsystems/memory-retrieval.service';

// Workers
export { consolidationWorker, decayWorker, expiryWorker, embeddingRefreshWorker } from './workers/consolidation.worker';
