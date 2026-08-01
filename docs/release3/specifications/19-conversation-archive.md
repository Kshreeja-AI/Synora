# Conversation Archive Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Archive conversations to reduce clutter. Archived conversations are soft-deleted (hidden from UI), retained in database for 30 days, then hard-deleted with full data destruction.

---

## Database

Uses Conversation model:

```prisma
model Conversation {
  // ... existing fields ...
  
  isArchived Boolean @default(false)
  archivedAt DateTime?
  
  isDeleted Boolean @default(false)
  deletedAt DateTime?
  
  // When soft-deleted, set isDeleted=true + deletedAt=now
  // Hard-delete happens 30 days after deletedAt via nightly job
}
```

---

## Service Layer

```typescript
class ArchiveService {
  async archiveConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation>
  // Soft-delete: set isArchived=true, archivedAt=now
  
  async unarchiveConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation>
  // Restore: set isArchived=false, clear archivedAt
  
  async deleteConversation(
    userId: string,
    conversationId: string
  ): Promise<void>
  // Soft-delete: set isDeleted=true, deletedAt=now
  
  async restoreConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation>
  // Restore from soft-delete: set isDeleted=false, clear deletedAt
  
  async listArchived(
    workspaceId: string,
    skip: number = 0,
    take: number = 20
  ): Promise<{
    items: Conversation[];
    total: number;
    hasMore: boolean;
  }>
  
  async listDeleted(
    userId: string,
    skip: number = 0,
    take: number = 20
  ): Promise<{
    items: Conversation[];
    total: number;
    daysUntilHardDelete: number[];
  }>
  
  async hardDeleteExpired(): Promise<number>
  // Nightly job: delete conversations where deletedAt < 30 days ago
  
  async getArchiveStats(workspaceId: string): Promise<{
    archivedCount: number;
    deletedCount: number;
    oldestDeletedAt: Date;
    recoveryDeadline: Date;
  }>
}
```

---

## API

```
PATCH /api/workspaces/:id/conversations/:conversationId/archive
Response 200: { success: true, isArchived: true, archivedAt }

PATCH /api/workspaces/:id/conversations/:conversationId/unarchive
Response 200: { success: true, isArchived: false }

DELETE /api/workspaces/:id/conversations/:conversationId
Response 200: { success: true, isDeleted: true, deletedAt, recoveryUntil }

GET /api/workspaces/:id/conversations/archived
Query: ?skip=0&take=20
Response 200: { items: Conversation[], total, hasMore }

GET /api/workspaces/:id/conversations/deleted
Query: ?skip=0&take=20
Response 200: {
  items: [{
    id,
    title,
    deletedAt,
    recoveryUntil,
    messageCount
  }],
  total,
  recoveryDeadline
}

POST /api/workspaces/:id/conversations/:conversationId/restore
Response 200: { success: true, isDeleted: false }

GET /api/workspaces/:id/archive/stats
Response 200: {
  archivedCount: 15,
  deletedCount: 3,
  oldestDeletedAt: "2026-06-28T...",
  recoveryDeadline: "2026-07-28T..."
}
```

---

## Archive Lifecycle

**Active → Archived:**
1. User clicks "Archive"
2. Set isArchived=true, archivedAt=now
3. Hide from conversation list
4. Keep all data intact
5. Still searchable (optional)

**Archived → Active:**
1. User clicks "Restore"
2. Set isArchived=false, clear archivedAt
3. Reappear in conversation list
4. No data loss

**Active → Deleted:**
1. User clicks "Delete"
2. Set isDeleted=true, deletedAt=now
3. Hide from UI (show in deleted folder)
4. Data retained for 30 days
5. Recoverable via "Restore"

**Deleted → Hard Delete (Automatic, Nightly):**
1. After 30 days, automatic hard-delete via job
2. Remove from PostgreSQL
3. Delete associated files from S3
4. Delete from Elasticsearch
5. Remove embeddings from vector DB
6. Purge from Redis cache
7. Permanent destruction (no recovery)

---

## Retention Policy

| State | Duration | Searchable | Accessible | Action |
|-------|----------|-----------|-----------|--------|
| Active | ∞ | Yes | Full | None |
| Archived | ∞ | Optional | Full | Can unarchive |
| Deleted (soft) | 30 days | No | Via deleted folder | Can restore or hard-delete |
| Deleted (hard) | 0 | No | No | Permanent |

---

## Validation

- Conversation must exist
- User must have permission (owner/admin)
- Already archived/deleted checks

---

## Permissions

- Conversation creator: can archive/delete own
- Admin: can archive/delete any
- Viewer: cannot archive/delete

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 403 | Not authorized | Show permission error |
| 404 | Conversation not found | Already deleted |
| 409 | Already archived | Show current state |
| 409 | Already deleted | Show recovery deadline |

---

## Logging

```json
{
  "action": "conversation_archived",
  "conversationId": "conv_123",
  "archivedAt": "2026-07-28T14:30:00Z",
  "messageCount": 25,
  "userId": "user_123"
}
```

---

## Monitoring

- archived_conversations_total{workspace_id}
- deleted_conversations_total
- hard_delete_jobs_total{status}
- conversations_restored_total
- deletion_recovery_rate (restored / deleted)

---

## Testing

- Archive conversation
- Unarchive conversation
- Delete conversation (soft)
- Restore from deletion
- Hard-delete (nightly job)
- Archive stats accurate
- Permissions enforced
- Cascade deletion (messages, files, etc.)

---

## Performance

- Archive: <100ms (just update flags)
- List archived: <500ms with index
- Hard-delete batch: 1000 conversations/min
- Cascade cleanup: async workers

---

## Security

- JWT required
- Workspace membership enforced
- Audit log all archive/delete/restore
- No PII in logs
- Deleted data encrypted until purge

---

## Scalability

- Soft-delete pattern avoids locking
- Batch hard-delete jobs (1000 at a time)
- Nightly retention cleanup (off-peak)
- Support 1M+ archived conversations per workspace

---

## Cascade Behavior

When conversation hard-deleted:

1. Delete all Message records (cascades via FK)
2. Delete all MessageBranch records
3. Delete all MessageAttachment records
4. Delete all ToolExecution records
5. Delete all ConversationFile records (trigger S3 delete)
6. Delete ConversationUsage record
7. Delete SharedConversation records
8. Remove from Elasticsearch index
9. Remove embeddings from vector DB
10. Invalidate Redis cache keys

---

## Recovery Window

**Soft-Delete Recovery:**
- Window: 30 days from deletion
- Action: Restore button in deleted folder
- Cost: Instant recovery (no overhead)
- Risk: Low (data never destroyed)

**After Hard-Delete:**
- Window: None (permanent)
- Recovery: Not possible (data destroyed)
- Recommendation: Backup/export before delete

---

## Future Enhancements

- Extended retention (pay to keep >30 days)
- Scheduled deletion (auto-delete in 7 days)
- Batch operations (select multiple, archive/delete)
- Retention policies (org-level deletion schedule)
- Backup before deletion (auto-export to email)
- Audit why deleted (required reason field)

---

**Status:** Complete
