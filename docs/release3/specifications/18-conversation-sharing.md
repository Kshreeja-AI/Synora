# Conversation Sharing Specification

**Version:** 1.0 | **Status:** Complete | **Last Updated:** 2026-07-28

## Overview

Share conversations with external users via invite links. Supports time-limited and permission-scoped access. No login required for shared link access.

---

## Database

Uses existing SharedConversation table.

```prisma
model SharedConversation {
  id String @id @default(cuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  
  // Invite token (single-use or multi-use)
  inviteToken String @unique @default(cuid())
  inviteExpiresAt DateTime?
  maxUses Int?          // null = unlimited
  usesCount Int @default(0)
  
  // Permissions
  permission SharePermission  // enum: VIEW, EDIT, MANAGE
  
  // Sharing metadata
  sharedBy String
  sharedByUser User @relation(name: "SharedByMe", fields: [sharedBy], references: [id])
  
  sharedWith String?
  sharedWithUser User? @relation(name: "SharedWithMe", fields: [sharedWith], references: [id], onDelete: SetNull)
  
  // Tracking
  acceptedAt DateTime?
  
  createdAt DateTime @default(now())
  
  @@index([conversationId])
  @@index([inviteToken])
  @@index([sharedWith])
  @@index([inviteExpiresAt])
}

enum SharePermission {
  VIEW      // Read-only
  EDIT      // Add messages
  MANAGE    // Edit/delete all, manage sharing
}
```

---

## Service Layer

```typescript
class SharingService {
  async createShareLink(
    userId: string,
    conversationId: string,
    options: {
      permission: SharePermission;
      expiresIn?: string;  // "7d", "24h", null = forever
      maxUses?: number;
    }
  ): Promise<{
    inviteToken: string;
    inviteUrl: string;
    permission: SharePermission;
    expiresAt?: Date;
  }>
  
  async acceptShareLink(
    inviteToken: string,
    userId?: string  // optional (can be anonymous)
  ): Promise<{
    conversationId: string;
    permission: SharePermission;
    conversation?: Conversation
  }>
  
  async revokeShare(
    userId: string,
    shareId: string
  ): Promise<void>
  
  async listSharedWith(
    conversationId: string
  ): Promise<SharedConversation[]>
  
  async updateSharePermission(
    userId: string,
    shareId: string,
    permission: SharePermission
  ): Promise<SharedConversation>
  
  async validateAccessToken(
    conversationId: string,
    inviteToken: string,
    userId?: string
  ): Promise<{ valid: boolean; permission?: SharePermission }>
}
```

---

## API

```
POST /api/workspaces/:id/conversations/:conversationId/share
Body: { permission: "VIEW", expiresIn: "7d", maxUses: 100 }
Response 201: {
  inviteToken,
  inviteUrl: "https://synora.ai/share/abc123def456",
  permission,
  expiresAt
}

GET /api/public/share/:inviteToken
Query: ?userId=user_123 (optional)
Response 200: {
  conversationId,
  permission,
  conversation: { title, description, messageCount, ... }
}
OR 
Response 404: { error: "Share not found or expired" }

POST /api/public/share/:inviteToken/accept
Body: { userId?: "user_123" }
Response 201: {
  success: true,
  conversationId,
  permission,
  addedToLibrary: true
}

GET /api/workspaces/:id/conversations/:conversationId/shared
Response 200: { items: SharedConversation[] }

PATCH /api/workspaces/:id/conversations/:conversationId/shared/:shareId
Body: { permission: "EDIT" }
Response 200: SharedConversation

DELETE /api/workspaces/:id/conversations/:conversationId/shared/:shareId
Response 200: { success: true }
```

---

## Share Link Format

```
https://synora.ai/share/{inviteToken}
```

**Features:**
- No authentication required
- Includes share preview (metadata)
- One-click accept for logged-in users
- Login/signup flow for anonymous users

---

## Permissions Model

| Permission | List | Read | Add Msg | Edit Msg | Delete Msg | Share | Archive |
|-----------|------|------|---------|----------|-----------|-------|---------|
| VIEW | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| EDIT | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| MANAGE | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Validation

- Permission in enum (VIEW, EDIT, MANAGE)
- Expires in valid format (7d, 24h, 30d, null)
- Max uses > 0 or null
- Conversation exists and user owns

---

## Permissions

- Conversation creator can create shares
- Admin can create any shares
- Creator can revoke own shares
- Admin can revoke any shares

---

## Error Handling

| Code | Scenario | Recovery |
|------|----------|----------|
| 400 | Invalid permission | Show valid options |
| 403 | Not authorized to share | Show permission error |
| 404 | Share not found | Expired or invalid token |
| 404 | Conversation not found | Already deleted |
| 410 | Share expired | Generate new link |
| 429 | Max uses exceeded | Share link exhausted |

---

## Retry Strategy

- No retry needed (stateless operations)
- Link generation: idempotent (same options = same result within 1 hour)

---

## Logging

```json
{
  "action": "share_created",
  "shareId": "share_123",
  "conversationId": "conv_123",
  "permission": "VIEW",
  "expiresAt": "2026-08-04T14:30:00Z",
  "userId": "user_123"
}
```

---

## Monitoring

- shares_created_total{permission}
- shares_accepted_total
- shares_revoked_total
- public_access_requests_total
- public_access_denied_total{reason}
- shares_expired_total

---

## Testing

- Create share link with VIEW permission
- Accept share link (logged-in user)
- Accept share link (anonymous → signup)
- Revoke share link
- Expired share link rejected
- Max uses limit enforced
- Permission validation
- Cross-workspace isolation

---

## Performance

- Create share link: <100ms
- Accept share: <200ms (includes conversation fetch)
- Validate token: <50ms
- List shares: <300ms

---

## Security

- JWT not required for public share endpoints
- Invite tokens are random (CUID, 128-bit entropy)
- Tokens don't contain sensitive data
- Token never logged or exposed
- Time-limited (default 7 days)
- Use-limited (optional)
- One-time use option (maxUses=1)
- Rate limiting on public endpoints (100 req/min per IP)
- CORS restricted to synora.ai domain

---

## Anonymous Sharing Flow

1. Anonymous user visits share link
2. Sees conversation preview (title, description, message count)
3. Clicks "View Conversation"
4. Presented with login/signup
5. After auth, redirected to shared conversation
6. Conversation added to user's library
7. Access controlled by permission level

---

## Share Lifecycle

| Event | Duration | Action |
|-------|----------|--------|
| Created | immediate | Generate token, send email (optional) |
| Accepted | any | Record acceptance, add to user library |
| Expires | configurable (7d default) | Auto-disable, not deletable via link |
| Revoked | immediate | Disable, all subsequent access denied |
| Hard-delete | 30 days after revoke | Remove from DB |

---

## Future Enhancements

- Email invitations (send link via email)
- Comment access (comments-only permission level)
- Expiring access (read-only for 24h then revoke)
- Collaboration mode (simultaneous editing)
- Download restrictions (view-only, no export)
- IP whitelisting (restrict by IP range)
- Usage analytics (track who accessed, when)

---

**Status:** Complete
