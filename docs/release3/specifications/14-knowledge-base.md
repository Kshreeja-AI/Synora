# Knowledge Base Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Curated, searchable repository of prompts, templates, FAQs, and best practices. Enables users to discover, reuse, and share knowledge across workspace.

---

## Database

Uses existing Prompt and Template tables. No new tables, but adds:

```prisma
model KnowledgeArticle {
  id String @id @default(cuid())
  workspaceId String
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  title String
  content String          // markdown
  category String         // "guide", "troubleshooting", "best-practice"
  tags String[] @default([])
  
  isPublic Boolean @default(true)
  isFeatured Boolean @default(false)
  
  views Int @default(0)
  rating Float @default(0)
  
  createdBy String
  creator User @relation(fields: [createdBy], references: [id])
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([workspaceId])
  @@index([category])
  @@index([isFeatured])
}

model SavedPrompt {
  id String @id @default(cuid())
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  promptId String
  prompt Prompt @relation(fields: [promptId], references: [id], onDelete: Cascade)
  
  savedAt DateTime @default(now())
  
  @@unique([userId, promptId])
  @@index([userId])
}
```

---

## Service Layer

```typescript
class KnowledgeBaseService {
  async getPopularPrompts(
    workspaceId: string,
    limit: number = 10
  ): Promise<Prompt[]>
  
  async getFeaturedTemplates(workspaceId: string): Promise<Template[]>
  
  async searchKnowledge(
    workspaceId: string,
    query: string,
    category?: string
  ): Promise<(Prompt | Template | KnowledgeArticle)[]>
  
  async createArticle(
    userId: string,
    workspaceId: string,
    input: {
      title: string;
      content: string;
      category: string;
      tags?: string[];
    }
  ): Promise<KnowledgeArticle>
  
  async savePrompt(
    userId: string,
    promptId: string
  ): Promise<SavedPrompt>
  
  async getSavedPrompts(userId: string): Promise<Prompt[]>
  
  async incrementViews(contentId: string): Promise<void>
}
```

---

## API

```
GET /api/workspaces/:id/knowledge/prompts/popular
Response 200: { items: Prompt[], total }

GET /api/workspaces/:id/knowledge/templates/featured
Response 200: { items: Template[] }

GET /api/workspaces/:id/knowledge/search?q=authentication&category=guide
Response 200: { prompts: [], templates: [], articles: [] }

POST /api/workspaces/:id/knowledge/articles
Body: { title, content, category, tags }
Response 201: KnowledgeArticle

GET /api/workspaces/:id/knowledge/articles/:articleId
Response 200: KnowledgeArticle

POST /api/users/me/saved-prompts/:promptId
Response 201: SavedPrompt

GET /api/users/me/saved-prompts
Response 200: { items: Prompt[] }
```

---

## Validation

- Article title 1-200 chars
- Content 1-50K chars (markdown)
- Category in enum
- Tags 0-10 per article
- Rating 0-5

---

## Permissions

- Any workspace member can view knowledge base
- Member+ can create articles
- Editor+ can feature articles
- Admin can manage all content
- Users can only see articles matching their workspace

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid content format | Return validation error |
| 403 | Not authorized to create | Show permission error |
| 404 | Article not found | Already deleted |
| 409 | Duplicate article | Merge or rename |

---

## Logging

```json
{
  "action": "article_created",
  "articleId": "art_123",
  "title": "API Authentication",
  "userId": "user_123",
  "workspaceId": "ws_123"
}
```

---

## Monitoring

- articles_created_total{workspace_id}
- articles_viewed_total{article_id}
- prompts_saved_total{user_id}
- knowledge_search_requests_total
- popular_prompts{rank}
- featured_templates{rank}

---

## Testing

- Create article
- Search knowledge base
- Get popular prompts
- Save/unsave prompt
- View increment
- Rating aggregation
- Cross-workspace isolation

---

## Performance

- Cache popular prompts (1-hour TTL)
- Cache featured templates (1-hour TTL)
- Denormalize views count
- Index on (workspaceId, category)
- Full-text search via Elasticsearch

---

## Security

- JWT required for writes
- Workspace membership enforced
- No PII in article titles
- Rate limit: 10 articles/hour per user
- Audit log all article creation/updates

---

## Scalability

- Support 10K+ articles per workspace
- Search via Elasticsearch (indexed)
- Cache layer for popular content
- Batch indexing for new articles

---

## Content Guidelines

**Article Categories:**
- Guides: step-by-step instructions
- Troubleshooting: common issues + solutions
- Best practices: recommendations + examples
- Case studies: real-world examples
- Templates: starter content

**Moderation:**
- Avoid duplicate articles
- Link related content
- Keep titles descriptive
- Use consistent tags

---

**Status:** Complete
