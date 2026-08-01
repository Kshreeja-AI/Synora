# Conversation Engine Specification

**Version:** 1.0  
**Status:** Complete, ready for implementation  
**Last Updated:** 2026-07-28  
**Owner:** Architecture Team

---

## Overview

The Conversation Engine manages the conversation lifecycle: creation, retrieval, modification, archival, and deletion. A conversation is a workspace-scoped container for messages, with metadata (title, description, project, folder), ownership, sharing rules, and usage tracking.

**Key Principles:**
- Workspace isolation (every conversation belongs to exactly one workspace)
- Soft deletion (archival, retention policy)
- Immutable creation metadata (who created, when)
- Last message timestamp for sorting/indexing

---

## Database

### Schema

```prisma
model Conversation {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  // Metadata
  title String @default("Untitled Conversation")
  description String?
  
  // Ownership
  createdBy String
  createdByUser User @relation(name: "CreatedConversations", fields: [createdBy], references: [id])
  
  // Organization
  projectId String?
  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  folderId String?
  folder ConversationFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)
  
  // Status
  isArchived Boolean @default(false)
  archivedAt DateTime?
  isDeleted Boolean @default(false)
  deletedAt DateTime?
  
  // Timestamps
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lastMessageAt DateTime?
  
  // Relations
  messages Message[] @relation("ConversationMessages")
  branches MessageBranch[] @relation("ConversationBranches")
  usage ConversationUsage?
  sharedWith SharedConversation[] @relation("SharedConversations")
  files ConversationFile[]
  tools ToolExecution[]
  
  // Indices
  @@index([workspaceId, createdAt])
  @@index([workspaceId, isArchived, deletedAt])
  @@index([projectId])
  @@index([folderId])
  @@index([createdBy])
  @@index([lastMessageAt])
  @@unique([id, workspaceId]) // Enforce workspace isolation
}

model ConversationFolder {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  name String
  description String?
  
  parentId String?
  parent ConversationFolder? @relation(name: "FolderHierarchy", fields: [parentId], references: [id], onDelete: Cascade)
  children ConversationFolder[] @relation(name: "FolderHierarchy")
  
  conversations Conversation[] @relation("ConversationInFolder")
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([workspaceId])
  @@index([parentId])
  @@unique([workspaceId, name, parentId])
}
```

### Indices

| Index | Columns | Purpose |
|-------|---------|---------|
| Primary | workspaceId, createdAt | List conversations (active) |
| Filter | workspaceId, isArchived, deletedAt | Filter archived/deleted |
| Hierarchy | projectId, folderId | Organize conversations |
| Owner | createdBy | User's conversations |
| Recent | lastMessageAt | Sort by recency |
| Isolation | (id, workspaceId) | Enforce workspace scope |

---

## API

### Create Conversation

```
POST /api/workspaces/:workspaceId/conversations
Authorization: Bearer <jwt>
Content-Type: application/json

Request:
{
  "title": "Product Feature Discussion",
  "description": "Brainstorming session with team",
  "projectId": "proj_123",  // optional
  "folderId": "fold_456"    // optional
}

Response 201:
{
  "success": true,
  "data": {
    "id": "conv_abc123",
    "workspaceId": "ws_123",
    "title": "Product Feature Discussion",
    "description": "Brainstorming session with team",
    "createdBy": "user_123",
    "projectId": "proj_123",
    "folderId": "fold_456",
    "isArchived": false,
    "createdAt": "2026-07-28T12:00:00Z",
    "updatedAt": "2026-07-28T12:00:00Z",
    "lastMessageAt": null
  }
}

Errors:
- 401: Unauthorized (missing JWT)
- 403: Forbidden (not workspace member)
- 404: Workspace not found
- 400: Invalid title length (1-200 chars)
```

### List Conversations

```
GET /api/workspaces/:workspaceId/conversations
  ?skip=0&take=20&archived=false&search=feature&sortBy=recent
Authorization: Bearer <jwt>

Query Parameters:
  skip: number (default 0)
  take: number (default 20, max 100)
  archived: boolean (default false, show active only)
  search: string (optional, searches title + description)
  sortBy: "recent" | "oldest" | "title" (default "recent")
  projectId: string (optional, filter by project)
  folderId: string (optional, filter by folder)

Response 200:
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "conv_abc123",
        "title": "Product Feature Discussion",
        "description": "Brainstorming session...",
        "createdBy": "user_123",
        "isArchived": false,
        "createdAt": "2026-07-28T12:00:00Z",
        "lastMessageAt": "2026-07-28T13:45:00Z"
      }
    ],
    "total": 42,
    "hasMore": true
  }
}

Errors:
- 401: Unauthorized
- 403: Forbidden (not workspace member)
```

### Get Conversation

```
GET /api/workspaces/:workspaceId/conversations/:conversationId
Authorization: Bearer <jwt>

Response 200:
{
  "success": true,
  "data": {
    "id": "conv_abc123",
    "workspaceId": "ws_123",
    "title": "Product Feature Discussion",
    "description": "Brainstorming session with team",
    "createdBy": "user_123",
    "createdByUser": {
      "id": "user_123",
      "name": "Alice",
      "email": "alice@example.com",
      "avatar": "https://..."
    },
    "projectId": "proj_123",
    "folderId": "fold_456",
    "isArchived": false,
    "createdAt": "2026-07-28T12:00:00Z",
    "updatedAt": "2026-07-28T12:00:00Z",
    "lastMessageAt": "2026-07-28T13:45:00Z",
    "messageCount": 12
  }
}

Errors:
- 401: Unauthorized
- 404: Conversation not found or not accessible
```

### Update Conversation

```
PATCH /api/workspaces/:workspaceId/conversations/:conversationId
Authorization: Bearer <jwt>
Content-Type: application/json

Request:
{
  "title": "Updated title",
  "description": "Updated description",
  "projectId": "proj_789",
  "folderId": "fold_999"
}

Response 200:
{
  "success": true,
  "data": { /* updated conversation */ }
}

Errors:
- 401: Unauthorized
- 403: Forbidden (not owner or admin)
- 404: Conversation not found
```

### Archive Conversation

```
PATCH /api/workspaces/:workspaceId/conversations/:conversationId/archive
Authorization: Bearer <jwt>

Request:
{
  "isArchived": true
}

Response 200:
{
  "success": true,
  "data": {
    "id": "conv_abc123",
    "isArchived": true,
    "archivedAt": "2026-07-28T14:00:00Z"
  }
}

Errors:
- 401: Unauthorized
- 403: Forbidden
- 404: Not found
```

### Delete Conversation

```
DELETE /api/workspaces/:workspaceId/conversations/:conversationId
Authorization: Bearer <jwt>

Response 200:
{
  "success": true,
  "data": { "id": "conv_abc123", "isDeleted": true }
}

Note: Soft delete. Hard delete happens 30 days after deletedAt.

Errors:
- 401: Unauthorized
- 403: Forbidden (not owner or admin)
- 404: Not found
```

---

## Service Layer

### ConversationService

```typescript
class ConversationService {
  async createConversation(
    userId: string,
    workspaceId: string,
    input: CreateConversationInput
  ): Promise<Conversation>

  async listConversations(
    userId: string,
    workspaceId: string,
    filters: ListConversationsFilters,
    pagination: { skip: number; take: number }
  ): Promise<{ items: Conversation[]; total: number }>

  async getConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation>

  async updateConversation(
    userId: string,
    conversationId: string,
    input: UpdateConversationInput
  ): Promise<Conversation>

  async archiveConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation>

  async deleteConversation(
    userId: string,
    conversationId: string
  ): Promise<void>

  async getConversationWithMessages(
    userId: string,
    conversationId: string
  ): Promise<Conversation & { messages: Message[] }>
}
```

### Key Implementation Details

1. **Access Control**: Every method validates user workspace membership
2. **Audit Logging**: Every mutation logged to ActivityLog
3. **Cache Invalidation**: Cascading invalidation on writes
4. **Soft Deletion**: Soft delete on delete, hard delete after 30 days
5. **Last Message Tracking**: Updated whenever message added/deleted

---

## Interfaces

```typescript
// Input types
interface CreateConversationInput {
  title?: string;
  description?: string;
  projectId?: string;
  folderId?: string;
}

interface UpdateConversationInput {
  title?: string;
  description?: string;
  projectId?: string | null;
  folderId?: string | null;
}

interface ListConversationsFilters {
  archived?: boolean;
  search?: string;
  projectId?: string;
  folderId?: string;
  sortBy?: 'recent' | 'oldest' | 'title';
}

// Output type
interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  createdBy: string;
  projectId?: string;
  folderId?: string;
  isArchived: boolean;
  archivedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date;
}
```

---

## Validation

**Input Validation (Zod Schema):**

```typescript
const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  projectId: z.string().cuid().optional(),
  folderId: z.string().cuid().optional(),
});

const UpdateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  projectId: z.string().cuid().nullable().optional(),
  folderId: z.string().cuid().nullable().optional(),
});
```

**Business Rules:**
- Title required (default to "Untitled Conversation" if missing)
- Title length 1-200 characters
- Description max 1000 characters
- Project must belong to workspace
- Folder must belong to workspace
- Cannot update archived conversation (must unarchive first)

---

## Permissions

| Role | Create | Read | Update Own | Update Others | Archive | Delete |
|------|--------|------|-----------|--------------|---------|--------|
| Creator | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Workspace ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Workspace EDITOR | ✓ | ✓ | ✓ (own) | — | ✓ (own) | ✓ (own) |
| Workspace MEMBER | ✓ | ✓ | ✓ (own) | — | — | — |
| Workspace VIEWER | — | ✓ | — | — | — | — |

---

## Failure Handling

| Error | Status | Code | Cause | Recovery |
|-------|--------|------|-------|----------|
| Conversation not found | 404 | CONVERSATION_NOT_FOUND | Wrong ID or access denied | Verify ID, check workspace membership |
| Not workspace member | 403 | FORBIDDEN | User not in workspace | Add to workspace |
| Invalid input | 400 | VALIDATION_ERROR | Title too long, invalid IDs | Fix input, retry |
| Concurrent update | 409 | CONFLICT | Two users update simultaneously | Reload, retry |
| Database error | 500 | INTERNAL_ERROR | Connection lost, disk full | Retry with backoff |

**Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "CONVERSATION_NOT_FOUND",
    "message": "Conversation not found or access denied",
    "details": {
      "conversationId": "conv_abc123",
      "workspaceId": "ws_123"
    },
    "requestId": "req_xyz789"
  }
}
```

---

## Retry Strategy

| Operation | Idempotent | Max Retries | Backoff |
|-----------|-----------|-------------|---------|
| Create | No (use idempotency key) | 3 | Exponential (1s, 2s, 4s) |
| Read | Yes | 3 | Exponential |
| Update | No (uses timestamps) | 3 | Exponential |
| Delete | Yes (idempotent on ID) | 3 | Exponential |

**Idempotency:**
- Create: Include `idempotencyKey` in request headers; return cached result if duplicate
- Update: Use `updatedAt` timestamp; reject if stale
- Delete: Safe to retry (soft delete is idempotent)

---

## Logging

**Structured Log Format:**

```json
{
  "timestamp": "2026-07-28T12:00:00Z",
  "level": "INFO",
  "service": "conversation-service",
  "action": "conversation_created",
  "userId": "user_123",
  "workspaceId": "ws_123",
  "conversationId": "conv_abc123",
  "duration_ms": 45,
  "requestId": "req_xyz789"
}
```

**Log Levels:**
- INFO: Create, update, archive, delete
- WARN: Access denied, validation error
- ERROR: Database error, timeout
- DEBUG: Cache hit/miss, permission check

**Fields:**
- timestamp: ISO 8601
- level: INFO/WARN/ERROR/DEBUG
- service: "conversation-service"
- action: conversation_created, conversation_updated, etc.
- userId: actor
- workspaceId: workspace
- conversationId: resource
- duration_ms: latency
- requestId: correlation ID (from JWT or header)

---

## Monitoring

**Metrics (Prometheus):**

```
conversation_created_total{workspace_id,user_id} # Counter
conversation_updated_total{workspace_id}         # Counter
conversation_deleted_total{workspace_id}         # Counter
conversation_list_duration_ms{workspace_id}      # Histogram
conversation_access_denied_total{workspace_id}   # Counter
conversation_count{workspace_id}                 # Gauge (total active)
conversation_archived_count{workspace_id}        # Gauge
```

**Alerts:**
- Access denied rate > 1% of requests → potential security issue
- Create latency P99 > 500ms → database slow
- List latency P99 > 2s → index issue or N+1 query

**SLOs:**
- Create: P99 < 200ms, P95 < 100ms
- List (20 items): P99 < 500ms, P95 < 300ms
- Get: P99 < 100ms, P95 < 50ms
- Availability: 99.99%

---

## Testing

### Unit Tests

```typescript
describe('ConversationService', () => {
  it('should create conversation with metadata', () => {
    const result = service.createConversation(userId, workspaceId, {
      title: 'Test',
      projectId: 'proj_123'
    });
    expect(result.id).toBeDefined();
    expect(result.createdBy).toBe(userId);
  });

  it('should reject non-members', () => {
    expect(() =>
      service.createConversation(unknownUserId, workspaceId, {})
    ).toThrow('Forbidden');
  });

  it('should list conversations with filters', () => {
    const results = service.listConversations(userId, workspaceId, {
      archived: false,
      projectId: 'proj_123'
    }, { skip: 0, take: 20 });
    expect(results.items.length).toBeLessThanOrEqual(20);
  });

  it('should soft delete conversation', () => {
    const deleted = service.deleteConversation(userId, conversationId);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).toBeDefined();
  });
});
```

### Integration Tests

```typescript
describe('Conversation API', () => {
  it('should create and retrieve conversation', async () => {
    const createRes = await request(app)
      .post(`/api/workspaces/${workspaceId}/conversations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Conversation' })
      .expect(201);

    const getRes = await request(app)
      .get(`/api/workspaces/${workspaceId}/conversations/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.data.title).toBe('Test Conversation');
  });

  it('should list conversations with pagination', async () => {
    const res = await request(app)
      .get(`/api/workspaces/${workspaceId}/conversations?skip=0&take=10`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.items.length).toBeLessThanOrEqual(10);
    expect(res.body.data.total).toBeGreaterThanOrEqual(0);
  });

  it('should return 404 for non-existent conversation', async () => {
    await request(app)
      .get(`/api/workspaces/${workspaceId}/conversations/unknown`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
```

### E2E Tests (Playwright)

```typescript
test('User creates conversation and sees it in list', async ({ page }) => {
  await page.goto('/app/conversations');
  await page.click('button:has-text("New Conversation")');
  await page.fill('input[name="title"]', 'E2E Test Conversation');
  await page.click('button:has-text("Create")');

  await expect(page.locator('text=E2E Test Conversation')).toBeVisible();
});
```

---

## Performance

**Optimization Strategies:**
1. **Indices**: All filter queries use indices (workspaceId, createdAt)
2. **Pagination**: Always paginate lists (max 100 items)
3. **Caching**: Cache frequent queries (user's conversation list, 5 min TTL)
4. **Denormalization**: messageCount stored in DB, not computed
5. **Lazy Loading**: Don't fetch messages with conversation

**Latency Targets:**
- Create: < 200ms P99
- Get: < 100ms P99
- List (20 items): < 500ms P99
- Update: < 200ms P99
- Delete: < 200ms P99

---

## Security

**Authentication:**
- All endpoints require JWT bearer token
- Token verified before workspace check

**Authorization:**
- Workspace membership required
- Role-based permissions (creator, admin, editor, member, viewer)
- Conversation owner can delete

**Input Validation:**
- Zod schemas on all inputs
- Title length 1-200 characters
- No code execution in description

**Data Protection:**
- HTTPS enforced in production
- Sensitive fields not logged (conversation content not logged)
- Soft delete retains data for 30 days (compliance)

---

## Scalability

**Horizontal Scaling:**
- Conversations sharded by workspaceId (future)
- Read replicas for list queries
- Connection pooling (20 connections per instance)

**Bottlenecks:**
- Database: Index on (workspaceId, createdAt) essential
- Cache: Redis for list queries
- N+1: Use select() to fetch only needed fields

**Scale Limits:**
- 1M conversations per workspace → consider archival strategy
- 10K concurrent users → load balance backend instances

---

## Future Extensibility

**Extension Points:**
1. **Custom fields**: Add workspace-specific metadata
2. **Webhooks**: Emit on create/update/delete
3. **Export**: CSV/Excel export of conversation list
4. **Bulk operations**: Archive/delete multiple conversations
5. **Folders**: Hierarchical organization (already in schema)
6. **Pinning**: Pin favorite conversations to top

**Version 2.0 Considerations:**
- Conversation cloning (template from existing)
- Conversation merging (combine multiple threads)
- Conversation forking (create variant)
- Time-travel restore (revert to snapshot)

---

**Specification Version:** 1.0  
**Created:** 2026-07-28  
**Last Updated:** 2026-07-28  
**Status:** Complete and ready for implementation
