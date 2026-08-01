-- Universal Memory System (Release 3)
-- Migration: Add provider-independent memory storage, versioning, permissions, and audit trails

-- Create enum types
CREATE TYPE "MemoryType" AS ENUM ('SHORT_TERM', 'LONG_TERM', 'SEMANTIC', 'EPISODIC', 'WORKSPACE', 'CONVERSATION', 'PINNED', 'MANUAL', 'AUTOMATIC');
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED', 'EXPIRED', 'CONSOLIDATING', 'DECAYING');
CREATE TYPE "MemoryPermission" AS ENUM ('PRIVATE', 'WORKSPACE', 'SHARED', 'PUBLIC');

-- Create Memory table (main memory records)
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "type" "MemoryType" NOT NULL,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "decayRate" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isManual" BOOLEAN NOT NULL DEFAULT true,
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "permission" "MemoryPermission" NOT NULL DEFAULT 'PRIVATE',
    "sharedWith" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "embeddingId" TEXT,
    "embeddingModel" TEXT,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 0,
    "embeddingRefreshNeeded" BOOLEAN NOT NULL DEFAULT false,
    "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "encryptionKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Memory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE,
    CONSTRAINT "Memory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE,
    CONSTRAINT "Memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "Memory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Memory" ("id") ON DELETE SET NULL
);

-- Create MemoryMetadata table (detailed metadata)
CREATE TABLE "MemoryMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL UNIQUE,
    "source" TEXT,
    "context" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isConsolidated" BOOLEAN NOT NULL DEFAULT false,
    "consolidatedAt" TIMESTAMP(3),
    "consolidationScore" DOUBLE PRECISION,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "retrievalCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetrievedAt" TIMESTAMP(3),
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemoryMetadata_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE
);

-- Create MemoryRelation table (connections between memories)
CREATE TABLE "MemoryRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemoryRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Memory" ("id") ON DELETE CASCADE,
    CONSTRAINT "MemoryRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Memory" ("id") ON DELETE CASCADE,
    CONSTRAINT "MemoryRelation_fromId_toId_relationType_key" UNIQUE ("fromId", "toId", "relationType")
);

-- Create MemoryAuditLog table (audit trail)
CREATE TABLE "MemoryAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryAuditLog_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE,
    CONSTRAINT "MemoryAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Create MemoryQuota table (usage quotas)
CREATE TABLE "MemoryQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL UNIQUE,
    "maxMemories" INTEGER NOT NULL DEFAULT 10000,
    "maxTokens" INTEGER NOT NULL DEFAULT 1000000,
    "maxStorage" BIGINT NOT NULL DEFAULT 1000000000,
    "currentMemories" INTEGER NOT NULL DEFAULT 0,
    "currentTokens" INTEGER NOT NULL DEFAULT 0,
    "currentStorage" BIGINT NOT NULL DEFAULT 0,
    "maxConsolidationsPerDay" INTEGER NOT NULL DEFAULT 100,
    "consolidationsUsedToday" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemoryQuota_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE
);

-- Create MemoryCache table (Redis backup for cache layer)
CREATE TABLE "MemoryCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryId" TEXT NOT NULL UNIQUE,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "serialized" TEXT NOT NULL
);

-- Create MemoryExport table (export jobs)
CREATE TABLE "MemoryExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filteredBy" TEXT,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryExport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE,
    CONSTRAINT "MemoryExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX "Memory_workspaceId_idx" ON "Memory"("workspaceId");
CREATE INDEX "Memory_conversationId_idx" ON "Memory"("conversationId");
CREATE INDEX "Memory_userId_idx" ON "Memory"("userId");
CREATE INDEX "Memory_type_idx" ON "Memory"("type");
CREATE INDEX "Memory_status_idx" ON "Memory"("status");
CREATE INDEX "Memory_isPinned_idx" ON "Memory"("isPinned");
CREATE INDEX "Memory_importance_idx" ON "Memory"("importance");
CREATE INDEX "Memory_createdAt_idx" ON "Memory"("createdAt");
CREATE INDEX "Memory_workspaceId_conversationId_type_idx" ON "Memory"("workspaceId", "conversationId", "type");
CREATE INDEX "Memory_workspaceId_userId_status_idx" ON "Memory"("workspaceId", "userId", "status");

CREATE INDEX "MemoryRelation_fromId_idx" ON "MemoryRelation"("fromId");
CREATE INDEX "MemoryRelation_toId_idx" ON "MemoryRelation"("toId");

CREATE INDEX "MemoryAuditLog_memoryId_idx" ON "MemoryAuditLog"("memoryId");
CREATE INDEX "MemoryAuditLog_userId_idx" ON "MemoryAuditLog"("userId");
CREATE INDEX "MemoryAuditLog_action_idx" ON "MemoryAuditLog"("action");
CREATE INDEX "MemoryAuditLog_createdAt_idx" ON "MemoryAuditLog"("createdAt");

CREATE INDEX "MemoryExport_workspaceId_idx" ON "MemoryExport"("workspaceId");
CREATE INDEX "MemoryExport_userId_idx" ON "MemoryExport"("userId");

-- Create full-text search index
CREATE INDEX "Memory_content_search_idx" ON "Memory" USING GIN(to_tsvector('english', "content"));
