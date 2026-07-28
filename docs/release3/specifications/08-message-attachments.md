# Message Attachments Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Message attachments enable users to reference files, images, and external resources within conversation messages. Supports inline images, linked documents, and references to uploaded files.

---

## Database

```prisma
model MessageAttachment {
  id String @id @default(cuid())
  messageId String
  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  
  // Content metadata
  url String            // S3 URL, embed URL, or external link
  mimeType String       // "image/png", "application/pdf", etc.
  name String           // "diagram.png"
  size Int              // bytes
  
  // Storage metadata
  isEmbedded Boolean @default(false)  // inline (base64) or linked
  storageKey String?    // S3 key if uploaded
  
  // Indexing
  alt String?           // accessibility text
  description String?   // for screen readers
  
  createdAt DateTime @default(now())
  
  @@index([messageId])
  @@index([storageKey])
}

model ConversationFile {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  fileName String
  mimeType String
  fileSize Int
  
  // Storage
  storageKey String     // S3 object key
  isArchived Boolean @default(false)
  
  uploadedBy String
  uploadedByUser User @relation(fields: [uploadedBy], references: [id])
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([uploadedBy])
}
```

---

## Service Layer

```typescript
class AttachmentService {
  async attachToMessage(
    messageId: string,
    attachment: {
      url: string;
      mimeType: string;
      name: string;
      size: number;
      isEmbedded?: boolean;
    }
  ): Promise<MessageAttachment>
  
  async listAttachments(messageId: string): Promise<MessageAttachment[]>
  
  async deleteAttachment(
    userId: string,
    attachmentId: string
  ): Promise<void>
  
  async uploadFile(
    conversationId: string,
    userId: string,
    file: Express.Multer.File
  ): Promise<ConversationFile>
  
  async processImage(
    file: Buffer,
    mimeType: string
  ): Promise<{ thumbnail: Buffer; resized: Buffer }>
}
```

---

## API

```
POST /api/workspaces/:id/conversations/:conversationId/messages/:messageId/attachments
Body: { url, mimeType, name, size, alt, description }
Response 201: MessageAttachment

GET /api/workspaces/:id/conversations/:conversationId/messages/:messageId/attachments
Response 200: MessageAttachment[]

DELETE /api/workspaces/:id/conversations/:conversationId/messages/:messageId/attachments/:attachmentId
Response 200: { success: true }

POST /api/workspaces/:id/conversations/:conversationId/files
Body: multipart/form-data { file }
Response 201: { id, fileName, storageKey, url, size }

GET /api/workspaces/:id/conversations/:conversationId/files/:fileId/download
Response 302: redirect to S3 presigned URL
```

---

## Validation

- URL format (http/https or data URI for embedded)
- MIME type whitelist (images, documents, audio, video)
- File size max 100MB per file
- Alt text max 500 chars
- Max 10 attachments per message
- Supported formats: PNG, JPG, GIF, PDF, MP3, MP4, WEBP, SVG

---

## Permissions

- Message creator can add/remove own attachments
- Other members can view if message is accessible
- Conversation creator can manage all attachments

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid URL format | Return validation error |
| 413 | File too large | Show user size limit |
| 415 | Unsupported MIME type | Show accepted formats |
| 404 | Attachment not found | Already deleted |
| 500 | Upload to S3 failed | Retry with exponential backoff |

---

## Retry Strategy

- Idempotent by design (attach operation with URL is idempotent)
- Upload failures: exponential backoff (1s, 2s, 4s, 8s), max 3 attempts
- S3 access: use presigned URLs (not direct S3)
- Cleanup: mark as archived on delete, hard-delete after 30 days

---

## Logging

```json
{
  "action": "attachment_added",
  "messageId": "msg_123",
  "attachmentId": "att_456",
  "mimeType": "image/png",
  "size": 102400,
  "userId": "user_123",
  "requestId": "req_789"
}
```

---

## Monitoring

- attachments_created_total
- attachment_size_bytes{mimeType}
- attachment_upload_duration_ms
- attachment_errors_total{error_type}
- attachment_storage_used_bytes{conversationId}

---

## Testing

- Attach image to message
- Fetch message attachments
- Delete attachment
- Upload file (multipart)
- Presigned URL works
- Attachment persists across sessions
- Large file rejection

---

## Performance

- Lazy load thumbnails
- Image resizing (generate small/medium/large variants)
- Batch delete (cascade on message delete)
- Index on messageId for fast lookup
- S3 multipart upload for large files

---

## Security

- JWT required for all operations
- File type validation (MIME type + magic bytes)
- Virus scanning via ClamAV (async)
- URL validation (prevent SSRF via whitelisting)
- No executable types (exe, sh, bat, etc.)
- Presigned URLs expire after 1 hour
- Encrypted in transit (HTTPS)

---

## Scalability

- Horizontal: file storage (S3, CloudFront CDN)
- Vertical: image processing queue (async)
- Archive old attachments (>90 days) to cold storage
- Batch cleanup jobs (nightly)
- Support 1M attachments per workspace

---

**Status:** Complete
