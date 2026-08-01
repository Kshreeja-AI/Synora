# Message Engine Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

---

## Overview

The Message Engine manages message lifecycle within conversations: creation, retrieval, editing, deletion, and thread reconstruction. Messages are immutable once complete, with role-based visibility (user, assistant, system), status tracking (pending, streaming, complete, error), and token accounting.

---

## Database

```prisma
model Message {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(name: "ConversationMessages", fields: [conversationId], references: [id], onDelete: Cascade)
  
  content String
  role MessageRole // USER, ASSISTANT, SYSTEM
  
  providerId String? // e.g., "anthropic", "openai"
  model String? // e.g., "claude-opus", "gpt-4"
  
  parentId String? // For threading
  parent Message? @relation(name: "MessageParent", fields: [parentId], references: [id], onDelete: Cascade)
  children Message[] @relation(name: "MessageParent")
  
  branchId String? // Which branch this message belongs to
  branch MessageBranch? @relation(name: "BranchMessages", fields: [branchId], references: [id], onDelete: Cascade)
  
  status MessageStatus // PENDING, STREAMING, COMPLETE, ERROR
  errorMessage String?
  
  inputTokens Int @default(0)
  outputTokens Int @default(0)
  
  createdAt DateTime @default(now())
  completedAt DateTime?
  
  @@index([conversationId, createdAt])
  @@index([parentId])
  @@index([branchId])
  @@index([role])
  @@index([status])
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}

enum MessageStatus {
  PENDING      // Waiting to stream
  STREAMING    // Currently streaming tokens
  COMPLETE     // Stream complete
  ERROR        // Generation failed
}
```

---

## API

### Create Message

```
POST /api/workspaces/:workspaceId/conversations/:conversationId/messages
Authorization: Bearer <jwt>

Request:
{
  "content": "What are the top 3 features our users want?",
  "role": "USER",
  "parentId": "msg_abc"  // optional, for threading
}

Response 201:
{
  "success": true,
  "data": {
    "id": "msg_001",
    "conversationId": "conv_123",
    "content": "What are the top 3 features...",
    "role": "USER",
    "parentId": null,
    "status": "COMPLETE",
    "inputTokens": 0,
    "outputTokens": 0,
    "createdAt": "2026-07-28T12:00:00Z"
  }
}

Side Effects:
- If role=USER: spawn background job 'generate_response'
- Update conversation.lastMessageAt
- Invalidate message cache
```

### List Messages

```
GET /api/workspaces/:workspaceId/conversations/:conversationId/messages
  ?skip=0&take=50&parentId=msg_abc
Authorization: Bearer <jwt>

Response 200:
{
  "success": true,
  "data": {
    "items": [
      { "id": "msg_001", "content": "...", "role": "USER", ... },
      { "id": "msg_002", "content": "...", "role": "ASSISTANT", ... }
    ],
    "total": 12,
    "hasMore": false
  }
}
```

### Get Message

```
GET /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId
Authorization: Bearer <jwt>

Response 200:
{
  "success": true,
  "data": {
    "id": "msg_002",
    "conversationId": "conv_123",
    "content": "Based on user feedback, the top 3 features are...",
    "role": "ASSISTANT",
    "model": "claude-opus",
    "status": "COMPLETE",
    "inputTokens": 150,
    "outputTokens": 250,
    "createdAt": "2026-07-28T12:05:00Z",
    "completedAt": "2026-07-28T12:05:45Z"
  }
}
```

### Edit Message

```
PATCH /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId
Authorization: Bearer <jwt>

Request:
{
  "content": "Updated content"
}

Response 200:
{
  "success": true,
  "data": { /* updated message */ }
}

Side Effects:
- Create new version in MessageVersion table
- If edited by non-creator, log in audit trail
- Trigger re-generation of child messages
```

### Delete Message

```
DELETE /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId
Authorization: Bearer <jwt>

Response 200:
{
  "success": true,
  "data": { "id": "msg_001", "deleted": true }
}

Side Effects:
- Soft delete (future hard delete after 30 days)
- Orphan child messages (set parentId = null)
```

---

## Service Layer

```typescript
class MessageService {
  async createMessage(
    userId: string,
    conversationId: string,
    input: CreateMessageInput
  ): Promise<Message>

  async listMessages(
    userId: string,
    conversationId: string,
    pagination: { skip: number; take: number },
    filters?: { parentId?: string; branchId?: string }
  ): Promise<{ items: Message[]; total: number }>

  async getMessage(
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<Message>

  async editMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    input: EditMessageInput
  ): Promise<Message>

  async deleteMessage(
    userId: string,
    conversationId: string,
    messageId: string
  ): Promise<void>

  async buildPromptContext(
    conversationId: string,
    maxTokens?: number
  ): Promise<Message[]>

  async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    errorMessage?: string
  ): Promise<void>
}
```

**Key Implementation:**

- Create: Validate role, spawn job if USER role
- Edit: Only creator can edit; create version record; trigger regeneration of children
- Delete: Soft delete; orphan children; update parent's token counts
- buildPromptContext: Window messages by token budget; exclude deleted

---

## Interfaces

```typescript
interface CreateMessageInput {
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  parentId?: string;
}

interface EditMessageInput {
  content: string;
}

interface Message {
  id: string;
  conversationId: string;
  content: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  parentId?: string;
  branchId?: string;
  status: 'PENDING' | 'STREAMING' | 'COMPLETE' | 'ERROR';
  errorMessage?: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  completedAt?: Date;
}
```

---

## Validation

```typescript
const CreateMessageSchema = z.object({
  content: z.string().min(1).max(50000),
  role: z.enum(['USER', 'ASSISTANT', 'SYSTEM']),
  parentId: z.string().cuid().optional(),
});

const EditMessageSchema = z.object({
  content: z.string().min(1).max(50000),
});
```

**Rules:**
- Content required, 1-50,000 characters
- Role must be valid enum
- Parent message must exist in same conversation
- Only user can edit own messages
- Cannot edit assistant messages (regenerate instead)

---

## Permissions

| Action | Owner | Creator | Admin | Editor | Viewer |
|--------|-------|---------|-------|--------|--------|
| Create | ✓ | ✓ | ✓ | ✓ | — |
| Read | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit Own | ✓ | ✓ | ✓ | ✓ | — |
| Edit Others | — | — | ✓ | — | — |
| Delete | ✓ | ✓ | ✓ | ✓ | — |

---

## Failure Handling

| Error | Status | Cause | Recovery |
|-------|--------|-------|----------|
| Content too long | 400 | Content > 50K chars | Truncate, retry |
| Message not found | 404 | Wrong ID | Verify ID |
| Conversation not found | 404 | Access denied | Check access |
| Invalid parent | 400 | Parent doesn't exist | Don't use parent |
| Generation failed | 500 | AI provider error | Retry generation |
| Concurrent edit | 409 | Two users edit simultaneously | Reload, retry |

---

## Retry Strategy

| Operation | Idempotent | Retries | Backoff |
|-----------|-----------|---------|---------|
| Create | No (use key) | 3 | Exponential |
| Edit | No (timestamps) | 3 | Exponential |
| Delete | Yes | 3 | Exponential |
| Status update | Yes | 5 | Exponential |

---

## Logging

```json
{
  "timestamp": "2026-07-28T12:00:00Z",
  "action": "message_created",
  "messageId": "msg_001",
  "conversationId": "conv_123",
  "userId": "user_123",
  "role": "USER",
  "contentLength": 45,
  "duration_ms": 25,
  "requestId": "req_xyz"
}
```

---

## Monitoring

**Metrics:**
- message_created_total
- message_generation_duration_ms
- message_generation_failed_total
- message_token_count{role}
- message_status{status}

**Alerts:**
- Generation latency > 10s
- Error rate > 5%

**SLOs:**
- Create: P99 < 100ms
- List: P99 < 300ms
- Generation: P99 < 30s

---

## Testing

**Unit Tests:**
- Create message with valid role
- Edit message (only owner)
- Delete message (soft delete)
- buildPromptContext windows by tokens
- Parent/child relationship maintained

**Integration Tests:**
- Create user message → spawn generation job
- List messages with pagination
- Edit triggers version history
- Delete orphans children

---

## Performance

**Optimizations:**
1. Select only needed fields (don't fetch content in list)
2. Pagination always (max 100 per page)
3. Index on (conversationId, createdAt)
4. Cache message count

**Targets:**
- Create: < 100ms P99
- List: < 300ms P99
- Get: < 50ms P99

---

## Security

- Authentication required
- Workspace membership checked
- Only owner can edit
- Content max 50K chars
- No code execution

---

## Scalability

- Sharding by conversationId (future)
- Read replicas for list queries
- Archive old conversations (> 1 year old)

---

## Future Extensibility

- Message reactions (👍, ❤️, etc.)
- Pinned messages
- Message search (implemented in M4)
- Collaborative editing (M9)
- Translation (workspace setting)

---

**Status:** Complete, ready for implementation
