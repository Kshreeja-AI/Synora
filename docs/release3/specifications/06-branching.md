# Conversation Branching Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

---

## Database

```prisma
model MessageBranch {
  id String @id @default(cuid())
  conversationId String
  parentMessageId String
  
  title String @default("Alternative")
  isActive Boolean @default(true)
  
  messages Message[] @relation(name: "BranchMessages")
  createdAt DateTime @default(now())
  
  @@unique([conversationId, parentMessageId, title])
}
```

---

## Service Layer

```typescript
class BranchingService {
  async createBranch(
    userId: string,
    conversationId: string,
    parentMessageId: string,
    title: string
  ): Promise<MessageBranch>

  async listBranches(
    conversationId: string
  ): Promise<MessageBranch[]>

  async switchBranch(
    userId: string,
    conversationId: string,
    branchId: string
  ): Promise<void>

  async deleteBranch(
    userId: string,
    conversationId: string,
    branchId: string
  ): Promise<void>
}
```

---

## API

```
POST /api/.../conversations/:conversationId/messages/:parentMessageId/branches
{ "title": "Alternative approach" }
Response 201: MessageBranch

GET /api/.../conversations/:conversationId/branches
Response 200: MessageBranch[]

PATCH /api/.../conversations/:conversationId/branches/:branchId
{ "isActive": true }
Response 200: MessageBranch

DELETE /api/.../conversations/:conversationId/branches/:branchId
Response 200: { success: true }
```

---

## Validation

- Title 1-100 chars
- Parent message must exist
- Unique title per parent

---

## Permissions

- Conversation creator can create/delete branches
- Workspace EDITOR+ can create

---

## Logging

```json
{
  "action": "branch_created",
  "branchId": "branch_123",
  "parentMessageId": "msg_001",
  "conversationId": "conv_123",
  "title": "Alternative"
}
```

---

## Monitoring

- branch_created_total
- branch_deleted_total
- branch_switch_total

---

## Testing

- Create branch with title
- List branches for conversation
- Switch active branch
- Delete branch (cascades messages)

---

## Performance

- Create: < 100ms
- List: < 200ms
- Switch: < 50ms

---

**Status:** Complete
