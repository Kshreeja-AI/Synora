import type { AgentId, MemoryId, SessionId, TenantId } from './ids.js';
import type { Message } from './message.js';

export type MemoryKind = 'working' | 'episodic' | 'semantic' | 'procedural';

export interface MemoryRecord {
  id: MemoryId;
  tenantId: TenantId;
  agentId: AgentId;
  kind: MemoryKind;
  content: string;
  embedding?: number[];
  importance?: number;
  createdAt: string;
  lastAccessedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  tenantId: TenantId;
  agentId: AgentId;
  kind?: MemoryKind;
  text?: string;
  topK?: number;
  minScore?: number;
  metadataFilter?: Record<string, unknown>;
}

export interface ScoredMemory {
  record: MemoryRecord;
  score: number;
}

/**
 * Long-term memory port. "Working" memory is the live conversation
 * window (see ConversationStore); episodic/semantic/procedural records
 * persist across sessions and are retrieved by similarity or filter.
 */
export interface MemoryStore {
  write(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>;
  search(query: MemoryQuery): Promise<ScoredMemory[]>;
  forget(id: MemoryId): Promise<void>;
  touch(id: MemoryId): Promise<void>;
}

/**
 * Short-lived, per-session transcript storage — the "working memory"
 * an agent run reads and appends to. Distinct from MemoryStore so a
 * product can back conversation history with Postgres/Redis while
 * long-term recall lives in a vector store, or vice versa.
 */
export interface ConversationStore {
  append(sessionId: SessionId, messages: Message[]): Promise<void>;
  history(sessionId: SessionId, limit?: number): Promise<Message[]>;
  clear(sessionId: SessionId): Promise<void>;
}

/** Port for turning text into vectors; kept separate from ModelProvider.embed
 *  so memory can pick an embedding model independent of the chat model. */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface VectorStore {
  upsert(
    entries: { id: string; vector: number[]; metadata: Record<string, unknown> }[],
  ): Promise<void>;
  query(
    vector: number[],
    options: { topK: number; filter?: Record<string, unknown> },
  ): Promise<{ id: string; score: number; metadata: Record<string, unknown> }[]>;
  delete(ids: string[]): Promise<void>;
}
