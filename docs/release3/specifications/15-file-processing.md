# File Processing Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Handles file uploads to S3, virus scanning, storage management, and lifecycle policies. Supports document, image, audio, and video uploads with automatic cleanup.

---

## Database

Uses existing ConversationFile table. No new tables.

---

## Service Layer

```typescript
class FileProcessingService {
  async uploadFile(
    conversationId: string,
    userId: string,
    file: Express.Multer.File,
    options?: {
      viral_scan?: boolean;
      generate_thumbnail?: boolean;
    }
  ): Promise<ConversationFile>
  
  async scanFileForViruses(filePath: string): Promise<{
    safe: boolean;
    threats?: string[];
  }>
  
  async generateThumbnail(
    fileKey: string,
    mimeType: string
  ): Promise<string>  // returns thumbnail S3 key
  
  async getDownloadUrl(
    userId: string,
    fileId: string,
    expiresIn: number = 3600
  ): Promise<string>  // presigned URL
  
  async deleteFile(
    userId: string,
    fileId: string
  ): Promise<void>
  
  async archiveOldFiles(days: number = 30): Promise<number>
  // Nightly job: soft-delete files older than N days
  
  async hardDeleteArchivedFiles(days: number = 60): Promise<number>
  // Monthly job: permanently delete archived files from S3
}
```

---

## S3 Configuration

```typescript
{
  bucket: 'synora-uploads',
  region: 'us-east-1',
  
  key_format: 'conversations/{workspaceId}/{conversationId}/{timestamp}-{randomId}-{filename}',
  
  lifecycle: {
    rules: [
      {
        id: 'archive-old-uploads',
        prefix: 'conversations/',
        days: 30,
        action: 'TRANSITION_TO_GLACIER'
      },
      {
        id: 'delete-archived',
        prefix: 'conversations/',
        days: 90,
        action: 'DELETE'
      }
    ]
  },
  
  cors: {
    allowed_origins: ['https://synora.ai', 'https://app.synora.ai'],
    allowed_methods: ['GET', 'PUT', 'DELETE'],
    allowed_headers: ['*']
  },
  
  encryption: 'AES-256'
}
```

---

## Supported File Types

| Category | MIME Types | Max Size |
|----------|-----------|----------|
| Images | image/png, image/jpeg, image/gif, image/webp | 50MB |
| Documents | application/pdf, application/msword, text/plain | 100MB |
| Audio | audio/mpeg, audio/wav, audio/ogg | 500MB |
| Video | video/mp4, video/webm | 1GB |
| Archive | application/zip, application/x-rar | 500MB |

**Blocked Types:** exe, bat, sh, scr, com, pif, jar, app, deb, rpm

---

## Upload Flow

1. User selects file
2. Frontend validates (size, type, extension)
3. Request presigned PUT URL from backend
4. Frontend uploads to S3 directly
5. Backend receives upload notification (S3 event)
6. Spawn virus scan job (async)
7. Generate thumbnail if image
8. Index in database
9. Notify user (success/error)

---

## Virus Scanning

**Provider:** ClamAV (open-source, self-hosted)

```typescript
{
  enabled: true,
  engine: 'clamav',
  timeout: 60000,        // 60 seconds
  retry_attempts: 3,
  quarantine_on_threat: true
}
```

**Scanning Strategy:**
1. Queue file for scanning (async)
2. Download from S3 to temp storage
3. Run ClamAV scan
4. If threat found: quarantine, notify admin, delete from active storage
5. If clean: mark as scanned, move to production path
6. Clean up temp files

---

## API

```
POST /api/workspaces/:id/conversations/:conversationId/files
Body: multipart/form-data { file }
Response 201: {
  id,
  fileName,
  fileSize,
  mimeType,
  storageKey,
  url,
  uploadedAt
}

GET /api/workspaces/:id/conversations/:conversationId/files/:fileId/download
Response 302: redirect to presigned S3 URL (1-hour expiry)

DELETE /api/workspaces/:id/conversations/:conversationId/files/:fileId
Response 200: { success: true }

GET /api/workspaces/:id/conversations/:conversationId/files/:fileId/thumbnail
Response 302: redirect to S3 thumbnail URL
```

---

## Validation

- File size: 1 byte - 1 GB
- MIME type in whitelist
- Filename: 1-255 chars, no null bytes
- Max 100 files per conversation
- Prevent path traversal attacks (no ../)

---

## Permissions

- Conversation creator can upload/delete
- Other members can download if conversation accessible

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 413 | File too large | Show size limit, suggest compression |
| 415 | Unsupported type | Show accepted formats |
| 503 | S3 unavailable | Queue for retry, show message |
| 500 | Virus scan failed | Quarantine file, notify admin |
| 404 | File not found | Already deleted |

---

## Retry Strategy

- Upload failures: exponential backoff (1s, 2s, 4s, 8s), max 5
- Virus scan: exponential backoff, max 3 attempts
- S3 operations: built-in exponential backoff (AWS SDK)
- Presigned URL generation: retry after 1s

---

## Logging

```json
{
  "action": "file_uploaded",
  "fileId": "file_123",
  "fileName": "diagram.png",
  "fileSize": 102400,
  "mimeType": "image/png",
  "virusScan": "passed",
  "conversationId": "conv_123",
  "userId": "user_123",
  "duration_ms": 1200
}
```

---

## Monitoring

- files_uploaded_total{workspace_id, mimeType}
- file_upload_size_bytes{percentile}
- file_upload_duration_ms{percentile}
- virus_scan_requests_total{result}
- virus_scan_duration_ms{percentile}
- s3_errors_total{error_type}
- files_archived_total
- files_deleted_total
- storage_used_bytes{workspace_id}

---

## Testing

- Upload image file
- Upload oversized file (rejected)
- Upload unsupported type (rejected)
- Virus scan passes
- Virus scan quarantines threat
- Download file via presigned URL
- Delete file
- Thumbnail generation
- Archive old files (30-day job)
- Hard delete archived (60-day job)

---

## Performance

- Upload latency: <5s for 100MB file
- Presigned URL generation: <100ms
- Virus scan: <60s per file
- Thumbnail generation: <2s for images
- Parallel uploads: 10 concurrent per user
- Batch cleanup: delete 1000 files/min

---

## Security

- JWT required for upload/download
- Workspace membership enforced
- HTTPS only (no http://)
- S3 bucket encryption (AES-256)
- Virus scanning mandatory for all uploads
- Presigned URLs expire after 1 hour
- No file listing (prevent enumeration)
- Rate limiting: 100 uploads/hour per user
- IP whitelisting for ClamAV server

---

## Scalability

- S3 auto-scales (no limit)
- Multi-part upload for >100MB files
- CloudFront CDN for downloads
- Batch virus scanning (queue workers)
- Lifecycle policies (auto-archive after 30 days)
- Support 1M+ files per workspace

---

## Cost Optimization

- S3 Standard → Glacier transition after 30 days
- Delete from Glacier after 90 days
- CloudFront for popular files
- Lifecycle policies to minimize storage
- Monitor S3 usage monthly

---

## Storage Retention Policy

| Age | Action | Duration |
|-----|--------|----------|
| 0-30 days | S3 Standard | Active storage |
| 30-60 days | S3 Glacier | Cold storage |
| 60+ days | Delete | Permanent removal |

---

## Future Enhancements

- Video transcoding (auto-generate formats)
- Document OCR (extract text from PDFs)
- Image tagging (ML-based categorization)
- Compression (auto-compress images/PDFs)
- Deduplication (detect duplicate uploads)
- Watermarking (add workspace branding)

---

**Status:** Complete
