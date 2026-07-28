# Prompt Library Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

User prompts: create, store, version, share, rate. Enables prompt reuse across conversations.

---

## Database

```prisma
model Prompt {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  title String
  content String  // The prompt text
  category String? // "creative", "analysis", "coding"
  tags String[] @default([])
  
  createdBy String
  creator User @relation(name: "CreatedPrompts", fields: [createdBy], references: [id])
  isPublic Boolean @default(false)
  
  usage Int @default(0)
  rating Float @default(0)
  
  version Int @default(1)
  parentId String?
  parent Prompt? @relation(name: "PromptVersions", fields: [parentId], references: [id])
  children Prompt[] @relation(name: "PromptVersions")
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([workspaceId])
  @@unique([workspaceId, title])
}
```

---

## Service Layer

```typescript
class PromptService {
  async createPrompt(
    userId: string,
    workspaceId: string,
    input: { title; content; category?; tags?; isPublic? }
  ): Promise<Prompt>

  async listPrompts(
    userId: string,
    workspaceId: string,
    filters?: { category?; isPublic?; search? }
  ): Promise<Prompt[]>

  async updatePrompt(
    userId: string,
    promptId: string,
    input: { content; category?; tags?; isPublic? }
  ): Promise<Prompt>  // Creates new version

  async deletePrompt(
    userId: string,
    promptId: string
  ): Promise<void>

  async ratePrompt(
    userId: string,
    promptId: string,
    rating: number  // 1-5
  ): Promise<Prompt>

  async incrementUsage(promptId: string): Promise<void>
}
```

---

## API

```
POST /api/workspaces/:workspaceId/prompts
{ "title": "...", "content": "...", "category": "coding", "tags": [...], "isPublic": false }
Response 201: Prompt

GET /api/workspaces/:workspaceId/prompts?category=coding&search=api
Response 200: { items: Prompt[], total }

PATCH /api/workspaces/:workspaceId/prompts/:promptId
{ "content": "...", "category": "..." }
Response 200: Prompt (new version, parentId set)

DELETE /api/workspaces/:workspaceId/prompts/:promptId
Response 200: { success: true }

POST /api/workspaces/:workspaceId/prompts/:promptId/rate
{ "rating": 5 }
Response 200: Prompt
```

---

## Validation

- Title 1-100 chars, unique per workspace
- Content 1-10K chars
- Category in whitelist
- Rating 1-5

---

## Permissions

- Creator: read/write own
- ADMIN: read/write all
- Other workspace members: read if isPublic

---

## Logging

```json
{ "action": "prompt_created", "promptId": "...", "title": "..." }
{ "action": "prompt_used", "promptId": "..." }
```

---

## Monitoring

- prompts_created_total
- prompt_usage_total{promptId}
- prompt_rating_avg{promptId}

---

## Testing

- Create/list/update/delete prompts
- Versioning (update creates new version)
- Rating aggregation
- Public/private filtering

---

**Status:** Complete
