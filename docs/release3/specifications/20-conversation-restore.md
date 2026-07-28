# Conversation Restore Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Restore conversations from soft-delete (archive) within the 30-day recovery window. Provides user-friendly recovery without data loss.

---

## Database

Uses Conversation model (isDeleted, deletedAt flags).

---

## Service Layer

```typescript
class RestoreService {
  async restoreConversation(
    userId: string,
    conversationId: string
  ): Promise<Conversation>
  // Restore from soft-delete: set isDeleted=false, clear deletedAt
  
  async getRestoreEligibility(
    conversationId: string
  ): Promise<{
    canRestore: boolean;
    deletedAt?: Date;
    recoveryUntil?: Date;
    daysRemaining?: number;
  }>
  
  async batchRestore(
    userId: string,
    conversationIds: string[]
  ): Promise<{
    restored: number;
    failed: number;
    errors?: { id: string; reason: string }[];
  }>
}
```

---

## API

```
POST /api/workspaces/:id/conversations/:conversationId/restore
Response 200: {
  success: true,
  conversationId,
  isDeleted: false,
  messageCount,
  restoredAt
}

GET /api/workspaces/:id/conversations/:conversationId/restore-eligibility
Response 200: {
  canRestore: true,
  deletedAt: "2026-07-25T14:30:00Z",
  recoveryUntil: "2026-08-24T14:30:00Z",
  daysRemaining: 27
}

POST /api/workspaces/:id/conversations/batch-restore
Body: { conversationIds: ["conv_123", "conv_456"] }
Response 200: {
  restored: 2,
  failed: 0
}

GET /api/workspaces/:id/conversations?deleted=true&recoveryWindow=true
Query: ?skip=0&take=20
Response 200: {
  items: [{
    id,
    title,
    deletedAt,
    recoveryUntil,
    messageCount,
    canRestore: true
  }],
  total,
  recoveryDeadline
}
```

---

## Restore Flow

1. **User navigates to deleted conversations**
2. **System shows recovery window** (days remaining)
3. **User clicks "Restore"**
4. **Validation:**
   - Conversation exists and is deleted
   - Within 30-day window
   - User has permission
5. **Restoration:**
   - Set isDeleted=false
   - Clear deletedAt
   - Restore to conversation list
   - Restore to search index (Elasticsearch)
   - Restore embeddings (vector DB)
   - Cache in Redis
6. **Confirmation message** ("Conversation restored successfully")

---

## Validation

- Conversation must be soft-deleted (isDeleted=true)
- Within 30-day recovery window (now - deletedAt < 30 days)
- User has permission (owner/admin)
- All related data still intact

---

## Permissions

- Conversation creator: can restore own
- Admin: can restore any
- Others: cannot restore

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Not deleted | Already active |
| 403 | Not authorized | Show permission error |
| 404 | Not found | Already hard-deleted |
| 410 | Recovery expired | >30 days old, cannot restore |
| 409 | Conflict | Restore in progress (idempotent) |

---

## Retry Strategy

- No retry needed (idempotent operation)
- If fails: retry manually (user triggered)

---

## Logging

```json
{
  "action": "conversation_restored",
  "conversationId": "conv_123",
  "restoredAt": "2026-07-28T14:30:00Z",
  "wasDeletedFor": "3 days",
  "messageCount": 25,
  "userId": "user_123"
}
```

---

## Monitoring

- conversations_restored_total{workspace_id}
- restoration_success_rate
- restoration_duration_ms
- recovery_window_usage (% restored before expiry)
- restoration_failures_total{reason}

---

## Testing

- Restore deleted conversation
- Restore with invalid ID (404)
- Restore expired conversation (>30 days)
- Batch restore multiple
- Permission checks
- Data integrity after restore
- Search results reappear
- Embeddings reindexed

---

## Performance

- Single restore: <200ms
- Batch restore (100): <5s
- Elasticsearch reindex: <500ms
- Vector DB restore: <300ms

---

## Security

- JWT required
- Workspace membership enforced
- Owner/admin only
- Audit log all restores
- No data exposure

---

## Cascade Restoration

When conversation restored:

1. Set isDeleted=false, clear deletedAt
2. Reindex in Elasticsearch
3. Restore embeddings in vector DB
4. Invalidate cache (triggers refresh)
5. Messages become searchable again
6. Conversation appears in lists

---

## User Experience

**Deleted Conversations Page:**
- Show list of deleted conversations
- Display "Recovery expires in X days"
- Show "Restore" button (if within window)
- Show "Permanently delete" button (for users who want instant deletion)
- Sort by deletion date (newest first)

**Recovery Expiry Warning:**
- When < 7 days remaining: show yellow warning
- When < 1 day remaining: show red warning
- Suggest restore or permanent delete

---

## Recovery Statistics

**Dashboard Display:**
- % of deleted conversations restored
- Average recovery time to action
- Conversations at risk (< 7 days left)
- Hard-delete schedule

---

## Future Enhancements

- Email notification (7 days before expiry)
- Auto-restore (user preference for undo)
- Extended recovery (pay for >30 days)
- Partial restore (specific messages/time range)
- Pre-deletion backup (email before delete)
- Admin approval workflow (for restore)

---

**Status:** Complete
