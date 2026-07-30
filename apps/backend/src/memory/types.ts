/**
 * Universal Memory System Type Definitions
 * Provider-independent types for long-term memory engine
 * Supports billions of memory records across workspaces
 */

export type MemoryType =
  | 'SHORT_TERM'
  | 'LONG_TERM'
  | 'SEMANTIC'
  | 'EPISODIC'
  | 'WORKSPACE'
  | 'CONVERSATION'
  | 'PINNED'
  | 'MANUAL'
  | 'AUTOMATIC';

export type MemoryStatus =
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'DELETED'
  | 'EXPIRED'
  | 'CONSOLIDATING'
  | 'DECAYING';

export type MemoryPermission = 'PRIVATE' | 'WORKSPACE' | 'SHARED' | 'PUBLIC';

export interface Memory {
  id: string;
  workspaceId: string;
  conversationId?: string;
  userId: string;
  content: string;
  summary?: string;
  type: MemoryType;
  category?: string;
  tags: string[];
  importance: number; // 0-1 score
  decayRate: number; // Daily decay percentage
  lastAccessedAt?: Date;
  accessCount: number;
  isArchived: boolean;
  isPinned: boolean;
  isManual: boolean;
  status: MemoryStatus;
  permission: MemoryPermission;
  sharedWith: string[]; // userIds
  version: number;
  parentId?: string;
  embeddingId?: string;
  embeddingModel?: string;
  embeddingVersion: number;
  embeddingRefreshNeeded: boolean;
  isEncrypted: boolean;
  encryptionKey?: string;
  expiresAt?: Date;
  metadata?: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryMetadata {
  id: string;
  memoryId: string;
  source?: string;
  context?: Record<string, any>;
  confidence: number;
  isConsolidated: boolean;
  consolidatedAt?: Date;
  consolidationScore?: number;
  relevanceScore: number;
  retrievalCount: number;
  lastRetrievedAt?: Date;
  tokens: number;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRelation {
  id: string;
  fromId: string;
  toId: string;
  relationType: string; // "related_to", "references", "contradicts", etc.
  strength: number; // 0-1
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryAuditLog {
  id: string;
  memoryId: string;
  userId: string;
  action: string;
  changes?: Record<string, any>;
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface MemoryQuota {
  id: string;
  workspaceId: string;
  maxMemories: number;
  maxTokens: number;
  maxStorage: bigint;
  currentMemories: number;
  currentTokens: number;
  currentStorage: bigint;
  maxConsolidationsPerDay: number;
  consolidationsUsedToday: number;
  lastResetAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryInput {
  content: string;
  type: MemoryType;
  category?: string;
  tags?: string[];
  importance?: number;
  decayRate?: number;
  isManual?: boolean;
  permission?: MemoryPermission;
  sharedWith?: string[];
  conversationId?: string;
  context?: Record<string, any>;
  expiresAt?: Date;
}

export interface UpdateMemoryInput {
  content?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  importance?: number;
  decayRate?: number;
  isPinned?: boolean;
  status?: MemoryStatus;
  permission?: MemoryPermission;
  sharedWith?: string[];
}

export interface MemorySearchQuery {
  workspaceId: string;
  userId?: string;
  conversationId?: string;
  query?: string;
  type?: MemoryType;
  category?: string;
  tags?: string[];
  status?: MemoryStatus;
  minImportance?: number;
  dateRange?: { from: Date; to: Date };
  permission?: MemoryPermission;
  limit?: number;
  offset?: number;
}

export interface MemorySearchResult {
  memories: Memory[];
  total: number;
  hasMore: boolean;
  query: MemorySearchQuery;
}

export interface SemanticSearchQuery {
  workspaceId: string;
  query: string;
  embedding?: number[];
  limit?: number;
  threshold?: number; // Cosine similarity threshold (0-1)
}

export interface ConsolidationResult {
  originalMemories: string[]; // Memory IDs
  consolidatedMemoryId: string;
  summarizedContent: string;
  tokensReduced: number;
  importanceScore: number;
}

export interface MemoryConsolidationJob {
  id: string;
  workspaceId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  memoriesToConsolidate: string[];
  result?: ConsolidationResult;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface EmbeddingRequest {
  memoryId: string;
  content: string;
  model: string;
  refresh?: boolean;
}

export interface EmbeddingVector {
  memoryId: string;
  model: string;
  vector: number[];
  dimension: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryExportJob {
  id: string;
  workspaceId: string;
  userId: string;
  format: 'json' | 'markdown' | 'csv' | 'html';
  filter?: MemorySearchQuery;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  storageKey?: string;
  size?: number;
  error?: string;
  completedAt?: Date;
  createdAt: Date;
}

export interface MemoryImportJob {
  id: string;
  workspaceId: string;
  userId: string;
  sourceFormat: string;
  storageKey: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  importedCount?: number;
  failedCount?: number;
  error?: string;
  completedAt?: Date;
  createdAt: Date;
}

export interface MemoryAnalytics {
  workspaceId: string;
  totalMemories: number;
  memoriesByType: Record<MemoryType, number>;
  memoriesByStatus: Record<MemoryStatus, number>;
  averageImportance: number;
  totalTokens: number;
  totalStorage: number;
  consolidationsToday: number;
  retrievalsToday: number;
  decayedMemoriesCount: number;
  expiringMemoriesCount: number;
}

export interface MemoryCache {
  memoryId: string;
  serialized: string;
  cachedAt: Date;
  expiresAt: Date;
  hits: number;
  lastHitAt?: Date;
}

export interface MemoryProvider {
  name: string;
  type: 'storage' | 'embedding' | 'cache' | 'search';

  // Storage operations
  create?(memory: CreateMemoryInput, userId: string, workspaceId: string): Promise<Memory>;
  read?(memoryId: string, userId: string, workspaceId: string): Promise<Memory | null>;
  update?(memoryId: string, input: UpdateMemoryInput, userId: string, workspaceId: string): Promise<Memory>;
  delete?(memoryId: string, userId: string, workspaceId: string, soft?: boolean): Promise<void>;

  // Search operations
  search?(query: MemorySearchQuery): Promise<MemorySearchResult>;
  semanticSearch?(query: SemanticSearchQuery): Promise<MemorySearchResult>;

  // Embedding operations
  embed?(text: string, model: string): Promise<number[]>;
  searchByVector?(vector: number[], limit: number, threshold: number): Promise<Memory[]>;

  // Caching operations
  cache?(memory: Memory, ttl: number): Promise<void>;
  getFromCache?(memoryId: string): Promise<Memory | null>;

  // Consolidation
  consolidate?(memoryIds: string[], workspaceId: string): Promise<ConsolidationResult>;

  // Metadata
  getAnalytics?(workspaceId: string): Promise<MemoryAnalytics>;
}
