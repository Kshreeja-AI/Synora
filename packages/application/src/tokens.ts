import { createToken } from '@synora/di';
import type { AuthProvider } from './ports/auth-provider.js';
import type { Cache } from './ports/cache.js';
import type { Clock } from './ports/clock.js';
import type { EmbeddingProvider } from './ports/embedding-provider.js';
import type { IdGenerator } from './ports/id-generator.js';
import type { LlmProvider } from './ports/llm-provider.js';
import type { ObjectStorage } from './ports/object-storage.js';
import type { Queue } from './ports/queue.js';
import type { VectorStore } from './ports/vector-store.js';
import type { WorkflowEngine } from './ports/workflow-engine.js';

/**
 * DI tokens for the platform-wide ports defined in this package. The composition root
 * (apps/api-gateway) binds each of these to a concrete infra-* adapter; plugins resolve
 * them from the Container they receive in PluginContext instead of importing an adapter
 * directly. See docs/architecture/04-dependency-injection.md.
 */
export const CLOCK = createToken<Clock>('Clock');
export const ID_GENERATOR = createToken<IdGenerator>('IdGenerator');
export const CACHE = createToken<Cache>('Cache');
export const QUEUE = createToken<Queue>('Queue');
export const VECTOR_STORE = createToken<VectorStore>('VectorStore');
export const LLM_PROVIDER = createToken<LlmProvider>('LlmProvider');
export const EMBEDDING_PROVIDER = createToken<EmbeddingProvider>('EmbeddingProvider');
export const OBJECT_STORAGE = createToken<ObjectStorage>('ObjectStorage');
export const AUTH_PROVIDER = createToken<AuthProvider>('AuthProvider');
export const WORKFLOW_ENGINE = createToken<WorkflowEngine>('WorkflowEngine');
