# Export Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Export conversations to multiple formats (Markdown, JSON, PDF, HTML) for sharing, archival, and external use. Supports single conversations or batch exports.

---

## Database

No new tables. Uses ConversationFile for storing exports.

---

## Service Layer

```typescript
class ExportService {
  async exportConversation(
    conversationId: string,
    format: 'markdown' | 'json' | 'pdf' | 'html',
    options?: {
      includeAttachments?: boolean;
      includeMetadata?: boolean;
      dateFormat?: string;
    }
  ): Promise<Buffer>  // file content
  
  async scheduleExport(
    conversationId: string,
    format: string,
    sendTo?: string  // email address
  ): Promise<{ jobId: string }>
  
  async getExportStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'complete' | 'failed';
    progress?: number;
    downloadUrl?: string;
  }>
  
  async cancelExport(jobId: string): Promise<void>
}
```

---

## Export Formats

**Markdown (.md):**
```
# Conversation: How to implement authentication

Created: 2026-07-28 at 14:30 UTC
Creator: john@example.com
Messages: 15

---

## User (14:30)

How do I implement JWT authentication?

## Assistant (14:31)

JWT (JSON Web Token) authentication works by...

[token counts]
Input: 45 | Output: 120

---
```

**JSON (.json):**
```json
{
  "format": 1,
  "conversation": {
    "id": "conv_123",
    "title": "How to implement authentication",
    "createdAt": "2026-07-28T14:30:00Z",
    "createdBy": "john@example.com",
    "description": "...",
    "metadata": {
      "messageCount": 15,
      "totalTokens": 8900
    }
  },
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "How do I implement JWT authentication?",
      "createdAt": "2026-07-28T14:30:00Z",
      "tokens": { "input": 10, "output": 0 }
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "JWT authentication works by...",
      "createdAt": "2026-07-28T14:31:00Z",
      "tokens": { "input": 35, "output": 120 }
    }
  ]
}
```

**PDF (.pdf):**
- Header with conversation metadata
- Messages in chronological order
- Syntax highlighting for code blocks
- Page breaks between sections
- Footer with page numbers
- Watermark with export timestamp

**HTML (.html):**
- Self-contained (no external scripts)
- Dark/light theme support
- Responsive design
- Copy-to-clipboard buttons
- Print-friendly styling

---

## API

```
POST /api/workspaces/:id/conversations/:conversationId/export
Body: { format: "markdown", includeAttachments: true }
Response 200: Binary file (with Content-Disposition header)
  OR
Response 202: { jobId: "export_456", status: "processing" }

GET /api/workspaces/:id/exports/:jobId/status
Response 200: { status, progress, downloadUrl }

GET /api/workspaces/:id/exports/:jobId/download
Response 302: redirect to S3 presigned URL

POST /api/workspaces/:id/exports/:jobId/cancel
Response 200: { success: true }

GET /api/workspaces/:id/exports
Query: ?limit=50&offset=0
Response 200: { items: Export[], total }
```

---

## Export Job Model

```prisma
model ConversationExport {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  format String         // "markdown", "json", "pdf", "html"
  status String         // enum: PENDING, PROCESSING, COMPLETE, FAILED
  
  fileName String       // "conversation_title_2026-07-28.pdf"
  fileSize Int?         // bytes
  storageKey String?    // S3 key
  downloadUrl String?   // presigned URL
  
  progress Int @default(0)  // 0-100
  errorMessage String?
  
  requestedBy String
  requestedByUser User @relation(fields: [requestedBy], references: [id])
  
  expiresAt DateTime    // 7-day retention
  completedAt DateTime?
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([status])
  @@index([requestedBy])
}
```

---

## Validation

- Format in enum (markdown, json, pdf, html)
- Conversation exists and user has access
- Max 1000 messages per export
- Max 100MB file size

---

## Permissions

- Conversation creator can export own
- Admin can export any
- Shared users can export if permission is MANAGE

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid format | Show supported formats |
| 400 | Conversation too large | Split into multiple exports |
| 404 | Export not found | Job expired |
| 500 | PDF generation failed | Retry as JSON/Markdown |
| 503 | S3 unavailable | Queue for later |

---

## Retry Strategy

- Generation failures: exponential backoff, max 3 attempts
- Upload to S3: exponential backoff
- Presigned URL generation: retry after 1s

---

## Export Flow

1. **Immediate** (< 2s): Return file for markdown/JSON
2. **Queued** (> 2s): Return 202 with jobId, spawn async task
3. **Processing:** Update progress (100 messages = 20%)
4. **Complete:** Upload to S3, generate presigned URL
5. **Expiration:** Auto-delete after 7 days

---

## Logging

```json
{
  "action": "conversation_exported",
  "exportId": "export_456",
  "conversationId": "conv_123",
  "format": "pdf",
  "fileSize": 2048000,
  "status": "complete",
  "duration_ms": 5000,
  "userId": "user_123"
}
```

---

## Monitoring

- exports_requested_total{format, status}
- export_generation_duration_ms{format, percentile}
- export_file_size_bytes{format}
- export_errors_total{error_type}
- exports_pending_count

---

## Testing

- Export markdown format
- Export JSON format
- Export PDF format
- Export HTML format
- Include attachments option
- Batch export 100+ messages
- Cancel in-progress export
- Download presigned URL
- Export expires after 7 days
- Permission checks

---

## Performance

- Markdown: <500ms for 1K messages
- JSON: <500ms for 1K messages
- PDF: <5s for 1K messages (async)
- HTML: <2s for 1K messages

---

## Security

- JWT required
- Workspace membership enforced
- Presigned URLs expire after 1 hour
- No PII in export filenames
- Audit log all exports
- Rate limiting: 10 exports/hour per user

---

## Scalability

- Background workers for async exports
- S3 for storage (no size limit)
- Batch processing (100 conversations/job)
- Support 1M+ exports per workspace

---

## Storage & Cleanup

- Presigned URLs valid: 1 hour
- File retention: 7 days
- Auto-delete via nightly job
- Archive to Glacier after 30 days

---

## Future Enhancements

- Email delivery (send export to email)
- Scheduled exports (daily/weekly)
- Batch exports (multiple conversations)
- Custom formatting (themes, branding)
- Video export (screen recording with chat)
- DOCX export (Microsoft Word format)

---

**Status:** Complete
