# Template Library Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Pre-built conversation starters with system prompt and initial message suggestions.

---

## Database

```prisma
model Template {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  title String
  description String?
  category String // "writing", "analysis", "coding"
  
  systemPrompt String
  initialUserMessage String?
  suggestedFollowUps String[]
  
  createdBy String
  creator User @relation(name: "CreatedTemplates", fields: [createdBy], references: [id])
  isPublic Boolean @default(false)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([workspaceId])
  @@index([category])
}
```

---

## Service Layer

```typescript
class TemplateService {
  async createTemplate(
    userId: string,
    workspaceId: string,
    input: CreateTemplateInput
  ): Promise<Template>

  async listTemplates(
    userId: string,
    workspaceId: string,
    category?: string
  ): Promise<Template[]>

  async useTemplate(
    userId: string,
    workspaceId: string,
    templateId: string
  ): Promise<Conversation>  // Creates new conversation with template

  async updateTemplate(
    userId: string,
    templateId: string,
    input: Partial<CreateTemplateInput>
  ): Promise<Template>

  async deleteTemplate(
    userId: string,
    templateId: string
  ): Promise<void>
}
```

---

## API

```
POST /api/workspaces/:workspaceId/templates
Request: { title, description, category, systemPrompt, initialUserMessage, suggestedFollowUps }
Response 201: Template

GET /api/workspaces/:workspaceId/templates?category=coding
Response 200: { items: Template[] }

POST /api/workspaces/:workspaceId/templates/:templateId/use
Response 201: Conversation (with system message from template)

PATCH /api/workspaces/:workspaceId/templates/:templateId
Request: { description, ... }
Response 200: Template

DELETE /api/workspaces/:workspaceId/templates/:templateId
Response 200: { success: true }
```

---

## Validation

- Title required
- Category in enum
- systemPrompt 1-10K chars

---

## Permissions

- Creator/Admin can edit own/all
- Others can read if public

---

**Status:** Complete
