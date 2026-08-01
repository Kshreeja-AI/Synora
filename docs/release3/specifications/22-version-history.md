# Version History Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Track message edit history with full diffs. Users can view what changed, when, and by whom. Enables conversation auditing and reverting to previous versions.

---

## Database

```prisma
model MessageVersion {
  id String @id @default(cuid())
  messageId String
  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)
  
  // Version tracking
  version Int                // 1, 2, 3, ...
  content String             // full content at this version
  
  // Diff from previous
  diff String?               // unified diff format (optional)
  
  // Audit
  editedBy String
  editedByUser User @relation(fields: [editedBy], references: [id])
  editedAt DateTime @default(now())
  
  // Reason for edit
  editReason String?         // "fix typo", "clarification", etc.
  
  @@index([messageId, version])
  @@index([messageId, editedAt])
  @@index([editedBy])
}

model PromptVersion {
  // Tracks prompt library versions
  id String @id @default(cuid())
  promptId String
  prompt Prompt @relation(fields: [promptId], references: [id], onDelete: Cascade)
  
  version Int
  content String
  diff String?
  
  editedBy String
  editedByUser User @relation(fields: [editedBy], references: [id])
  editedAt DateTime @default(now())
  
  @@index([promptId, version])
}
```

---

## Service Layer

```typescript
class VersionHistoryService {
  async createVersion(
    messageId: string,
    newContent: string,
    editedBy: string,
    editReason?: string
  ): Promise<MessageVersion>
  // Called when message is edited
  
  async getMessageVersions(
    messageId: string
  ): Promise<MessageVersion[]>
  // All versions in order
  
  async getVersion(versionId: string): Promise<MessageVersion>
  
  async getDiff(
    messageId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<{
    before: string;
    after: string;
    diff: string;
  }>
  
  async revertToVersion(
    userId: string,
    messageId: string,
    targetVersion: number
  ): Promise<Message>
  // Revert message to previous version (creates new version entry)
  
  async compareVersions(
    messageId: string,
    v1: number,
    v2: number
  ): Promise<{
    v1Content: string;
    v2Content: string;
    additions: string[];
    deletions: string[];
    changes: string[];
  }>
}
```

---

## API

```
GET /api/workspaces/:id/conversations/:conversationId/messages/:messageId/versions
Response 200: MessageVersion[]

GET /api/workspaces/:id/conversations/:conversationId/messages/:messageId/versions/:versionNumber
Response 200: MessageVersion

GET /api/workspaces/:id/conversations/:conversationId/messages/:messageId/versions/diff
Query: ?from=1&to=2
Response 200: {
  before,
  after,
  diff
}

POST /api/workspaces/:id/conversations/:conversationId/messages/:messageId/revert
Body: { toVersion: 1 }
Response 200: { success: true, message, newVersion }
```

---

## Diff Format

Uses unified diff format (standard patch format):

```
--- Version 1 (2026-07-28 14:30)
+++ Version 2 (2026-07-28 14:35)
@@ -1,5 +1,5 @@
 Here is how to authenticate
-using OAuth2.
+using OAuth2 or JWT.
 
 Choose based on your needs:
 
- OAuth2 is for mobile apps
+ OAuth2 is for mobile apps and web
```

---

## Validation

- Message must exist and be editable
- Content 1-50000 chars (same as message)
- Edit reason max 500 chars
- Version number must be valid
- User must have permission to view history

---

## Permissions

- Any member can view message history
- Message creator can edit own messages
- Admin can edit any messages
- Revert only by creator or admin

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid version number | Show available versions |
| 403 | Not authorized to revert | Show permission error |
| 404 | Message not found | Already deleted |
| 422 | Version mismatch | Refresh and try again |

---

## Logging

```json
{
  "action": "message_version_created",
  "messageId": "msg_123",
  "version": 2,
  "editedBy": "user_123",
  "editReason": "typo fix",
  "previousVersion": 1,
  "contentLength": 2450,
  "timestamp": "2026-07-28T14:35:00Z"
}
```

---

## Monitoring

- message_edits_total
- version_history_queries_total
- revert_operations_total
- version_storage_bytes{message_id}

---

## Testing

- Edit message creates new version
- Version history shows all edits
- Diff calculated correctly
- Revert to previous version
- Permission checks enforced
- Storage of long content

---

## Performance

- Create version: <50ms
- Fetch versions: <200ms
- Calculate diff: <100ms
- Revert: <100ms (creates new version)
- Store versions: no limit (compress old)

---

## Storage Optimization

- Compress old versions (>1 year)
- Archive deleted message versions
- Batch cleanup (monthly job)
- Support 100K+ versions per message (theoretically)

---

## UI Components

**Version Timeline:**
- List all versions with timestamp
- Show who edited and reason
- Visual diff highlight

**Diff Viewer:**
- Side-by-side comparison
- Unified view
- Syntax highlight changes
- Copy version button

**Revert Dialog:**
- Confirm revert action
- Show what will change
- Add reason for revert

---

## Security

- JWT required for all endpoints
- Workspace membership enforced
- Edit history immutable (append-only)
- Audit trail of reverts
- No sensitive data exposure

---

## Cascade Behavior

When message deleted:
- Keep versions (soft-delete only)
- After hard-delete, purge versions

---

## Future Enhancements

- Comments on specific versions
- Version annotations/labels
- Branching from old versions
- Version comparison mode
- Auto-save (track every keystroke)
- Collaborative editing (OT/CRDT)
- AI suggestions (revert bad edits)

---

**Status:** Complete
