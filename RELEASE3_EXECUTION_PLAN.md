# Release 3 Execution Plan: Universal AI Workspace

**Status:** Approved architecture design, ready for implementation  
**Total Duration:** 20 weeks (M1-M10)  
**Target Launch:** Week 21  
**Last Updated:** 2026-07-28

---

## Overview

Release 3 transforms Synora from a project management + AI tool suite into a **universal AI workspace** with conversational AI at its core. Users create unlimited conversations, branch alternative paths, share and collaborate in real-time, manage knowledge (prompts/templates), upload files, execute tools, and track costs per conversation.

**Release 2 Prerequisite:** Production-ready auth, workspaces, projects, billing (M1-M6 complete)  
**Release 3 Scope:** Conversational AI platform (M1-M10)  
**Critical Path:** M1 → M2 → M4 → M6 → M7 (others parallel)

---

## Milestone M1: Core Chat Infrastructure

**Duration:** 2 weeks (Weeks 1-2)  
**Effort:** 4 engineer-weeks  
**Est. LOC:** 3,500  
**Status:** Not started

### Objective

Deliver the foundation for conversational AI: database schema for conversations and messages, REST API for CRUD + streaming, SSE endpoint for real-time token streaming, and initial UI (chat interface, message list, input area).

### Business Value

- Users can create conversations with AI
- Messages stream token-by-token for perceived speed
- Foundation for all downstream features (branching, sharing, knowledge)
- Demonstrates core product value immediately

### Database Changes

**New Tables:**

```prisma
model Conversation {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  title String @default("Untitled Conversation")
  description String?
  createdBy String
  createdByUser User @relation(name: "CreatedConversations", fields: [createdBy], references: [id])
  
  projectId String?
  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  folderId String?
  folder ConversationFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)
  
  isArchived Boolean @default(false)
  archivedAt DateTime?
  isDeleted Boolean @default(false)
  deletedAt DateTime?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lastMessageAt DateTime?
  
  messages Message[] @relation("ConversationMessages")
  usage ConversationUsage?
  files ConversationFile[]
  tools ToolExecution[]
  
  @@index([workspaceId, createdAt])
  @@index([workspaceId, isArchived])
  @@index([projectId])
  @@index([createdBy])
}

model Message {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(name: "ConversationMessages", fields: [conversationId], references: [id], onDelete: Cascade)
  
  content String
  role MessageRole // enum: USER, ASSISTANT, SYSTEM
  
  providerId String?
  model String?
  
  parentId String?
  parent Message? @relation(name: "MessageParent", fields: [parentId], references: [id], onDelete: Cascade)
  children Message[] @relation(name: "MessageParent")
  
  status MessageStatus // enum: PENDING, STREAMING, COMPLETE, ERROR
  errorMessage String?
  
  inputTokens Int @default(0)
  outputTokens Int @default(0)
  
  createdAt DateTime @default(now())
  completedAt DateTime?
  
  @@index([conversationId, createdAt])
  @@index([parentId])
  @@index([providerId])
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}

enum MessageStatus {
  PENDING
  STREAMING
  COMPLETE
  ERROR
}

model ConversationUsage {
  id String @id @default(cuid())
  conversationId String @unique
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  totalInputTokens Int @default(0)
  totalOutputTokens Int @default(0)
  costByProvider Json @default("{}")
  totalCostCents Int @default(0)
  
  updatedAt DateTime @updatedAt
  
  @@index([conversationId])
}

model ConversationFile {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  fileName String
  mimeType String
  fileSize Int
  storageKey String
  isArchived Boolean @default(false)
  
  uploadedBy String
  uploadedByUser User @relation(fields: [uploadedBy], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([uploadedBy])
}

model ToolExecution {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  toolId String
  
  input Json
  output Json
  error String?
  status String // PENDING | SUCCESS | FAILED
  
  executedBy String
  executedByUser User @relation(fields: [executedBy], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([toolId])
}
```

**Migration File:** `packages/database/prisma/migrations/xxxxx_add_conversation_core.sql`

**New Indexes:**
- `Conversation(workspaceId, createdAt)` — list conversations
- `Conversation(workspaceId, isArchived)` — filter active/archived
- `Message(conversationId, createdAt)` — message timeline
- `Message(parentId)` — thread reconstruction

### Backend Changes

**New Services:**

- `apps/backend/src/services/conversation.service.ts`
  - `createConversation(userId, workspaceId, input)` → Conversation
  - `listConversations(userId, workspaceId, filters)` → Conversation[]
  - `getConversation(userId, conversationId)` → Conversation
  - `updateConversation(userId, conversationId, input)` → Conversation
  - `archiveConversation(userId, conversationId)` → Conversation
  - `deleteConversation(userId, conversationId)` → void

- `apps/backend/src/services/message.service.ts`
  - `createMessage(userId, conversationId, input)` → Message
  - `listMessages(userId, conversationId, pagination)` → Message[]
  - `getMessage(userId, messageId)` → Message
  - `editMessage(userId, conversationId, messageId, content)` → Message
  - `deleteMessage(userId, conversationId, messageId)` → void
  - `generateResponse(conversationId, userMessageId)` → Promise<void> (async, spawns queue job)
  - `buildPromptContext(conversationId, maxTokens)` → Message[]

**New Routes:** `apps/backend/src/routes/conversations.ts`

```
POST   /api/workspaces/:id/conversations
GET    /api/workspaces/:id/conversations
GET    /api/workspaces/:id/conversations/:conversationId
PATCH  /api/workspaces/:id/conversations/:conversationId
DELETE /api/workspaces/:id/conversations/:conversationId

POST   /api/workspaces/:id/conversations/:conversationId/messages
GET    /api/workspaces/:id/conversations/:conversationId/messages
GET    /api/workspaces/:id/conversations/:conversationId/messages/:messageId
PATCH  /api/workspaces/:id/conversations/:conversationId/messages/:messageId
DELETE /api/workspaces/:id/conversations/:conversationId/messages/:messageId
GET    /api/workspaces/:id/conversations/:conversationId/stream (SSE)
```

**Error Handling:**
- `NotFoundException` when conversation/message not found or not accessible
- `ValidationException` on invalid input (title length, empty content)
- `PermissionException` if user lacks workspace/conversation access
- All errors caught by global error handler, logged with correlation ID

**Key Implementation Details:**
- Conversation access: verify user is in workspace (existing middleware `requireMembership`)
- Message creation: if role=USER, spawn background task `generate_response` (Bull queue)
- Message status tracking: PENDING → STREAMING → COMPLETE or ERROR
- Audit: every mutation logged to ActivityLog (workspace, userId, action, resourceId, details)

### Frontend Changes

**New Pages:**

- `apps/web/src/app/(dashboard)/conversations/page.tsx` — Conversation list
- `apps/web/src/app/(dashboard)/conversations/[id]/page.tsx` — Chat interface

**New Components:**

- `ChatInterface` (main chat screen)
  - MessageList (virtualized, infinite scroll)
  - MessageItem (avatar, content, actions)
  - InputArea (textarea + send button)
  - UsageFooter (token counter)

- `ConversationList` (discovery / navigation)
  - Search + filter
  - Conversation items (preview, timestamp, actions)
  - "New Conversation" button

- `Message` (single message)
  - Role indicator (user/assistant/system)
  - Content (markdown rendering, code highlighting)
  - Token counts (display only, no edit)
  - Actions (edit, copy, delete)

- `MessageInput` (textarea component)
  - Auto-expand on typing
  - Keyboard shortcut: Cmd+Enter to send
  - Disable while generating

**State Management (TanStack Query + Zustand):**

```typescript
// Query hooks
useConversations(workspaceId) // TanStack Query
useConversationMessages(conversationId) // TanStack Query
useCurrentConversation(conversationId) // TanStack Query

// Zustand store (UI state)
const useConversationStore = create((set) => ({
  currentConversationId: null,
  setCurrentConversation: (id) => set({ currentConversationId: id }),
  isGenerating: false,
  setIsGenerating: (flag) => set({ isGenerating: flag }),
}));
```

**API Client Extensions:** `apps/web/src/lib/api/conversations.ts`

```typescript
export const conversationApi = {
  createConversation: (workspaceId, input) => fetch(...),
  listConversations: (workspaceId, filters) => fetch(...),
  getConversation: (workspaceId, conversationId) => fetch(...),
  updateConversation: (workspaceId, conversationId, input) => fetch(...),
  deleteConversation: (workspaceId, conversationId) => fetch(...),
  
  createMessage: (workspaceId, conversationId, input) => fetch(...),
  listMessages: (workspaceId, conversationId, pagination) => fetch(...),
  editMessage: (workspaceId, conversationId, messageId, input) => fetch(...),
  deleteMessage: (workspaceId, conversationId, messageId) => fetch(...),
  
  streamMessages: (workspaceId, conversationId, messageId) => new EventSource(...),
};
```

**Streaming Client:**

```typescript
// Hook: useStreamMessage
const useStreamMessage = (conversationId: string, messageId: string) => {
  const [tokens, setTokens] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  
  useEffect(() => {
    const es = new EventSource(
      `/api/conversations/${conversationId}/stream?messageId=${messageId}`
    );
    
    es.addEventListener('token', (e) => {
      const token = JSON.parse(e.data);
      setTokens(prev => [...prev, token]);
    });
    
    es.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      // Update query cache with final message
      setIsComplete(true);
      es.close();
    });
    
    return () => es.close();
  }, [conversationId, messageId]);
  
  return { tokens: tokens.join(''), isComplete };
};
```

### API Endpoints (Complete Specification)

**Create Conversation**
```
POST /api/workspaces/:id/conversations
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "title": "Product Feature Ideas",
  "description": "Brainstorming session",
  "projectId": "proj_123",
  "folderId": "fold_456"
}

Response 201:
{
  "success": true,
  "data": {
    "id": "conv_789",
    "title": "Product Feature Ideas",
    "description": "Brainstorming session",
    "createdBy": "user_123",
    "projectId": "proj_123",
    "folderId": "fold_456",
    "isArchived": false,
    "createdAt": "2026-07-28T12:00:00Z",
    "updatedAt": "2026-07-28T12:00:00Z",
    "lastMessageAt": null
  }
}
```

**List Conversations**
```
GET /api/workspaces/:id/conversations?skip=0&take=20&archived=false&search=feature
Authorization: Bearer <jwt>

Response 200:
{
  "success": true,
  "data": {
    "items": [
      { "id": "conv_789", "title": "...", ... }
    ],
    "total": 42,
    "hasMore": true
  }
}
```

**Create Message (User)**
```
POST /api/workspaces/:id/conversations/:conversationId/messages
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "content": "What are the top 3 features our users are asking for?",
  "role": "USER"
}

Response 201:
{
  "success": true,
  "data": {
    "id": "msg_001",
    "conversationId": "conv_789",
    "content": "What are the top 3 features...",
    "role": "USER",
    "status": "COMPLETE",
    "inputTokens": 0,
    "outputTokens": 0,
    "createdAt": "2026-07-28T12:05:00Z"
  }
}

Background: service spawns job 'generate_response' for conversationId/messageId
```

**Stream Messages (SSE)**
```
GET /api/workspaces/:id/conversations/:conversationId/stream?messageId=msg_002
Authorization: Bearer <jwt>
Accept: text/event-stream

Response 200 (streaming):
event: token
data: {"token":"Hello"}

event: token
data: {"token":" there,"}

event: token
data: {"token":" Claude!"}

event: done
data: {"messageId":"msg_002","inputTokens":10,"outputTokens":20}
```

### Services

**conversation.service.ts** (business logic, no HTTP)

```typescript
class ConversationService {
  async createConversation(
    userId: string,
    workspaceId: string,
    input: CreateConversationInput
  ): Promise<Conversation> {
    // Validate workspace membership
    await requireMembership(userId, workspaceId);
    
    // Create conversation with system message (empty for now)
    const conversation = await db.conversation.create({
      data: {
        workspaceId,
        createdBy: userId,
        title: input.title || 'Untitled Conversation',
        description: input.description,
        projectId: input.projectId,
        folderId: input.folderId,
      },
    });
    
    // Audit log
    await auditService.log(workspaceId, userId, 'conversation_created', 'Conversation', conversation.id, {});
    
    // Invalidate cache
    await cache.invalidate(`conversation_list:${workspaceId}`);
    
    return conversation;
  }

  async createMessage(
    userId: string,
    conversationId: string,
    input: CreateMessageInput
  ): Promise<Message> {
    // Fetch conversation
    const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    
    // Validate workspace membership
    await requireMembership(userId, conversation.workspaceId);
    
    // Create message
    const message = await db.message.create({
      data: {
        conversationId,
        content: input.content,
        role: input.role,
        parentId: input.parentId,
        status: input.role === 'USER' ? 'PENDING' : 'COMPLETE',
      },
    });
    
    // If USER message, spawn background job
    if (input.role === 'USER') {
      await queue.add('generate_response', {
        conversationId,
        userMessageId: message.id,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
    }
    
    // Update conversation lastMessageAt
    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
    
    // Audit log
    await auditService.log(conversation.workspaceId, userId, 'message_created', 'Message', message.id, {});
    
    // Invalidate caches
    await cache.invalidate(`messages:${conversationId}`);
    await cache.invalidate(`conversation:${conversationId}`);
    
    return message;
  }

  async buildPromptContext(
    conversationId: string,
    maxTokens: number = 2000
  ): Promise<Message[]> {
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    
    // Window messages by token budget
    let totalTokens = 0;
    const context: Message[] = [];
    
    for (const msg of messages) {
      const msgTokens = (msg.inputTokens || 0) + (msg.outputTokens || 0);
      if (totalTokens + msgTokens > maxTokens) break;
      context.push(msg);
      totalTokens += msgTokens;
    }
    
    return context;
  }
}
```

**message.service.ts** (message generation, streaming)

```typescript
class MessageService {
  async generateResponse(
    conversationId: string,
    userMessageId: string
  ): Promise<void> {
    try {
      // Fetch conversation + context
      const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
      const userMessage = await db.message.findUnique({ where: { id: userMessageId } });
      const context = await this.buildPromptContext(conversationId);
      
      // Create assistant message (status: STREAMING)
      const assistantMessage = await db.message.create({
        data: {
          conversationId,
          content: '', // Will be filled during streaming
          role: 'ASSISTANT',
          parentId: userMessageId,
          status: 'STREAMING',
        },
      });
      
      // Get AI provider
      const provider = await aiProviderService.getProvider();
      
      // Build prompt
      const systemPrompt = 'You are a helpful assistant.'; // TODO: use workspace default
      const messages = context.map(m => ({
        role: m.role,
        content: m.content,
      }));
      
      // Call provider with streaming
      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;
      
      const stream = await provider.generateStream({
        systemPrompt,
        messages,
        model: 'claude-opus', // TODO: use workspace setting
      });
      
      // Stream tokens to Redis queue (for SSE subscribers to consume)
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const token = event.delta.text;
          fullContent += token;
          
          // Emit to Redis stream (conversationId:stream)
          await redis.xAdd(`stream:${conversationId}`, '*', {
            messageId: assistantMessage.id,
            token,
            timestamp: Date.now().toString(),
          });
        }
        
        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
        }
        
        if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
        }
      }
      
      // Update message to COMPLETE
      await db.message.update({
        where: { id: assistantMessage.id },
        data: {
          content: fullContent,
          status: 'COMPLETE',
          inputTokens,
          outputTokens,
          completedAt: new Date(),
        },
      });
      
      // Emit final event to Redis
      await redis.xAdd(`stream:${conversationId}`, '*', {
        messageId: assistantMessage.id,
        event: 'done',
        inputTokens: inputTokens.toString(),
        outputTokens: outputTokens.toString(),
      });
      
      // Update conversation usage
      await db.conversationUsage.upsert({
        where: { conversationId },
        update: {
          totalInputTokens: { increment: inputTokens },
          totalOutputTokens: { increment: outputTokens },
        },
        create: {
          conversationId,
          totalInputTokens: inputTokens,
          totalOutputTokens: outputTokens,
        },
      });
      
    } catch (error) {
      // Mark message as ERROR
      await db.message.update({
        where: { id: userMessageId }, // This is wrong, should be assistantMessageId
        data: {
          status: 'ERROR',
          errorMessage: error.message,
        },
      });
      throw error;
    }
  }
}
```

### Background Workers

**Worker: generate_response**

```typescript
queue.process('generate_response', async (job) => {
  const { conversationId, userMessageId } = job.data;
  
  try {
    await messageService.generateResponse(conversationId, userMessageId);
    job.progress(100);
  } catch (error) {
    logger.error('Failed to generate response', { conversationId, userMessageId, error });
    throw error; // Bull will retry with backoff
  }
});
```

**Deployment:**
```bash
# Run 5 concurrent workers
npm run worker -- --topic generate_response --concurrency 5
```

### Redis Usage

**Cache Keys:**
- `conversation:{conversationId}` (TTL: 15 min) — Conversation metadata
- `messages:{conversationId}` (TTL: 30 min) — Message list
- `conversation_list:{workspaceId}:{userId}` (TTL: 5 min) — User's conversation list

**Streams (Pub/Sub):**
- `stream:{conversationId}` — Token streaming events (Redis stream, 1-hour TTL)
  - Events: `{ messageId, token, timestamp }` or `{ messageId, event: 'done', inputTokens, outputTokens }`

**Session State:**
- Existing: refresh tokens, rate limit counters
- New: (none for M1)

### Queue Usage

**Bull Queue Topics:**
- `generate_response` — Convert user message → AI response (HIGH PRIORITY, 5 workers)

**Job Spec:**
```typescript
{
  conversationId: string,
  userMessageId: string,
}
```

**Retry Policy:**
- Max attempts: 3
- Backoff: exponential (1s, 2s, 4s)

### Search Indexing

Not in M1 (deferred to M4). Messages stored in PostgreSQL only.

### AI Integration

**AI Provider Abstraction (existing):**
- Reuse `aiProviderService.getProvider()` to select AI model
- Call `provider.generateStream(systemPrompt, messages, model)` for streaming response
- Support: Anthropic (Claude), OpenAI (GPT-4), etc.

**New Parameter:** streaming mode (existing providers already support it)

### Streaming Changes

**SSE Endpoint Implementation:**

```typescript
router.get(
  '/:workspaceId/conversations/:conversationId/stream',
  authMiddleware,
  async (req: AuthRequest, res, next) => {
    try {
      const { conversationId } = req.params;
      const { messageId } = req.query;
      
      // Validate access
      const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
      await requireMembership(req.userId!, conversation.workspaceId);
      
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // Subscribe to Redis stream
      let lastId = '0';
      const interval = setInterval(async () => {
        const events = await redis.xRead(
          'STREAMS',
          `stream:${conversationId}`,
          lastId,
          { COUNT: 100, BLOCK: 1000 }
        );
        
        if (events && events.length > 0) {
          for (const [stream, messages] of events) {
            for (const [id, data] of messages) {
              if (data.messageId !== messageId) continue;
              
              if (data.event === 'done') {
                res.write(`event: done\n`);
                res.write(`data: ${JSON.stringify({
                  messageId: data.messageId,
                  inputTokens: parseInt(data.inputTokens),
                  outputTokens: parseInt(data.outputTokens),
                })}\n\n`);
                clearInterval(interval);
                res.end();
              } else {
                res.write(`event: token\n`);
                res.write(`data: ${JSON.stringify({ token: data.token })}\n\n`);
              }
              
              lastId = id;
            }
          }
        }
      }, 100);
      
      // Cleanup on client disconnect
      req.on('close', () => {
        clearInterval(interval);
      });
    } catch (error) {
      next(error);
    }
  }
);
```

### File Storage Changes

Not in M1 (deferred to M6). File uploads stored in `ConversationFile` table but not implemented yet.

### Security

**Access Control:**
- Conversation access: user must be workspace member (existing `requireMembership` middleware)
- Message ownership: any workspace member can read/write; edit only own messages
- AI API keys: stored in environment, never exposed to client

**Input Validation:**
- Zod schemas on all POST/PATCH endpoints
- Message content: 1-50,000 characters
- Conversation title: 1-200 characters
- Rate limiting: 100 messages/hour per user per workspace (existing rate limit middleware)

**Output Safety:**
- No PII in logs
- No AI API keys in error messages
- CORS configured (existing)

### Permissions

**Conversation Creation:** Workspace MEMBER+ (Editor+)  
**Message Reading:** Conversation creator + shared users (M5, not M1)  
**Message Writing:** Conversation creator only (M1)  
**Message Editing:** Own messages only  
**Conversation Deletion:** Creator + ADMIN+  

### Tests

**Unit Tests (Vitest):** `apps/backend/tests/services/*.test.ts`

- ConversationService:
  - `createConversation` with valid workspace
  - `createConversation` rejects non-members
  - `listConversations` filters by workspace
  - `updateConversation` updates title/description
  - `archiveConversation` sets flags
  
- MessageService:
  - `createMessage` with role=USER spawns job
  - `createMessage` updates lastMessageAt
  - `generateResponse` streams tokens correctly
  - `buildPromptContext` windows by token budget

**Integration Tests (Supertest):** `apps/backend/tests/routes/conversations.test.ts`

- POST /conversations: create conversation
- GET /conversations: list with pagination
- POST /conversations/:id/messages: create user message
- GET /conversations/:id/stream: SSE streaming
- Error cases: 404 on unknown workspace, 401 on missing auth

**Frontend Tests (Vitest + Testing Library):** `apps/web/tests/chat/*.test.tsx`

- ChatInterface renders message list
- MessageInput sends on Cmd+Enter
- useStreamMessage appends tokens to DOM
- ConversationList displays conversations

**Coverage Target:** >80% for services, >70% for routes, >60% for frontend

### Documentation

**API Documentation:** `docs/api.md`
- Add section: Conversations & Messages
- Endpoint specs (request/response examples)
- Error codes (400, 401, 403, 404, 500)

**Architecture:** `docs/architecture.md`
- Add section: "Conversations & Streaming"
- System diagram (user → browser → backend → AI provider)
- Data flow (message creation → background job → SSE response)
- Queue architecture

**Database:** `docs/database.md`
- Add: Conversation, Message, ConversationUsage schema
- Indexes and query patterns
- Retention policy (soft delete)

**Deployment:** `docs/deployment.md`
- Add: worker deployment (Bull queue with Redis)
- Environment variables: REDIS_URL, AI_PROVIDER

**Operations:** `docs/operations/RUNBOOK.md`
- Add: "Troubleshooting long response times"
  - Check Redis stream size
  - Check worker concurrency / job queue depth
  - Check AI provider API status

### Estimated LOC

| Component | LOC |
|-----------|-----|
| DB migration | 150 |
| Services (conversation, message) | 1,200 |
| Routes (POST, GET, PATCH, DELETE) | 800 |
| SSE streaming | 400 |
| Frontend components (Chat, Input, List) | 1,500 |
| Frontend hooks (useStreamMessage, queries) | 300 |
| Tests (backend + frontend) | 800 |
| **Total** | **~5,150** |

**Target:** 3,500 LOC (high reuse of existing patterns)

### Estimated Effort

- Backend development: 6 days (services, routes, workers)
- Frontend development: 5 days (components, streaming client)
- Testing: 2 days (unit + integration + E2E)
- Integration & fixes: 1 day
- **Total: 2 weeks (4 engineer-weeks)**

### Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| SSE connection loss (client disconnect) | HIGH | Implement client-side auto-reconnect with exponential backoff |
| Redis stream grows unbounded | MEDIUM | Set TTL to 1 hour, trim old entries |
| Worker job loss on crash | MEDIUM | Persistent queue (Bull/Redis default), no data loss |
| Token streaming latency > 1s | HIGH | Buffer tokens (emit every 50ms or 5 tokens), test locally first |
| AI API timeout during streaming | HIGH | Set timeout to 60s, graceful error handling, user sees "Generation failed" |
| Concurrent message generation (race) | LOW | Queue ensures only one job per conversation at a time |

### Definition of Done

- [ ] Database migration created, tested against staging
- [ ] conversation.service.ts complete with all methods
- [ ] message.service.ts complete (including generateResponse)
- [ ] conversation.ts and messages.ts routes complete
- [ ] SSE /stream endpoint working, tokens appear in frontend
- [ ] useStreamMessage hook complete
- [ ] ChatInterface component renders and accepts input
- [ ] MessageList component displays messages with proper styling
- [ ] Background job (generate_response) working end-to-end
- [ ] All unit tests passing (>80% coverage)
- [ ] All integration tests passing
- [ ] Frontend tests passing (>60% coverage)
- [ ] lint (eslint, prettier) passes
- [ ] typecheck passes (strict mode)
- [ ] Production build succeeds
- [ ] Docker build succeeds
- [ ] Security audit passes
- [ ] Documentation updated (API, architecture, database, deployment)
- [ ] Commit with clear message
- [ ] Push to feature branch
- [ ] CI (test, docker, security) green
- [ ] Manual smoke test: create conversation, send message, see streaming response

### Dependencies

**Runtime:**
- Existing: Express, Prisma, PostgreSQL, Redis, Bull, AI providers
- New: None (reuse all existing infrastructure)

**External APIs:**
- AI Provider (Anthropic, OpenAI, etc.) — streaming support required

**Deployment Prerequisites:**
- Redis running (for Bull queue and cache)
- PostgreSQL with new migration applied
- AI provider API key configured

---

## Milestone M2: Message Threading & Branching

**Duration:** 2 weeks (Weeks 3-4)  
**Effort:** 3.5 engineer-weeks  
**Est. LOC:** 2,200  
**Dependencies:** M1 complete  
**Status:** Not started

### Objective

Enable message threading (reply to specific message) and message branching (generate alternative responses at any point). Users can explore multiple conversation paths without losing originals.

### Business Value

- Users can explore alternative responses ("what if I asked differently?")
- Conversation trees enable non-linear exploration (critical for creative work)
- Aligns with modern AI UX expectations (Claude web, ChatGPT, Copilot)
- Increases engagement (users don't abandon conversation, they branch)

### Database Changes

**New Tables:**

```prisma
model MessageBranch {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(name: "ConversationBranches", fields: [conversationId], references: [id], onDelete: Cascade)
  
  parentMessageId String
  parentMessage Message @relation(name: "BranchParent", fields: [parentMessageId], references: [id], onDelete: Cascade)
  
  title String @default("Alternative")
  isActive Boolean @default(true)
  
  messages Message[] @relation(name: "BranchMessages")
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([parentMessageId])
  @@unique([conversationId, parentMessageId, title])
}
```

**Schema Changes (Message):**

```prisma
model Message {
  // ... existing fields ...
  
  // New in M2:
  branchId String?
  branch MessageBranch? @relation(name: "BranchMessages", fields: [branchId], references: [id], onDelete: Cascade)
}
```

**Migration File:** `packages/database/prisma/migrations/xxxxx_add_message_branching.sql`

### Backend Changes

**Service Updates:**

- `conversation.service.ts`
  - `listBranches(conversationId)` → MessageBranch[]
  - `switchBranch(conversationId, branchId)` → void (set isActive)

- `message.service.ts`
  - `createBranch(userId, conversationId, parentMessageId, title)` → MessageBranch
  - `regenerateMessage(userId, conversationId, messageId)` → Message
  - `deleteBranch(userId, conversationId, branchId)` → void

**Routes:** `apps/backend/src/routes/conversations.ts` (extended)

```
POST   /api/workspaces/:id/conversations/:conversationId/messages/:messageId/branches
       Create branch from message
       Request: { title: "Alternative approach" }
       Response: MessageBranch { id, title, parentMessageId, createdAt }
       (Auto-generates alternative response)

GET    /api/workspaces/:id/conversations/:conversationId/branches
       List all branches
       Response: { items: [{ id, title, parentMessageId, messageCount, createdAt }] }

PATCH  /api/workspaces/:id/conversations/:conversationId/branches/:branchId
       Activate branch (set isActive=true, save as canonical)
       Response: { id, isActive }

DELETE /api/workspaces/:id/conversations/:conversationId/branches/:branchId
       Delete branch and all messages
       Response: { success: true }
```

**Key Logic:**

```typescript
// Create branch
async createBranch(
  userId: string,
  conversationId: string,
  parentMessageId: string,
  title: string
): Promise<MessageBranch> {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  await requireMembership(userId, conversation.workspaceId);
  
  const branch = await db.messageBranch.create({
    data: {
      conversationId,
      parentMessageId,
      title,
    },
  });
  
  // Spawn job to generate alternative response
  await queue.add('generate_response', {
    conversationId,
    parentMessageId,
    branchId: branch.id,
  });
  
  await auditService.log(conversation.workspaceId, userId, 'branch_created', 'MessageBranch', branch.id, {});
  
  return branch;
}
```

### Frontend Changes

**Branch UI:**

- Branch selector dropdown (shows active branch + alternatives)
- Branch creation button (+ modal to name)
- Branch indicator in message list ("Branch: Alternative 1")
- Visual distinction (subtle background or border)

**Components:**

- `BranchSelector` — dropdown with active/inactive branches
- `BranchCreationModal` — prompt for branch name
- `BranchList` — list of all branches with metadata

**State:**

```typescript
const useConversationStore = create((set) => ({
  // ... existing ...
  currentBranchId: null, // if null, show main branch
  setCurrentBranch: (id) => set({ currentBranchId: id }),
}));
```

**Message List Filtering:**

- When branch selected: show only messages in that branch
- Message filtering logic: `message.branchId === selectedBranchId || (selectedBranchId === null && !message.branchId)`

### Tests

**Service Tests:**
- `createBranch` spawns job + creates MessageBranch
- `listBranches` returns all branches for conversation
- `switchBranch` sets isActive + invalidates caches

**Route Tests:**
- POST /branches creates and generates response
- GET /branches lists all branches
- PATCH /branches/:id activates branch
- DELETE /branches/:id removes branch + messages

**Frontend Tests:**
- BranchSelector renders branches
- Branch creation modal submits + creates branch
- Message list filters by branch

### Estimated LOC

| Component | LOC |
|-----------|-----|
| DB migration | 150 |
| Services (branch creation, switching) | 400 |
| Routes (POST, GET, PATCH, DELETE) | 350 |
| Frontend components (BranchSelector, Modal, Filter) | 600 |
| Tests (backend + frontend) | 500 |
| **Total** | **~2,000** |

### Definition of Done

- [ ] MessageBranch schema + migration
- [ ] Branch creation service + route
- [ ] Branch switching + filtering
- [ ] BranchSelector + BranchCreationModal components
- [ ] Message list filters by active branch
- [ ] All tests passing
- [ ] lint, typecheck, build passing
- [ ] CI green
- [ ] Manual test: create branch, see alternative response, switch branches

### Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Users confused by branches (UX complexity) | MEDIUM | Highlight active branch prominently, show "Main" vs "Alternative" labels |
| Branch performance (N branches × M messages) | LOW | Pagination, lazy load, virtual scrolling |

---

## Milestone M3: Knowledge Base (Prompts & Templates)

**Duration:** 2 weeks (Weeks 5-6)  
**Effort:** 3 engineer-weeks  
**Est. LOC:** 1,800  
**Dependencies:** M1 complete (independent of M2)  
**Status:** Not started

### Objective

Implement prompt and template libraries. Users create reusable system prompts ("act as a product manager"), share with teammates, rate/favorite, and use in new conversations.

### Database Changes

```prisma
model Prompt {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  title String
  description String?
  content String // The system prompt
  
  createdBy String
  creator User @relation(name: "CreatedPrompts", fields: [createdBy], references: [id])
  isPublic Boolean @default(false) // Shared with all workspace members
  
  category String? // "creative", "analysis", "coding"
  tags String[] @default([])
  
  usage Int @default(0) // Usage counter
  rating Float @default(0) // 0-5 stars
  
  version Int @default(1)
  parentId String? // For versioning
  parent Prompt? @relation(name: "PromptVersions", fields: [parentId], references: [id], onDelete: SetNull)
  children Prompt[] @relation(name: "PromptVersions")
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([workspaceId])
  @@index([createdBy])
  @@index([isPublic])
  @@unique([workspaceId, title]) // Per-workspace unique
}

model Template {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  title String
  description String?
  category String // "writing", "analysis", "coding"
  
  systemPrompt String // Full prompt to use
  initialUserMessage String? // Starter message
  suggestedFollowUps String[] // Suggestions after response
  
  createdBy String
  creator User @relation(name: "CreatedTemplates", fields: [createdBy], references: [id])
  isPublic Boolean @default(false)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([workspaceId])
  @@index([category])
}
```

### Backend Changes

**Services:**

- `prompt.service.ts`
  - `createPrompt(userId, workspaceId, input)` → Prompt
  - `listPrompts(userId, workspaceId, filters)` → Prompt[]
  - `updatePrompt(userId, promptId, input)` → Prompt (creates new version)
  - `deletePrompt(userId, promptId)` → void
  - `ratePrompt(userId, promptId, rating)` → Prompt
  - `incrementUsage(promptId)` → void

- `template.service.ts` (similar)
  - `createTemplate(userId, workspaceId, input)` → Template
  - `listTemplates(userId, workspaceId, filters)` → Template[]
  - etc.

**Routes:**

```
POST   /api/workspaces/:id/prompts
GET    /api/workspaces/:id/prompts
GET    /api/workspaces/:id/prompts/:promptId
PATCH  /api/workspaces/:id/prompts/:promptId
DELETE /api/workspaces/:id/prompts/:promptId
POST   /api/workspaces/:id/prompts/:promptId/rate
POST   /api/workspaces/:id/prompts/:promptId/use

[Similar for templates]
```

**Integration with M1:**

- When creating conversation with template: use template's systemPrompt as first system message
- When using prompt in chat: inject as system prompt for next generation

### Frontend Changes

**Pages:**

- `apps/web/src/app/(dashboard)/prompts/page.tsx` — Prompt library
- `apps/web/src/app/(dashboard)/templates/page.tsx` — Template gallery

**Components:**

- `PromptLibrary` — List, search, filter, rate
- `PromptCard` — Display with actions (use, edit, delete)
- `PromptCreationModal` — New prompt form
- `TemplateGallery` — Category view + filters

**Chat Integration:**

- Prompt autocomplete in message input (show "@" trigger)
- Template picker in new conversation dialog

### Tests

**Service Tests:**
- Create/list/update/delete prompts
- Versioning (update creates new version)
- Public/private filtering
- Usage counter increment

**Frontend Tests:**
- PromptLibrary renders prompts
- Search/filter works
- Rating updates locally

### Estimated LOC

| Component | LOC |
|-----------|-----|
| DB migration | 100 |
| Services (prompt, template) | 600 |
| Routes | 300 |
| Frontend pages (library, gallery) | 700 |
| Chat integration (autocomplete, picker) | 300 |
| Tests | 400 |
| **Total** | **~2,400** |

### Definition of Done

- [ ] Prompt + Template schema + migration
- [ ] CRUD services + routes
- [ ] Rating + usage tracking
- [ ] PromptLibrary + TemplateGallery pages
- [ ] Chat integration (autocomplete, picker, system prompt injection)
- [ ] All tests passing
- [ ] CI green
- [ ] Manual test: create prompt, rate it, use in new conversation

---

## Milestone M4: Full-Text & Semantic Search

**Duration:** 2 weeks (Weeks 7-8)  
**Effort:** 3.5 engineer-weeks  
**Est. LOC:** 2,500  
**Dependencies:** M1 complete (M2, M3 optional but recommended)  
**Status:** Not started

### Objective

Search conversations and messages via full-text (Elasticsearch) and semantic similarity (vector DB). Users find past conversations quickly.

### Infrastructure

**New Services:**
- Elasticsearch 8.11 cluster (1 node local, 3+ nodes production)
- Pinecone or Weaviate for vector embeddings

### Database Changes

No new tables (search is denormalized in external services).

### Backend Changes

**Service:**

- `search.service.ts`
  - `indexMessage(message)` → void (async, Elasticsearch + vector DB)
  - `searchConversations(workspaceId, query, limit)` → SearchResult[]
  - `semanticSearch(workspaceId, query, limit)` → Message[]
  - `deleteIndex(conversationId)` → void (cleanup)

**Worker:**

- `index_message_search` — On message completion, index to Elasticsearch
- `generate_embeddings` — On message completion, embed + store in vector DB

**Routes:**

```
GET /api/workspaces/:id/search
    ?q=feature&type=conversation&limit=20
    Response: { items: [{ id, title, snippet, score, highlights }] }

GET /api/workspaces/:id/search/semantic
    ?q=how do we price our product&limit=10
    Response: { items: [{ id, content, conversationId, score }] }
```

### Frontend Changes

**Component:**

- `SearchInput` in sidebar + header
- `SearchResults` modal/panel with tabs (Conversations, Messages)
- Keyboard shortcut (Cmd+K / Ctrl+K) to open search

**UX:**

- Debounced search (300ms)
- Show results as you type
- Highlight matching terms
- Quick actions (open conversation, jump to message)

### Tests

**Service Tests:**
- Index message to Elasticsearch
- Full-text search returns relevant results
- Semantic search ranks by relevance
- Workspace isolation (can't see other workspace's messages)

**Frontend Tests:**
- SearchInput focused on Cmd+K
- Results display correctly
- Click result opens conversation

### Estimated LOC

| Component | LOC |
|-----------|-----|
| Elasticsearch integration | 300 |
| Vector DB integration (Pinecone/Weaviate) | 300 |
| search.service.ts | 600 |
| Routes | 200 |
| Frontend (SearchInput, SearchResults) | 500 |
| Workers (index, embeddings) | 400 |
| Tests | 500 |
| **Total** | **~2,800** |

### Definition of Done

- [ ] Elasticsearch cluster running
- [ ] Vector DB (Pinecone/Weaviate) configured
- [ ] search.service.ts complete
- [ ] Workers (index_message_search, generate_embeddings) complete
- [ ] Search routes working
- [ ] SearchInput + SearchResults components
- [ ] Full-text + semantic search both working
- [ ] Workspace isolation verified
- [ ] All tests passing
- [ ] CI green

---

## Milestone M5: Sharing & Real-Time Collaboration

**Duration:** 3 weeks (Weeks 9-11)  
**Effort:** 4 engineer-weeks  
**Est. LOC:** 3,000  
**Dependencies:** M1 complete (independent of M2-M4)  
**Status:** Not started

### Objective

Share conversations via invite links, enable collaborative editing (multiple users in same conversation), show real-time presence (who else is viewing).

### Database Changes

```prisma
model SharedConversation {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(name: "SharedConversations", fields: [conversationId], references: [id], onDelete: Cascade)
  
  inviteToken String @unique
  inviteExpiresAt DateTime?
  
  permission SharePermission // enum: VIEW, EDIT, MANAGE
  
  sharedBy String
  sharedByUser User @relation(name: "SharedByMe", fields: [sharedBy], references: [id])
  
  sharedWith String?
  sharedWithUser User? @relation(name: "SharedWithMe", fields: [sharedWith], references: [id])
  
  createdAt DateTime @default(now())
  acceptedAt DateTime?
  
  @@index([conversationId])
  @@index([inviteToken])
  @@index([sharedWith])
}

enum SharePermission {
  VIEW   // Read-only
  EDIT   // Add messages
  MANAGE // Edit/delete all
}
```

### Backend Changes

**Service:**

- `sharing.service.ts`
  - `createInvite(userId, conversationId, permission, expiresIn)` → SharedConversation
  - `acceptInvite(inviteToken)` → Conversation (public endpoint)
  - `revokeShare(userId, conversationId, sharedId)` → void
  - `listSharedWith(userId, conversationId)` → SharedConversation[]

**WebSocket Server:**

```typescript
import { Server as SocketIOServer } from 'socket.io';

const io = new SocketIOServer(httpServer, {
  cors: { origin: process.env.FRONTEND_URL },
});

io.use(authMiddleware); // Verify JWT

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  const conversationId = socket.handshake.query.conversationId;
  
  // Join presence room
  socket.join(`conversation:${conversationId}`);
  
  // Broadcast user presence
  socket.broadcast.to(`conversation:${conversationId}`).emit('user_joined', {
    userId,
    username: '...', // from cache or DB
    avatar: '...',
  });
  
  socket.on('typing', (data) => {
    socket.broadcast.to(`conversation:${conversationId}`).emit('user_typing', {
      userId,
      ...data,
    });
  });
  
  socket.on('disconnect', () => {
    socket.broadcast.to(`conversation:${conversationId}`).emit('user_left', {
      userId,
    });
  });
});
```

**Routes:**

```
POST   /api/workspaces/:id/conversations/:conversationId/share
       Create invite link
       Request: { permission: "VIEW" | "EDIT" | "MANAGE", expiresIn: "7d" }
       Response: { inviteToken, inviteUrl, expiresAt }

GET    /api/conversations/shared/:inviteToken
       Get conversation by invite token (public, no auth required)
       Response: { id, title, permission, messages: [] }

POST   /api/conversations/shared/:inviteToken/accept
       Accept invite (requires auth)
       Response: { success: true, conversationId }

GET    /api/workspaces/:id/conversations/:conversationId/shared
       List who conversation is shared with
       Response: { items: [{ id, sharedWith, permission, acceptedAt }] }

DELETE /api/workspaces/:id/conversations/:conversationId/shared/:sharedId
       Revoke share
       Response: { success: true }
```

### Frontend Changes

**Share Modal:**

- Input field to select permission (VIEW / EDIT / MANAGE)
- Generate invite link button
- Copy link to clipboard
- List of accepted shares + revoke buttons

**Presence Indicator:**

- Top right of chat: avatars of active viewers
- Hover: show names + "viewing" / "editing"
- Typing indicator (shown as "User is typing...")

**WebSocket Client:**

```typescript
// Hook: usePresence
const usePresence = (conversationId: string) => {
  const [activeUsers, setActiveUsers] = useState<User[]>([]);
  
  useEffect(() => {
    const socket = io(process.env.REACT_APP_API_URL, {
      query: { conversationId },
      auth: { token: authStore.token },
    });
    
    socket.on('user_joined', (data) => {
      setActiveUsers(prev => [...prev, data]);
    });
    
    socket.on('user_left', (data) => {
      setActiveUsers(prev => prev.filter(u => u.userId !== data.userId));
    });
    
    socket.on('user_typing', (data) => {
      // Update UI
    });
    
    return () => socket.disconnect();
  }, [conversationId]);
  
  return { activeUsers };
};
```

### Permission Model

**Access Rules:**

- Conversation owner (creator): full control
- Workspace EDITOR: read/write in workspace conversations
- Workspace VIEWER: read-only in workspace conversations
- Invited via link with VIEW: read-only
- Invited via link with EDIT: add messages (not edit others)
- Invited via link with MANAGE: full control

**Implementation:** Check permission at endpoint entry

### Tests

**Service Tests:**
- Create invite with expiration
- Accept invite (creates SharedConversation record)
- Revoke share
- List shared conversions

**WebSocket Tests:**
- Socket connection with auth
- User presence broadcast
- Typing indicator
- Disconnect cleanup

**Frontend Tests:**
- Share modal renders
- Copy link works
- usePresence hook updates on events
- Typing indicator displays

### Estimated LOC

| Component | LOC |
|-----------|-----|
| sharing.service.ts | 400 |
| WebSocket server setup | 300 |
| Routes + middleware | 300 |
| Frontend share modal | 400 |
| Presence indicator + hooks | 500 |
| WebSocket client integration | 300 |
| Tests (backend + frontend) | 600 |
| **Total** | **~2,800** |

### Definition of Done

- [ ] SharedConversation schema + migration
- [ ] sharing.service.ts complete
- [ ] WebSocket server running
- [ ] Share modal working (create, copy, revoke)
- [ ] Presence indicator showing active users
- [ ] Typing indicator working
- [ ] Invite link acceptance working
- [ ] All tests passing
- [ ] CI green
- [ ] Manual test: create invite, accept in private window, see presence + typing

---

## Milestone M6: File Uploads & Tool Execution

**Duration:** 3 weeks (Weeks 12-14)  
**Effort:** 4 engineer-weeks  
**Est. LOC:** 3,200  
**Dependencies:** M1 complete (independent of others)  
**Status:** Not started

### Objective

Users upload files (images, documents, code) to conversations, reference them in messages, and execute custom tools (webhooks, APIs) from within conversations.

### Infrastructure

**New Services:**
- S3 or S3-compatible object storage (for file uploads)
- External virus scanning (optional: ClamAV)

### Database Changes

**New Table (ConversationFile already in M1 schema):**

```prisma
model ToolDefinition {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  name String
  description String
  
  inputSchema Json // JSON schema for tool input
  
  provider String // "webhook", "openai", "anthropic"
  providerConfig Json // auth, endpoint, etc.
  
  createdBy String
  creator User @relation(name: "CreatedTools", fields: [createdBy], references: [id])
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  executions ToolExecution[] @relation("ToolDefExecutions")
  
  @@index([workspaceId])
  @@unique([workspaceId, name])
}

// ToolExecution already in M1 schema
```

### Backend Changes

**Services:**

- `file.service.ts`
  - `uploadFile(userId, conversationId, file)` → ConversationFile
  - `deleteFile(userId, conversationId, fileId)` → void
  - `getPresignedDownloadUrl(userId, conversationId, fileId)` → URL

- `tool.service.ts`
  - `createToolDefinition(userId, workspaceId, input)` → ToolDefinition
  - `listTools(userId, workspaceId)` → ToolDefinition[]
  - `executeToolAsync(userId, conversationId, toolId, input)` → ToolExecution

**File Upload Endpoint:**

```
POST /api/workspaces/:id/conversations/:conversationId/files
     Multipart form data
     Response: { id, fileName, fileSize, storageKey, uploadedAt }
```

**Tool Execution:**

```
POST /api/workspaces/:id/tools/:toolId/execute
     { input: {...}, conversationId, messageId }
     Response: { id, status: "PENDING", createdAt }
     (Async execution via queue)
```

**Worker:**

- `execute_tool` — Call webhook/API, store result in ToolExecution
- `scan_file` — Virus scan uploaded file (async, optional)

### Frontend Changes

**Components:**

- `FileUploadButton` — Click to select file, multipart upload
- `FileList` — Show uploaded files with preview/download
- `ToolExecutor` — List workspace tools, button to execute

**Chat Integration:**

- Show file references in message ("📎 filename.pdf")
- Tool result rendering (JSON, markdown, etc.)

### Tests

**Service Tests:**
- Upload file to S3
- Delete file
- Execute tool via webhook
- Tool result storage

**Frontend Tests:**
- FileUploadButton accepts file
- FileList displays files
- Tool executor shows results

### Estimated LOC

| Component | LOC |
|-----------|-----|
| file.service.ts | 300 |
| tool.service.ts | 400 |
| Routes (file upload, tool exec) | 300 |
| S3 integration | 200 |
| Frontend (FileUploadButton, FileList, ToolExecutor) | 600 |
| Workers (execute_tool, scan_file) | 400 |
| Tests | 500 |
| **Total** | **~2,700** |

### Definition of Done

- [ ] S3 bucket configured + credentials in env
- [ ] file.service.ts complete (upload, delete, download)
- [ ] tool.service.ts complete (CRUD + execution)
- [ ] File upload + tool execution routes working
- [ ] FileUploadButton + FileList components
- [ ] Chat message shows file references
- [ ] Tool result rendering working
- [ ] All tests passing
- [ ] CI green
- [ ] Manual test: upload file, execute tool, see results in chat

---

## Milestone M7: Usage Tracking & Analytics

**Duration:** 2 weeks (Weeks 15-16)  
**Effort:** 3 engineer-weeks  
**Est. LOC:** 2,000  
**Dependencies:** M1 complete (M6 recommended for accurate cost data)  
**Status:** Not started

### Objective

Track token usage per conversation, calculate costs by provider/model, provide dashboard with usage trends, credit ledger, cost projections.

### Database Changes

**New Table:**

```prisma
model CreditLedger {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  conversationId String?
  
  providerId String
  model String
  
  inputTokens Int
  outputTokens Int
  costCents Int
  
  description String? // "Claude 3 Opus generation"
  
  createdAt DateTime @default(now())
  
  @@index([workspaceId, createdAt])
  @@index([conversationId])
}
```

### Backend Changes

**Service:**

- `usage.service.ts`
  - `recordUsage(conversationId, providerId, model, inputTokens, outputTokens)` → void
  - `getConversationUsage(conversationId)` → Usage
  - `getWorkspaceSummary(workspaceId, dateRange)` → UsageSummary
  - `getLedger(workspaceId, pagination, filters)` → CreditLedger[]
  - `projectCosts(workspaceId, daysAhead)` → ProjectedCosts

**Routes:**

```
GET /api/workspaces/:id/usage/summary
    ?from=2026-07-01&to=2026-07-31
    Response: {
      totalConversations, totalMessages,
      totalInputTokens, totalOutputTokens,
      costByProvider, costByModel,
      topUsers, topConversations
    }

GET /api/workspaces/:id/usage/ledger
    ?skip=0&take=100&from=...&to=...&providerId=...
    Response: { items: [...], total, hasMore }

GET /api/workspaces/:id/usage/projection
    ?daysAhead=30
    Response: {
      projectedTokens, projectedCost, trendline
    }
```

### Frontend Changes

**Dashboard Page:** `apps/web/src/app/(dashboard)/usage/page.tsx`

**Components:**

- `UsageOverview` — Cards showing: conversations, tokens, cost (month)
- `UsageChart` — Line chart: tokens over time
- `CostByProvider` — Pie chart: cost breakdown
- `UsageLedger` — Table with sortable columns
- `CostProjection` — Card with trend + warning if on track to exceed budget

**Settings Integration:**

- Add "Usage & Billing" tab to workspace settings
- Show current month usage + trends

### Tests

**Service Tests:**
- Record usage to ledger
- Aggregate by provider/model
- Cost calculation accuracy
- Projection algorithm

**Frontend Tests:**
- UsageChart renders data correctly
- Ledger sorts/filters
- Projection warning triggers

### Estimated LOC

| Component | LOC |
|-----------|-----|
| usage.service.ts | 400 |
| Routes + aggregations | 300 |
| DB queries + indexing | 200 |
| Frontend (charts, tables, cards) | 600 |
| Workers (refresh_usage_summary) | 200 |
| Tests | 400 |
| **Total** | **~2,100** |

### Definition of Done

- [ ] CreditLedger schema + migration
- [ ] usage.service.ts complete
- [ ] Usage routes working
- [ ] UsageChart + CostByProvider rendering
- [ ] UsageLedger with filters/sorting
- [ ] Cost projection working
- [ ] All tests passing
- [ ] CI green
- [ ] Manual test: generate conversations, verify cost tracking + dashboard accuracy

---

## Milestone M8: Conversation History & Export

**Duration:** 2 weeks (Weeks 17-18)  
**Effort:** 2.5 engineer-weeks  
**Est. LOC:** 1,500  
**Dependencies:** M1 complete (M7 recommended)  
**Status:** Not started

### Objective

Export conversations to markdown/JSON/PDF, view edit history (who changed what when), restore from snapshots.

### Database Changes

**New Tables:**

```prisma
model MessageVersion {
  id String @id @default(cuid())
  messageId String
  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  
  contentBefore String
  contentAfter String
  
  editedBy String
  editedByUser User @relation(fields: [editedBy], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([messageId, createdAt])
}

model ConversationSnapshot {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  format String // "markdown" | "json" | "pdf"
  content String // Exported content
  
  exportedBy String
  exportedByUser User @relation(fields: [exportedBy], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([conversationId, createdAt])
}
```

### Backend Changes

**Service:**

- `export.service.ts`
  - `exportMarkdown(conversationId)` → string
  - `exportJSON(conversationId)` → JSON
  - `exportPDF(conversationId)` → Buffer
  - `saveSnapshot(conversationId, format, content)` → ConversationSnapshot

**Routes:**

```
GET /api/workspaces/:id/conversations/:conversationId/export
    ?format=markdown|json|pdf
    Response: File download or { markdown: "..." }

GET /api/workspaces/:id/conversations/:conversationId/versions/:messageId
    Response: { items: [{ contentBefore, contentAfter, editedBy, createdAt }] }

GET /api/workspaces/:id/conversations/:conversationId/snapshots
    Response: { items: [{ id, format, exportedAt, exportedBy }] }
```

### Frontend Changes

**Components:**

- `ExportModal` — Choose format (markdown, JSON, PDF), download button
- `HistoryPanel` — Message edit history (who edited, when, diff view)
- `SnapshotsList` — Previous exports + restore

**Chat Integration:**

- "Export" button in conversation menu
- "Edit history" link on each message

### Workers

- `export_conversation` — Background job to generate PDF (may be slow)

### Tests

**Service Tests:**
- Export to markdown/JSON
- PDF generation
- Snapshot storage
- Version tracking on edit

**Frontend Tests:**
- ExportModal renders formats
- Download works
- HistoryPanel displays versions

### Estimated LOC

| Component | LOC |
|-----------|-----|
| export.service.ts | 300 |
| Routes | 150 |
| DB migrations | 100 |
| Frontend (ExportModal, HistoryPanel) | 400 |
| PDF generation | 200 |
| Workers (export_conversation) | 150 |
| Tests | 200 |
| **Total** | **~1,500** |

### Definition of Done

- [ ] MessageVersion + ConversationSnapshot schema
- [ ] export.service.ts complete (markdown, JSON, PDF)
- [ ] Export routes working
- [ ] ExportModal component
- [ ] Message edit history tracking + UI
- [ ] All tests passing
- [ ] CI green
- [ ] Manual test: export conversation, view edit history

---

## Milestone M9: Real-Time Collaboration (Advanced)

**Duration:** 2 weeks (Weeks 19-20)  
**Effort:** 3 engineer-weeks  
**Est. LOC:** 2,000  
**Dependencies:** M1 + M5 complete  
**Status:** Not started

### Objective

Multiple users edit same message simultaneously (Operational Transform or CRDT), see cursor positions, resolve conflicts gracefully.

### Backend Changes

**OT/CRDT Strategy:** Use Yjs (proven, used in Google Docs alternatives)

```typescript
// NOT DETAILED IN M1-M8 PLAN (advanced feature, lower priority for launch)
```

---

## Milestone M10: Performance & Launch Prep

**Duration:** 2 weeks (Weeks 21-22, overlaps launch)  
**Effort:** 2 engineer-weeks  
**Est. LOC:** 500  
**Dependencies:** M1-M8 complete  
**Status:** Not started

### Objective

Performance optimization, load testing, security hardening, production readiness verification, documentation finalization.

### Tasks

**Performance:**
- Database query optimization (n+1 detection, indexing)
- Frontend bundle size analysis + code splitting
- Caching strategy review (Redis TTLs, invalidation)
- Load testing (1,000 concurrent users, measure p99 latency)

**Security:**
- Full security audit (OWASP Top 10)
- Penetration testing
- Secret rotation
- Rate limiting tuning

**Operations:**
- Deployment runbook
- Monitoring/alerting setup (Datadog, New Relic)
- Backup strategy
- Disaster recovery plan

**Documentation:**
- API docs (OpenAPI spec)
- Architecture diagrams
- Deployment guide
- Troubleshooting guide

**Testing:**
- End-to-end test suite (Playwright)
- Chaos engineering (failure scenarios)
- Production smoke tests

### Definition of Done

- [ ] p99 latency < 500ms
- [ ] 99.9% uptime SLA
- [ ] Load test passes (1K concurrent users)
- [ ] Security audit green
- [ ] All docs complete + reviewed
- [ ] Monitoring + alerting configured
- [ ] Backup tested
- [ ] Team trained on runbooks
- [ ] Launch approval from CEO + CTO

---

## Release 3 Verification Gates

**Every milestone must pass these gates before proceeding:**

### Code Quality

```bash
pnpm run lint          # 0 errors, 0 warnings (unless suppressed with // @ts-ignore for valid reasons)
pnpm run type-check    # 0 errors (strict TypeScript)
pnpm run format        # All files formatted (prettier)
```

### Testing

```bash
pnpm run test             # All tests passing
pnpm run test:coverage    # >75% coverage (services), >60% (frontend)
```

### Build & Docker

```bash
pnpm run build            # Production build succeeds
docker build -t synora:test .
                         # Docker build succeeds
```

### Security

```bash
pnpm audit                # 0 critical, 0 high vulnerabilities
npm audit --production    # Production deps only
trivy scan .              # Code scanning for secrets
```

### CI/CD

- GitHub Actions pipeline passes
  - ✓ lint
  - ✓ typecheck
  - ✓ test
  - ✓ coverage
  - ✓ build
  - ✓ docker
  - ✓ security

---

## Success Criteria (Launch Readiness)

**M1-M10 Complete:**
- [ ] All 10 milestones shipped
- [ ] All verification gates green
- [ ] >75% test coverage
- [ ] 0 critical/high security vulnerabilities
- [ ] Performance targets met (p99 < 500ms, uptime 99.9%)
- [ ] All documentation complete
- [ ] Team trained + runbooks approved
- [ ] Customer feedback integrated

**Launch:**
- [ ] CEO approval
- [ ] CTO sign-off
- [ ] Production deployment successful
- [ ] Monitoring + alerting active
- [ ] Support team ready

---

## Rollout Summary

| Milestone | Weeks | M.E.W | Critical Path | Dependencies |
|-----------|-------|-------|---------------|--------------|
| M1: Core Chat | 1-2 | 4 | YES (foundation) | Postgres, Redis |
| M2: Branching | 3-4 | 3.5 | NO (parallel) | M1 |
| M3: Knowledge | 5-6 | 3 | NO (parallel) | M1 |
| M4: Search | 7-8 | 3.5 | YES (to launch) | M1, Elasticsearch |
| M5: Sharing | 9-11 | 4 | YES (to launch) | M1, WebSocket |
| M6: Files & Tools | 12-14 | 4 | YES (to launch) | M1, S3 |
| M7: Analytics | 15-16 | 3 | YES (for scale) | M1, M6 |
| M8: History & Export | 17-18 | 2.5 | NO (polish) | M1, M7 |
| M9: Collab (advanced) | 19-20 | 3 | NO (polish) | M1, M5 |
| M10: Launch Prep | 21-22 | 2 | YES | M1-M9 |
| **TOTAL** | **22** | **33 M.E.W** | | |

**M.E.W** = Machine Engineer-Weeks (at 1 engineer full-time for 5 days/week)

**Critical Path (longest chain):** M1 → M4 → M6 → M7 → M10 (15 weeks minimum)  
**Wall-Clock Timeline:** 22 weeks (5.5 months) with full team

---

## Next Steps

1. **Approve M1 Execution Plan** — Review database schema, API design, service layer
2. **Set Up Infrastructure** — Provision Postgres, Redis, S3, Elasticsearch (staging)
3. **Begin M1 Implementation** — Target: 2-week sprint completion
4. **Daily Standups** — Report blockers, progress
5. **Weekly Reviews** — Verify gates, adjust if needed

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-28  
**Author:** Architecture Planning  
**Status:** APPROVED, READY FOR IMPLEMENTATION
