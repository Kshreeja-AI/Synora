# M4 Dependency Audit: Conversation Search Requirements

**Audit Date:** 2026-07-30  
**Scope:** Verify all dependencies for Milestone 4 (Universal Search) implementation  
**Status:** ⛔ **BLOCKED** — Critical dependencies missing

---

## Executive Summary

Milestone 4 (Conversation Search) has **3 CRITICAL BLOCKERS** that prevent implementation:

1. **❌ Bull Queue / Background Jobs** — Completely absent
2. **❌ Vector Database Integration** — Completely absent  
3. **❌ Embedding Service Abstraction** — Completely absent

All other dependencies exist and are functional. These three must be remediated before M4 can proceed.

---

## Detailed Audit Results

### 1. Conversation System ✅ COMPLETE

**Status:** Complete and production-ready

**Verified Components:**
- ✅ Conversation model (schema.prisma:815-852)
  - Fields: id, workspaceId, title, description, provider, model, status, isArchived, isPinned, lastMessageAt
  - Relations: Workspace, Messages, Folders, Tags, Collaborators, Versions, Activity, Shared, Usage, ToolCalls
  - Indexes: workspace + created_at, workspace + lastMessageAt, isArchived, isPinned

- ✅ Message model (schema.prisma:869-892)
  - Fields: id, conversationId, content, role, parentId, deletedAt
  - Relations: Conversation, Parent/Children (threading), Branch, Attachments, StreamingJob
  - Indexes: conversationId + createdAt, conversationId + deletedAt, parentId
  - Soft delete support via deletedAt nullable timestamp

- ✅ ConversationTag model (schema.prisma:949-962)
  - Tag management with workspace isolation
  - Unique constraint on (workspaceId, name)
  - Relationships to Conversation model

- ✅ ConversationFolder model (schema.prisma:928-947)
  - Hierarchical folder structure (parent-child relations)
  - Workspace scoping
  - Conversation containment

- ✅ Conversation CRUD (services/conversation.service.ts)
  - Create, read, update, delete operations
  - Archive/unarchive support
  - Workspace isolation verified

- ✅ Message CRUD (services/message.service.ts)
  - Create, read, update, delete operations
  - Threading support (parentId)
  - Soft delete implementation

- ✅ Workspace Isolation
  - All queries filter by workspaceId
  - Permission checks before operations
  - ConversationFolder.workspaceId, ConversationTag.workspaceId enforced

- ✅ Permissions (services/permissions.ts)
  - Role-based access control (OWNER, ADMIN, EDITOR, MEMBER, VIEWER)
  - Permissions: conversation:create, conversation:manage, message:send, message:manage
  - Enforcement: requirePermission() called in all routes
  - Verified in: streaming.ts, message.service.ts, conversation.service.ts

**Search Dependencies Met:** ✅ Can filter by conversation/message ownership, role, and workspace

---

### 2. Streaming Infrastructure ✅ COMPLETE

**Status:** Complete and production-ready

**Verified Components:**
- ✅ SSE Endpoint (routes/streaming.ts:20-120)
  - GET /api/conversations/:conversationId/stream
  - POST /api/conversations/:conversationId/stream/:jobId/cancel
  - Redis Pub/Sub integration via `job:{jobId}:stream` channel
  - Heartbeat (30s intervals)
  - Proper error handling

- ✅ StreamingJob Model (schema.prisma:1089-1113)
  - status: PENDING, RUNNING, COMPLETED, FAILED, CANCELED
  - Indexes: conversationId, status, (conversationId + status)
  - Foreign key to Message via messageId
  - Tracking: attempt, lastError, timestamps

- ✅ Streaming Service (services/streaming.service.ts)
  - Job creation, retrieval, lifecycle management
  - Status transitions: PENDING → RUNNING → COMPLETED/FAILED/CANCELED
  - Stale job cleanup

- ✅ Provider Abstraction (ai/streaming/resolver.ts)
  - 7 providers registered: anthropic, openai, gemini, openrouter, groq, deepseek, mock
  - Singleton pattern
  - getConfiguredProviders(), isAvailable()

- ✅ Streaming Token Types (ai/streaming/types.ts)
  - StreamChunkType enum: TOKEN, USAGE, ERROR, HEARTBEAT
  - StreamChunk interface for events
  - Error classes: StreamingError, ProviderNotConfiguredError, etc.

- ✅ Token Accumulation (ai/streaming/accumulator.ts)
  - StreamingAccumulator: addChunk(), getText(), getTokenCount()
  - TokenAccountant: tracks input/output tokens separately
  - Progress reporting logic

- ✅ Retry Engine (ai/streaming/statemachine.ts)
  - Exponential backoff [500ms, 1500ms]
  - Max 3 attempts
  - Error classification: isRetryable()

**Search Dependencies Met:** 
- ✅ Can trigger indexing on streaming completion
- ✅ Job status tracking enables incremental indexing resume
- ✅ Message content available after streaming

---

### 3. Provider Abstraction ✅ COMPLETE

**Status:** Complete and production-ready

**Verified Components:**
- ✅ Provider Registry (ai/registry.ts, ai/resolver.ts)
  - 10+ providers: Anthropic, OpenAI, Gemini, Azure OpenAI, Bedrock, DeepSeek, Ollama, OpenRouter, Together, X.AI
  - Model definitions per provider
  - Pricing tables

- ✅ Provider-Independent Interfaces (ai/types.ts)
  - AIMessage, AIResponse, AIModel, AIProvider
  - Request/response contracts

- ✅ Tool Calling Interfaces (ai/types.ts)
  - Tool definitions
  - Tool execution models
  - Integration points for message generation

- ✅ Streaming Provider Interfaces (ai/streaming/types.ts)
  - TextGenerationStreamProvider interface
  - AsyncIterable<StreamChunk> pattern
  - Provider-agnostic streaming contract

**Search Dependencies Met:** ✅ Can abstractly reference providers in search metadata

---

### 4. File System ✅ COMPLETE

**Status:** Complete and functional

**Verified Components:**
- ✅ Upload Pipeline
  - ConversationFile model (planned in schema but references exist in ConversationActivity)
  - MessageAttachment model (schema.prisma:913-926)
  - Asset model for workspace uploads (schema.prisma:309-331)

- ✅ Metadata Storage
  - MessageAttachment: url, mimeType, name, size
  - Asset: mimeType, size, uploadedById, folderId

- ✅ Permissions
  - Folder.createdById, Asset.uploadedById
  - requirePermission checks in routes

- ✅ Processing Hooks
  - ConversationActivity model logs all mutations
  - Hooks can listen to these events

**Search Dependencies Met:** 
- ✅ File metadata can be indexed
- ✅ Search can include file attachments in results

---

### 5. Background Jobs ❌ CRITICAL MISSING

**Status:** Not implemented — this is a blocker

**Current State:**
- ✗ No Bull Queue setup in package.json
- ✗ Only 1 worker exists: generateResponse.worker.ts (partial implementation)
- ✗ No queue infrastructure (connection pooling, error handling, retries)
- ✗ No job scheduling system
- ✗ No worker lifecycle management

**Why This Blocks Search:**
- Search indexing must run async (embed messages, add to vector DB, FTS index)
- Chunking large messages requires background processing
- Incremental reindexing needs job queue
- Embedding API rate limiting needs queued batches
- No way to trigger indexing on message creation without blocking SSE

**What's Needed:**

1. **Bull Queue Setup**
   ```bash
   pnpm add bullmq
   ```

2. **Queue System** (new files)
   - `apps/backend/src/queue/index.ts` — Queue factory, connection management
   - `apps/backend/src/queue/config.ts` — Redis connection config
   - `apps/backend/src/queue/types.ts` — Job data interfaces

3. **Job Definitions** (new files)
   - `apps/backend/src/jobs/searchIndexing.job.ts` — Index message/conversation
   - `apps/backend/src/jobs/embeddings.job.ts` — Compute embeddings
   - `apps/backend/src/jobs/reindex.job.ts` — Full index rebuild

4. **Worker Infrastructure** (new files)
   - `apps/backend/src/workers/index.ts` — Worker registry, lifecycle
   - `apps/backend/src/workers/search-indexer.worker.ts` — Main indexing worker
   - `apps/backend/src/workers/embeddings.worker.ts` — Embedding computation

5. **Integration Points**
   - Message service: emit `message.created`, `message.updated`
   - Conversation service: emit `conversation.created`, `conversation.updated`
   - Event listeners trigger job enqueue

**Effort:** 2-3 days (design + implementation + tests)

---

### 6. Observability 🟡 PARTIAL

**Status:** Partial — logging exists, metrics partial, tracing absent

**Verified Components:**
- ✅ Logging
  - Winston logger configured (utils/logger.ts:1-62)
  - Levels: error, warn, info, debug
  - File + console transports
  - Used in: streaming.ts, conversation routes, services

- ✅ Audit Events
  - AuditLog model (schema.prisma:338-352)
  - ConversationActivity model (schema.prisma:1058-1069)
  - ActivityLog model (schema.prisma:461-477)
  - Comprehensive audit trail

- 🟡 Metrics
  - No Prometheus/metrics export endpoint
  - No gauge/counter/histogram instrumentation
  - No performance tracking for search queries

- ❌ Tracing
  - No distributed tracing (OpenTelemetry, Jaeger, etc.)
  - No correlation IDs for request flow tracking
  - Needed for debugging search performance across async jobs

**What's Missing:**
- Metrics endpoint (for Prometheus scraping)
- Request correlation ID middleware
- Timer instrumentation for search queries
- Error rate tracking per search type (FTS vs vector)

**Impact on Search:**
- Can't monitor search latency
- Can't detect performance regressions
- Can't trace query execution across database + vector DB + cache

**Effort:** 1-2 days (Prometheus metrics + correlation ID middleware)

**Recommendation:** Can be done in parallel with M4 implementation, not blocking

---

### 7. Database Readiness 🟡 PARTIAL

**Status:** Partial — schema ready, FTS setup incomplete, indexes needed

**Verified Components:**
- ✅ PostgreSQL 16+
  - Currently running in docker-compose.dev.yml
  - Prisma ORM configured
  - Connection pooling via Prisma

- ✅ Existing Indexes
  - Conversation: (workspaceId, createdAt), (workspaceId, lastMessageAt), isArchived, isPinned
  - Message: (conversationId, createdAt), (conversationId, deletedAt), parentId
  - Proper FK indexes on relations

- ✅ Migration Infrastructure
  - Prisma Migrate working
  - 13 migrations already applied
  - Schema evolution tested

- ❌ Full-Text Search (FTS) Extension
  - PostgreSQL GIN indexes not yet configured
  - No tsvector columns on Message.content or Conversation.title
  - No stemming/stop-word configuration
  - No search ranking function setup

- ❌ Required Indexes for Search
  - No index on Message.content for FTS
  - No index on Conversation.title for FTS
  - No index on Message.createdAt for recency ranking
  - No index on Conversation.isPinned for pinning ranking

- ❌ Vector DB Integration
  - No Pinecone/Weaviate connection
  - No metadata schema for vector DB
  - No embedding storage (if using pgvector)

**What's Needed:**

1. **Migration: Add FTS Support**
   ```sql
   -- Create GIN indexes for full-text search
   CREATE INDEX message_content_fts_gin 
   ON "Message" USING gin(to_tsvector('english', content));
   
   CREATE INDEX conversation_title_fts_gin 
   ON "Conversation" USING gin(to_tsvector('english', title));
   
   -- Add workspace-scoped FTS index
   CREATE INDEX message_workspace_fts_idx 
   ON "Message"(workspace_id, to_tsvector('english', content)) 
   WHERE deleted_at IS NULL;
   ```

2. **Schema Additions** (Prisma)
   ```prisma
   model MessageChunk {
     id String @id
     messageId String
     content String
     startTokenOffset Int
     endTokenOffset Int
     vectorId String?  // Pinecone/Weaviate reference
     embedding Float[] @db.Vector(1536)  // If using pgvector
     createdAt DateTime
     @@index([messageId])
   }
   
   model SearchMetadata {
     id String @id
     conversationId String @unique
     tags String[]
     entities Json?
     viewCount Int
     clickCount Int
     updatedAt DateTime @updatedAt
   }
   
   model SavedSearch {
     id String @id
     workspaceId String
     userId String
     name String
     query String
     filters Json?
     createdAt DateTime
   }
   
   model SearchLog {
     id String @id
     workspaceId String
     userId String
     query String
     resultsCount Int
     clickedResult String?
     createdAt DateTime
   }
   ```

3. **Vector DB Setup**
   - Pinecone index creation (programmatic or CLI)
   - Metadata schema configuration
   - Rate limiting setup (if using embeddings API)

**Effort:** 1-2 days (migrations + configuration)

**Blocking Status:** 🟡 Partial blocker
- FTS indexing can proceed without Pinecone (FTS-only search first)
- Pinecone setup must be done before vector search feature
- Recommend: implement FTS first, add vector later

---

## Dependency Chain Analysis

```
M4 Search (blocked)
├─ Conversation System ✅
├─ Message System ✅
├─ Permissions ✅
├─ Workspace Isolation ✅
├─ Bull Queue ❌ CRITICAL BLOCKER
│  ├─ Message indexing job
│  ├─ Embedding computation job
│  └─ Index rebuild job
├─ Vector DB Integration ❌ CRITICAL BLOCKER
│  ├─ Pinecone account & index
│  ├─ Embedding service abstraction
│  └─ Vector DB metadata schema
├─ Embedding Service ❌ CRITICAL BLOCKER
│  ├─ OpenAI text-embedding-3-small
│  ├─ Rate limiting
│  └─ Batching
├─ PostgreSQL FTS 🟡 PARTIAL
│  ├─ GIN indexes needed
│  └─ Workspace-scoped FTS indexes needed
├─ Observability 🟡 PARTIAL
│  ├─ Logging ✅
│  └─ Metrics ❌
└─ Documentation ✅
```

---

## Remediation Plan

### Phase 1: Critical Path (Must Complete Before M4)
**Duration:** 3-4 days  
**Effort:** 15-20 developer-hours

#### 1.1 Bull Queue Setup (1 day)
- [ ] Add bullmq + redis dependencies
- [ ] Create queue factory with connection pooling
- [ ] Implement job definitions (search-indexing, embeddings, reindex)
- [ ] Create worker registry and lifecycle manager
- [ ] Test job enqueue, process, retry logic
- [ ] Document queue architecture

#### 1.2 Embedding Service Abstraction (1 day)
- [ ] Design IEmbeddingProvider interface
- [ ] Implement OpenAI text-embedding-3-small provider
- [ ] Add rate limiter middleware
- [ ] Add batching logic (20 messages/request)
- [ ] Add caching layer (Redis, keyed by content hash)
- [ ] Write tests and cost calculator
- [ ] Document pricing and usage

#### 1.3 Vector DB Abstraction (1 day)
- [ ] Design IVectorDB interface
- [ ] Implement Pinecone provider
- [ ] Add metadata filtering
- [ ] Add batch upsert operations
- [ ] Write error handling and retry logic
- [ ] Test with Pinecone serverless index
- [ ] Document setup instructions

#### 1.4 Database Migrations (0.5 day)
- [ ] Create migration: add FTS GIN indexes
- [ ] Create migration: add SearchMetadata, SavedSearch, SearchLog models
- [ ] Update Prisma schema
- [ ] Test migrations in docker-compose
- [ ] Document index strategy

**Exit Criteria:**
- ✅ Bull Queue processes jobs successfully
- ✅ Embedding service produces vectors
- ✅ Vector DB accepts inserts with metadata
- ✅ FTS indexes created and queryable
- ✅ All tests pass

---

### Phase 2: Observability Enhancements (Parallel, Not Blocking)
**Duration:** 1-2 days  
**Effort:** 5-10 developer-hours

#### 2.1 Metrics Export
- [ ] Add Prometheus client
- [ ] Create metrics endpoint (/metrics)
- [ ] Instrument search queries (latency histogram)
- [ ] Instrument job processing (duration, error count)
- [ ] Add cache hit/miss rates

#### 2.2 Request Correlation
- [ ] Add correlation ID middleware
- [ ] Propagate through async jobs
- [ ] Include in all logs
- [ ] Document for debugging

**Can Run In Parallel With M4 Implementation**

---

## Risk Assessment

### High Risk: Bull Queue Absence
- **Impact:** Cannot implement async indexing → entire M4 feature blocked
- **Likelihood:** Code shows references to Bull in comments but no actual implementation
- **Mitigation:** Implement immediately, test with existing generateResponse.worker.ts

### High Risk: Embedding Service Unavailable
- **Impact:** No vector search feature → FTS-only search
- **Likelihood:** No embedding provider in codebase
- **Mitigation:** Implement OpenAI provider as default, make pluggable

### High Risk: Vector DB Not Configured
- **Impact:** Cannot do vector search
- **Likelihood:** No Pinecone/Weaviate code present
- **Mitigation:** Create abstraction early, can swap providers later

### Medium Risk: FTS Indexes Missing
- **Impact:** Full-text search performance degraded
- **Likelihood:** Schema exists but indexes not created
- **Mitigation:** Create migration, test on sample data (100K+ messages)

### Low Risk: Observability Gaps
- **Impact:** Cannot monitor search performance
- **Likelihood:** Logging works but metrics missing
- **Mitigation:** Add async, doesn't block M4 feature

---

## Recommendation

**DO NOT PROCEED WITH M4 IMPLEMENTATION UNTIL:**

1. ✅ Bull Queue system is implemented and tested
2. ✅ Embedding service abstraction is working
3. ✅ Vector DB integration is configured
4. ✅ Database migrations for FTS indexes are applied

**Timeline:** 3-4 days to unblock M4

**Suggested Approach:**
1. Implement Bull Queue + job system (1 day)
2. Implement Embedding service (1 day, parallel)
3. Implement Vector DB abstraction (1 day, parallel)
4. Apply database migrations (0.5 day)
5. Run integration tests (0.5 day)
6. Then proceed to M4 implementation

**Effort Estimate:** 
- Remediation: 15-20 hours (3-4 days)
- M4 Implementation: 40-50 hours (1-2 weeks)
- Total: 55-70 hours (1.5-2.5 weeks)

---

## Conclusion

**Status: 🛑 BLOCKED FOR M4 IMPLEMENTATION**

Milestone 4 cannot proceed without addressing:
- Bull Queue system (CRITICAL)
- Embedding service (CRITICAL)
- Vector DB integration (CRITICAL)
- FTS database setup (HIGH)

All conversation, streaming, permissions, and provider infrastructure is complete and production-ready. Only the search-specific dependencies are missing.

**Next Action:** Execute Phase 1 remediation plan (3-4 days), then proceed to M4 implementation.

