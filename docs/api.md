# Synora AI API Documentation

## Base URL
```
http://localhost:3001/api
```

## Authentication
All protected endpoints require an `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "meta": {
    "timestamp": "2026-01-13T12:00:00Z",
    "version": "1.0.0"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { /* optional error details */ }
  }
}
```

## Authentication Endpoints

### Register
Create a new user account.

**Request**
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "User Name" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "<opaque-refresh-token>",
    "user": {
      "id": "cuid123",
      "email": "user@example.com",
      "name": "User Name",
      "emailVerified": false
    }
  }
}
```
`accessToken` is a 15-minute JWT (HS256, algorithm pinned) that also
carries a `sid` claim identifying the backing session (see Sessions
below). `refreshToken` is an opaque, single-use, 7-day token — store it,
and use it with `POST /api/auth/refresh` to mint a new pair before the
access token expires. The deprecated `token` alias (a duplicate of
`accessToken`) was removed in Release 2 M3 once the last raw-fetch
frontend consumer was rebuilt on the typed API client.

Registration also issues an email-verification token and sends a
verification email (provider-agnostic mailer, see
`docs/architecture.md`#mailer-abstraction); failure to send never fails
registration itself (best-effort, logged).

**Status Codes**
- `201`: User created successfully
- `400`: Validation error (invalid email, weak password, etc.)
- `409`: Email already registered

Register and login return an identical response shape for a duplicate
email as for a wrong password (both a generic 400/401), by design — this
closes an email-enumeration side channel (`docs/production/R1-a_EMAIL_ENUMERATION.md`).

---

### Login
Authenticate and receive an access/refresh token pair.

**Request**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "rememberMe": true
}
```
`rememberMe` (optional, default `false`) selects a longer refresh-token
lifetime (`JWT_REFRESH_EXPIRY_REMEMBER_ME`, default 30d) instead of the
normal 7d. It is recorded on the session for display in the session list
(see below) but never affects verification — a "remembered" and a normal
session are checked identically.

**Response** — same shape as Register above.

**Status Codes**
- `200`: Authentication successful
- `400`: Invalid credentials
- `423`: `ACCOUNT_LOCKED` — too many recent failed attempts for this
  account (default: 5 failures locks the account for 15 minutes; both
  config-driven). The response body includes `error.details.lockedUntil`.

---

### Refresh
Exchange a valid refresh token for a new access/refresh pair.

**Request**
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "<opaque-refresh-token>"
}
```

**Response** — same `accessToken`/`refreshToken` shape as Login.

Refresh tokens are single-use: presenting one revokes it and issues a new
one atomically. Presenting an already-used, expired, or unknown token is
rejected — this also means a stolen-and-reused refresh token is detected
(the legitimate holder's subsequent refresh will fail, signaling reuse).
The new access token's `sid` claim always points at the freshly-created
session row — rotation effectively continues the same logical session
under a new session id.

**Status Codes**
- `200`: New token pair issued
- `401`: `UNAUTHORIZED` — invalid, expired, or already-used refresh token

---

### Logout
Revoke a refresh token, ending that session. The short-lived access token
is not individually revocable (by design — it expires within minutes) but
becomes useless once no refresh token can renew it.

**Request**
```http
POST /api/auth/logout
Content-Type: application/json

{
  "refreshToken": "<opaque-refresh-token>"
}
```

**Response**
```json
{
  "success": true,
  "data": { "message": "Logged out successfully" }
}
```

Idempotent — logging out an already-revoked or unknown refresh token
still returns 200.

---

### Forgot Password
Request a password-reset email. Always returns the same 200 response,
whether or not the email belongs to an account — this closes the same
email-enumeration side channel as register/login.

**Request**
```http
POST /api/auth/forgot-password
Content-Type: application/json

{ "email": "user@example.com" }
```

**Response**
```json
{
  "success": true,
  "data": { "message": "If an account exists for that email, a password reset link has been sent." }
}
```

If the account exists, a single-use reset token (≤1h expiry,
SHA-256-hashed at rest — see `docs/database.md`) is issued and emailed via
the mailer abstraction; requesting a new one invalidates any previous
still-unused token for that user.

---

### Reset Password
Consume a reset token and set a new password.

**Request**
```http
POST /api/auth/reset-password
Content-Type: application/json

{ "token": "<raw-reset-token>", "newPassword": "a-new-password-123" }
```

**Response**
```json
{ "success": true, "data": { "message": "Password reset successfully. Please sign in." } }
```

Consuming a valid token revokes **every** active session for the account
(the reset is trusted to represent regained control, so any other live
token — potentially an attacker's — must not survive it) and sends a
"password changed" notification email. No new session is issued; the
caller signs in again with the new password.

**Status Codes**
- `200`: Password reset
- `400`: Validation error (new password too short)
- `401`: `UNAUTHORIZED` — token is unknown, already used, or expired

---

### Verify Email
Consume an email-verification token.

**Request**
```http
POST /api/auth/verify-email
Content-Type: application/json

{ "token": "<raw-verification-token>" }
```

**Response**
```json
{ "success": true, "data": { "message": "Email verified successfully." } }
```

**Status Codes**
- `200`: Verified
- `401`: `UNAUTHORIZED` — token is unknown, already used, or expired

---

### Resend Verification Email
Authenticated — resends to whoever is asking, never to an arbitrary
address.

**Request**
```http
POST /api/auth/resend-verification
Authorization: Bearer <token>
```

**Response**
```json
{ "success": true, "data": { "message": "Verification email sent." } }
```
Returns `{ "message": "Email is already verified." }` (still 200) if the
account is already verified, without sending mail again.

---

### Sessions (device/session management)
Backed by the same `RefreshToken` rows described in
`docs/database.md` — a "session" is a live refresh token, with device
metadata captured at issue/rotation time.

**List active sessions**
```http
GET /api/auth/sessions
Authorization: Bearer <token>
```
```json
{
  "success": true,
  "data": [
    {
      "id": "sess123",
      "createdAt": "2026-07-25T00:00:00Z",
      "lastUsedAt": "2026-07-25T10:00:00Z",
      "expiresAt": "2026-08-01T00:00:00Z",
      "ipAddress": "203.0.113.5",
      "deviceLabel": "Chrome on macOS",
      "rememberMe": false,
      "isCurrent": true
    }
  ]
}
```
`isCurrent` is derived from the requesting access token's `sid` claim.
`deviceLabel` is parsed server-side from the stored `User-Agent`.

**Revoke one session**
```http
DELETE /api/auth/sessions/:id
Authorization: Bearer <token>
```
Only revokes a session owned by the caller — `404` otherwise (never
reveals whether the id belongs to someone else).

**Log out everywhere**
```http
POST /api/auth/logout-all
Authorization: Bearer <token>
```
```json
{ "success": true, "data": { "revokedCount": 3 } }
```
Revokes every active session for the account, **including the caller's
own** — a literal "log out everywhere."

---

## User Endpoints

### Get Current User
Retrieve authenticated user's profile, including verification status,
profile fields, and notification preferences.

**Request**
```http
GET /api/users/me
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "cuid123",
    "email": "user@example.com",
    "name": "User Name",
    "image": "https://...",
    "role": "USER",
    "emailVerified": true,
    "createdAt": "2026-01-13T12:00:00Z",
    "profile": { "bio": null, "website": null, "location": null },
    "preferences": {
      "theme": "DARK",
      "emailNotifications": true,
      "pushNotifications": false,
      "marketingEmails": false
    }
  }
}
```
`preferences` always returns a value (sane defaults) even before the user
has ever saved any — see `PATCH /api/users/me/preferences` below.

**Status Codes**
- `200`: Success
- `401`: Unauthorized
- `404`: User not found

---

### Update Profile
Update the caller's name and/or profile fields (bio, website, location).
Only the fields present in the body are changed.

**Request**
```http
PATCH /api/users/me
Authorization: Bearer <token>
Content-Type: application/json

{ "name": "New Name", "bio": "...", "website": "https://...", "location": "..." }
```
**Response** — the updated user (same shape as `GET /api/users/me`, minus `preferences`).

---

### Upload / Remove Avatar
Multipart upload through the provider-agnostic storage abstraction (see
`docs/architecture.md`#storage-abstraction — local filesystem today,
S3-compatible in a future release, config-only swap).

```http
POST /api/users/me/avatar
Authorization: Bearer <token>
Content-Type: multipart/form-data; field "avatar"
```
```json
{ "success": true, "data": { "image": "http://.../uploads/avatars/<userId>/<uuid>.png" } }
```
PNG/JPEG/WEBP/GIF only, max size `STORAGE_MAX_UPLOAD_BYTES` (default
5MB) — `400` otherwise. Replacing an avatar deletes the previous file.

```http
DELETE /api/users/me/avatar
Authorization: Bearer <token>
```
Clears the avatar and deletes the stored file (idempotent).

---

### Change Password
Requires the current password; rotates to the new one and revokes every
**other** active session (the device making the change stays signed in).
Sends a "password changed" notification email.

```http
POST /api/users/me/password
Authorization: Bearer <token>
Content-Type: application/json

{ "currentPassword": "...", "newPassword": "a-new-password-123" }
```
**Status Codes**: `200` success · `400` new password too short · `401`
current password incorrect.

---

### Notification Preferences
```http
GET /api/users/me/preferences
Authorization: Bearer <token>
```
Returns defaults (`{ theme: "DARK", emailNotifications: true,
pushNotifications: false, marketingEmails: false }`) if the user has
never saved preferences — no row is created until the first `PATCH`.

```http
PATCH /api/users/me/preferences
Authorization: Bearer <token>
Content-Type: application/json

{ "marketingEmails": true }
```
Partial update (upsert); returns the full preferences object.

---

### Delete Account
Soft-deletes the account: password-confirmed, revokes every session,
mangles the email (`deleted-<id>@deleted.synora.internal`) so the
original address is immediately free for a new registration, and sends a
confirmation email to the original address. The row itself is kept
(`status: DELETED`) so owned projects/documents/activity logs retain
referential integrity.

```http
DELETE /api/users/me
Authorization: Bearer <token>
Content-Type: application/json

{ "password": "..." }
```
**Status Codes**: `200` deleted · `401` password incorrect.

---

### Get User Profile
Retrieve public user profile.

**Request**
```http
GET /api/users/:userId
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "cuid123",
    "name": "User Name",
    "image": "https://...",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## Workspace Endpoints

**New in M4.** Reads are membership-checked: a caller who isn't a member
of the requested workspace gets `404`, never a `403` that would confirm
the workspace exists. Writes additionally require the `OWNER` role — a
non-owner member gets `403` (they already know the workspace exists).
Invitations, roles beyond `OWNER`, and API keys are out of scope until M6.

### List Workspaces
Every workspace the caller is a member of, with their role and the
member count.

**Request**
```http
GET /api/workspaces
Authorization: Bearer <token>
```
```json
{
  "success": true,
  "data": [
    {
      "id": "ws123",
      "name": "Acme Inc",
      "slug": "acme-inc",
      "description": null,
      "avatar": null,
      "role": "OWNER",
      "memberCount": 1,
      "createdAt": "2026-07-25T00:00:00Z",
      "updatedAt": "2026-07-25T00:00:00Z"
    }
  ]
}
```

### Create Workspace
Creates a workspace and makes the caller its `OWNER`. The slug is
generated from `name` (kebab-cased) and suffixed (`-2`, `-3`, …) on
collision — it never changes on a later rename. Also creates a real
`WORKSPACE`-type notification for the caller ("Workspace created").

**Request**
```http
POST /api/workspaces
Authorization: Bearer <token>
Content-Type: application/json

{ "name": "Acme Inc", "description": "Optional" }
```
`201` on success, with the same shape as a list entry.

### Get Workspace
**Request**
```http
GET /api/workspaces/:id
Authorization: Bearer <token>
```
`404` if the caller is not a member (including a nonexistent id).

### Update Workspace
OWNER-only. Renaming never changes the slug.

**Request**
```http
PATCH /api/workspaces/:id
Authorization: Bearer <token>
Content-Type: application/json

{ "name": "New Name", "description": "Optional" }
```
`403` if the caller is a member but not the owner; `404` if not a member.

### List Workspace Members
Read-only.

**Request**
```http
GET /api/workspaces/:id/members
Authorization: Bearer <token>
```
```json
{
  "success": true,
  "data": [
    {
      "id": "mem123",
      "role": "OWNER",
      "createdAt": "2026-07-25T00:00:00Z",
      "user": { "id": "u1", "name": "Ada", "email": "ada@example.com", "image": null }
    }
  ]
}
```

---

## Notification Endpoints

**New in M4.** Every notification is created at a real backend event
(password changed, password reset, email verified, workspace created) —
there is no seeded or sample notification content.

### List Notifications
Most recent first, capped at 50, with the unread count in the same
response.

**Request**
```http
GET /api/notifications
Authorization: Bearer <token>
```
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "n1",
        "type": "WORKSPACE",
        "title": "Workspace created",
        "body": "\"Acme Inc\" is ready to go.",
        "link": "/dashboard/settings/workspace",
        "readAt": null,
        "createdAt": "2026-07-25T00:00:00Z"
      }
    ],
    "unreadCount": 1
  }
}
```

### Unread Count
```http
GET /api/notifications/unread-count
Authorization: Bearer <token>
```
```json
{ "success": true, "data": { "unreadCount": 1 } }
```

### Mark One Read
```http
POST /api/notifications/:id/read
Authorization: Bearer <token>
```
`404` if the notification doesn't belong to the caller. Idempotent —
marking an already-read notification read again just returns it unchanged.

### Mark All Read
```http
POST /api/notifications/read-all
Authorization: Bearer <token>
```
```json
{ "success": true, "data": { "count": 3 } }
```

---

## Project Endpoints

### List Projects
Get all user projects.

**Request**
```http
GET /api/projects
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "proj123",
      "name": "My Project",
      "description": "Project description",
      "status": "ACTIVE",
      "createdAt": "2026-01-13T12:00:00Z",
      "updatedAt": "2026-01-13T12:00:00Z"
    }
  ]
}
```

---

### Create Project
Create a new project.

**Request**
```http
POST /api/projects
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My New Project",
  "description": "Optional description",
  "workspaceId": "workspace123" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "proj123",
    "name": "My New Project",
    "description": "Optional description",
    "status": "ACTIVE",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `201`: Project created
- `400`: Invalid data
- `401`: Unauthorized

---

### Get Project
Retrieve project details.

**Request**
```http
GET /api/projects/:projectId
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "proj123",
    "name": "My Project",
    "description": "Description",
    "status": "ACTIVE",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## Document Endpoints

### List Documents
Get all user documents.

**Request**
```http
GET /api/documents
Authorization: Bearer <token>
```

**Query Parameters**
- `projectId`: Filter by project (optional)
- `status`: Filter by status (optional)
- `page`: Page number (optional, default: 1)
- `limit`: Items per page (optional, default: 20)

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "doc123",
      "title": "Document Title",
      "content": "Document content...",
      "format": "MARKDOWN",
      "status": "PUBLISHED",
      "createdAt": "2026-01-13T12:00:00Z",
      "updatedAt": "2026-01-13T12:00:00Z",
      "publishedAt": "2026-01-13T12:05:00Z"
    }
  ]
}
```

---

### Create Document
Create a new document.

**Request**
```http
POST /api/documents
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Document Title",
  "content": "Document content in markdown...",
  "format": "MARKDOWN",
  "projectId": "proj123" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "doc123",
    "title": "Document Title",
    "content": "Document content in markdown...",
    "format": "MARKDOWN",
    "status": "DRAFT",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `201`: Document created
- `400`: Invalid data
- `401`: Unauthorized

---

### Get Document
Retrieve document details.

**Request**
```http
GET /api/documents/:documentId
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "doc123",
    "title": "Document Title",
    "content": "Full document content...",
    "format": "MARKDOWN",
    "status": "PUBLISHED",
    "createdAt": "2026-01-13T12:00:00Z",
    "updatedAt": "2026-01-13T12:00:00Z",
    "publishedAt": "2026-01-13T12:05:00Z"
  }
}
```

---

## Image Endpoints

### List Images
Get all generated images.

**Request**
```http
GET /api/images
Authorization: Bearer <token>
```

**Query Parameters**
- `projectId`: Filter by project (optional)
- `page`: Page number (optional)
- `limit`: Items per page (optional, default: 20)

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "img123",
      "prompt": "A beautiful sunset...",
      "imageUrl": "https://s3.amazonaws.com/...",
      "thumbnailUrl": "https://s3.amazonaws.com/...",
      "width": 1024,
      "height": 768,
      "model": "dall-e-3",
      "status": "COMPLETED",
      "createdAt": "2026-01-13T12:00:00Z"
    }
  ]
}
```

---

### Generate Image
Create an AI-generated image.

**Request**
```http
POST /api/images/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "A serene mountain landscape at sunset",
  "width": 1024,
  "height": 768,
  "projectId": "proj123" (optional)
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "img123",
    "prompt": "A serene mountain landscape at sunset",
    "imageUrl": "https://s3.amazonaws.com/...",
    "width": 1024,
    "height": 768,
    "model": "dall-e-3",
    "status": "PROCESSING",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

**Status Codes**
- `201`: Image generation started
- `400`: Invalid prompt or parameters
- `401`: Unauthorized
- `429`: Rate limit exceeded

---

### Get Image
Retrieve image details.

**Request**
```http
GET /api/images/:imageId
Authorization: Bearer <token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "img123",
    "prompt": "A serene mountain landscape at sunset",
    "imageUrl": "https://s3.amazonaws.com/...",
    "thumbnailUrl": "https://s3.amazonaws.com/...",
    "width": 1024,
    "height": 768,
    "model": "dall-e-3",
    "status": "COMPLETED",
    "createdAt": "2026-01-13T12:00:00Z"
  }
}
```

---

## AI Endpoints

### Generate Text/Code
Generate text or code via whichever AI provider is configured. See
`docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md` for the full provider
list, selection rules, and how to configure one.

**Request**
```http
POST /api/ai/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "prompt": "Write a haiku about databases",
  "mode": "text",
  "model": "claude-sonnet-5" (optional — provider's default if omitted),
  "maxTokens": 1024 (optional, 1-100000, default 4096),
  "temperature": 0.7 (optional, 0-2),
  "systemPrompt": "You are a helpful assistant" (optional)
}
```
`mode` is `"text"` (default) or `"code"` — code mode selects a
code-oriented default system prompt when `systemPrompt` is omitted.

**Response**
```json
{
  "success": true,
  "data": {
    "text": "Generated response text",
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "usage": { "inputTokens": 12, "outputTokens": 34 },
    "finishReason": "end_turn"
  }
}
```

**Status Codes**
- `200`: Generated successfully
- `400`: Invalid request (missing/empty prompt, invalid mode, maxTokens or temperature out of range)
- `401`: Unauthorized
- `500`: No AI provider is configured, or the provider's API call failed (the error is logged server-side with detail; the client response does not leak provider internals outside development)

---

## Conversation Endpoints

Release 3 M2 (Universal Conversation Engine). All routes are workspace-scoped
and require workspace membership; a workspace the caller does not belong to
returns `404`, not `403` (this codebase's established convention for
cross-tenant access — see `requireMembership` in `services/checks.ts`).

### Create Conversation
```http
POST /api/workspaces/:workspaceId/conversations
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "My conversation",
  "description": "Optional",
  "provider": "anthropic",
  "model": "claude-sonnet-5"
}
```
`provider` must name a registered, currently-configured AI provider
(`400` otherwise) — see `docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md`
for the provider list. `model` is not validated against a fixed list;
models are free-form per-provider strings throughout this codebase.

**Status Codes**
- `201`: Created
- `400`: Invalid body, or `provider` is unregistered/unconfigured
- `401`: Unauthorized
- `404`: Not a member of `:workspaceId`

### List Conversations
```http
GET /api/workspaces/:workspaceId/conversations?search=&archived=&pinned=&sortBy=&sortDirection=&skip=&take=
Authorization: Bearer <token>
```
- `search` — case-insensitive substring match on title/description.
- `archived` — `true` to list archived conversations instead of active ones.
- `pinned` — `true` to filter to pinned conversations only.
- `sortBy` — one of `createdAt`, `updatedAt`, `lastMessageAt` (default), `title`.
- `sortDirection` — `asc` or `desc` (default `desc`).

**Response**
```json
{
  "success": true,
  "data": {
    "conversations": [ { "id": "...", "title": "...", "lastMessageAt": "...", "tags": [] } ],
    "total": 1
  }
}
```

### Get Conversation
```http
GET /api/workspaces/:workspaceId/conversations/:conversationId
Authorization: Bearer <token>
```
Includes the 50 most recent non-deleted messages, tags, collaborators,
and usage. Returns `404` for a conversation that doesn't exist or that
the caller's workspace can't see.

### Update Conversation
```http
PATCH /api/workspaces/:workspaceId/conversations/:conversationId
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Renamed",
  "description": "...",
  "provider": "openai",
  "model": "gpt-4o",
  "tagNames": ["important", "follow-up"]
}
```
Metadata only. There is no `isArchived`/`isPinned`/`status` field here —
those transitions go through the dedicated endpoints below so the
conversation's state machine can't be bypassed by a direct PATCH.
`tagNames` replaces the conversation's full tag set (find-or-create per
workspace, max 20 tags).

### Archive / Restore / Pin / Unpin / Delete
```http
POST   /api/workspaces/:workspaceId/conversations/:conversationId/archive
POST   /api/workspaces/:workspaceId/conversations/:conversationId/restore
POST   /api/workspaces/:workspaceId/conversations/:conversationId/pin
POST   /api/workspaces/:workspaceId/conversations/:conversationId/unpin
DELETE /api/workspaces/:workspaceId/conversations/:conversationId
Authorization: Bearer <token>
```
State machine: `ACTIVE ⇄ ARCHIVED` via archive/restore;
`{ACTIVE, ARCHIVED} → DELETED` via delete (terminal — no endpoint
restores from `DELETED`). `archive` on a non-`ACTIVE` conversation and
`restore` on a non-`ARCHIVED` conversation both return `400`. `delete` is
idempotent — deleting an already-`DELETED` conversation returns `200`
with no error. Each transition records one `AuditLog` entry
(`conversation_archived`, `conversation_restored`, `conversation_pinned`,
`conversation_unpinned`, `conversation_deleted`).

### Get Conversation Usage
```http
GET /api/workspaces/:workspaceId/conversations/:conversationId/usage
Authorization: Bearer <token>
```
**Response**
```json
{
  "success": true,
  "data": {
    "inputTokens": 1240,
    "outputTokens": 480,
    "totalTokens": 1720,
    "estimatedCost": 0.0135
  }
}
```
Aggregate token/cost accounting for the whole conversation (not a
per-message ledger). Returns all-zero fields if no generation has
completed yet. `estimatedCost` is a display approximation
(`ai/pricing.ts`) — it is never used for billing, which is entirely
separate (see Billing Endpoints below).

---

## Message Endpoints

### Create Message (and generate a reply)
```http
POST /api/workspaces/:workspaceId/conversations/:conversationId/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "content": "Hello",
  "role": "USER",
  "parentId": "optional-parent-message-id"
}
```
`role` accepts `USER` or `SYSTEM` only — `ASSISTANT` is rejected with
`400`. An assistant message is only ever created by a successful
generation (see below); a client cannot fabricate one directly.

For a `USER` message, this endpoint is **asynchronous**: it persists the
user message, creates an *empty* assistant message as a placeholder,
enqueues a `generate_response` job, and returns immediately. The reply
is produced by the worker against the conversation's own AI provider
(not whatever `AI_PROVIDER` happens to be globally set to — see
`ai/resolver.ts`'s `explicitProviderId`); the client streams its tokens
from the SSE endpoint below, keyed by the returned `jobId`.

**Response (USER message)**
```json
{
  "success": true,
  "data": {
    "userMessage": { "id": "...", "content": "Hello", "role": "USER" },
    "assistantMessage": { "id": "...", "content": "", "role": "ASSISTANT" },
    "jobId": "..."
  }
}
```
The assistant message's `content` is empty on this response by design —
it fills in as the stream completes. Token counts land on the message
once generation finishes.

**Response (SYSTEM message — no generation triggered)**
```json
{ "success": true, "data": { "id": "...", "content": "...", "role": "SYSTEM" } }
```

**Status Codes**
- `201`: Created — for a `USER` message, the generation job is enqueued
- `400`: Invalid body, or `role: "ASSISTANT"`
- `401`: Unauthorized
- `404`: Not a member of `:workspaceId`, or the conversation doesn't exist

Generation failure does not surface on this response, because generation
has not started when it returns. A failed generation is reported on the
SSE stream and recorded on the `StreamingJob` row (`FAILED`, with
`lastError`); retries are owned by `StreamingRetryEngine` in the worker.
The user message is never rolled back — the caller can retry the reply
with the regenerate endpoint.

### Folders — two distinct resources

There are **two folder systems**, backed by different tables, and they
must not be conflated:

- **Asset folders** (`Folder` model, M5): `/api/workspaces/:id/folders`
  — workspace- and optionally project-scoped, hold uploaded assets.
  List returns a flat array; gated by `folder:manage`.
- **Conversation folders** (`ConversationFolder` model, Release 3):
  `/api/workspaces/:id/conversation-folders` — hierarchical
  (`parentId`), hold conversations. List returns root folders (or the
  children of `?parentId=`) with nested `children`, a preview of
  `conversations`, and `_count`; gated by `conversation-folder:manage`.
  - `POST   .../conversation-folders` — create (`{ name, parentId? }`)
  - `PATCH  .../conversation-folders/:folderId` — rename / re-parent
    (self-parenting refused)
  - `DELETE .../conversation-folders/:folderId` — delete
  - `POST   .../conversation-folders/move` — file a conversation
    (`{ conversationId, folderId | null }`)

To read a folder's contents, use the conversation list filter:
`GET .../conversations?folderId=<id>` scopes to one folder,
`?folderId=none` lists only unfiled conversations, and no filter lists
everything.

### Stream a Generation (SSE)
```http
GET /api/workspaces/:workspaceId/conversations/:conversationId/stream?messageId=<assistantMessageId>
Authorization: Bearer <token>
Accept: text/event-stream
```
Relays the `generate_response` worker's output for the `StreamingJob`
attached to `messageId`. Events are named by the worker's event type
(tokens as they arrive, then a terminal completion or error event), plus
a periodic `heartbeat` to keep intermediaries from closing an idle
connection. `X-Accel-Buffering: no` is set so buffering proxies don't
withhold tokens.

- `400`: no `messageId` query param
- `event: error` with `code: JOB_NOT_FOUND` when no job exists for that
  message (the stream then closes)

### Cancel a Generation
```http
POST /api/workspaces/:workspaceId/conversations/:conversationId/stream/:jobId/cancel
Authorization: Bearer <token>
```
Publishes a cancel signal on the job's Redis control channel; the worker
aborts the in-flight provider request. `404` if the job doesn't exist.

### List Messages
```http
GET /api/workspaces/:workspaceId/conversations/:conversationId/messages?skip=&take=
Authorization: Bearer <token>
```
Chronological, excludes soft-deleted messages. `take` is capped at 100.

### Get Message
```http
GET /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId
Authorization: Bearer <token>
```

### Update Message
```http
PATCH /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId
Authorization: Bearer <token>
Content-Type: application/json

{ "content": "Edited content" }
```
Requires `message:manage`. The UI offers this on **user** turns only —
rewriting an assistant message in place would leave the transcript
claiming the model produced text it never produced; to change an
assistant response, regenerate or branch it. Editing a user turn
invalidates the assistant reply that answered it, so the client
regenerates that reply against the new text.

### Pin / Unpin Message
```http
POST /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId/pin
POST /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId/unpin
Authorization: Bearer <token>
```
Toggles `Message.isPinned`. Pinning is workspace-visible, not per-user.

### Delete Message (soft delete)
```http
DELETE /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId
Authorization: Bearer <token>
```
Sets `deletedAt`; the row is not removed and is excluded from the
default message list. Idempotent — deleting an already-deleted message
returns `200` with the existing `deletedAt` unchanged.

### Add Attachment
```http
POST /api/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId/attachments
Authorization: Bearer <token>
Content-Type: application/json

{ "url": "https://...", "mimeType": "image/png", "name": "screenshot.png", "size": 12345 }
```

---

## Tool Endpoints

Workspace-scoped tool definitions and executions. All routes require
authentication and workspace membership; mutations are additionally
role-gated by the permissions module (`tool:manage` = EDITOR+,
`tool:execute` = MEMBER+, `tool:approve` = ADMIN/OWNER).

Only `HTTP` and `Webhook` tool types can be executed — the engine makes a
real outbound HTTP request built from the tool's `config`
(`{ url, method?, headers? }`), with the tool's `timeout` and `maxRetries`
applied. Other declared types are refused at execute time with a 400.
Outbound requests are SSRF-guarded (private, loopback, link-local, and
metadata address ranges are blocked at DNS-resolution time; redirects are
not followed) and header/URL values may reference stored tool secrets via
`{{secret:NAME}}` placeholders, resolved server-side and never logged.

- `GET    /api/workspaces/:workspaceId/tools` — list active tools (`?category=` filter)
- `POST   /api/workspaces/:workspaceId/tools` — create tool (`tool:manage`)
- `GET    /api/workspaces/:workspaceId/tools/:toolId` — get tool
- `PATCH  /api/workspaces/:workspaceId/tools/:toolId` — update tool (`tool:manage`, bumps `version`)
- `DELETE /api/workspaces/:workspaceId/tools/:toolId` — soft-delete (`tool:manage`)
- `POST   /api/workspaces/:workspaceId/tools/:toolId/execute` — run tool (`tool:execute`); body `{ input, conversationId? }`; returns the execution record (`PENDING` when the tool `requiresApproval`, else `RUNNING`)
- `GET    /api/workspaces/:workspaceId/tools/:toolId/executions` — recent executions for a tool
- `GET    /api/workspaces/:workspaceId/executions/:executionId` — poll one execution
- `POST   /api/workspaces/:workspaceId/executions/:executionId/approve` — approve a `PENDING` execution (`tool:approve`); stamps `approvedBy`/`approvedAt` and starts the run
- `POST   /api/workspaces/:workspaceId/executions/:executionId/reject` — reject a `PENDING` execution (`tool:approve`); body `{ reason }`

Execution `status` values: `PENDING` (awaiting approval), `APPROVED`,
`RUNNING`, `STREAMING`, `COMPLETED`, `FAILED`, `CANCELLED`, `TIMEOUT`,
`REJECTED`. Successful executions carry
`output: { statusCode, body }` from the upstream endpoint plus
`duration` (ms) and `attemptNumber`. Tool lifecycle and execution
decisions (create/update/delete, execute, approve, reject) are recorded
in the workspace audit log; execution audit entries record input *keys*
only, never values.

---

## Liveness & Readiness

### `/health`
Liveness only — no database check. Used for container health checks.

**Request**
```http
GET /health
```

**Response**
```json
{
  "status": "ok",
  "timestamp": "2026-07-23T12:00:00Z",
  "stage": "production",
  "modes": { "offline": false, "mock": false, "enterprise": false, "government": false, "selfHosted": false }
}
```

### `/ready`
Readiness — additionally probes the database. Use this for orchestrator
readiness gating, not `/health`.

**Request**
```http
GET /ready
```

**Response**
```json
{
  "status": "ready",
  "timestamp": "2026-07-23T12:00:00Z",
  "checks": { "database": { "status": "ok", "latencyMs": 4 } }
}
```
Returns a non-200 status with `checks.database.status: "error"` if the
database is unreachable.

---

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication, or an invalid/expired/used refresh token |
| `FORBIDDEN` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `ACCOUNT_LOCKED` | 423 | Too many failed login attempts; see `error.details.lockedUntil` |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limiting

- One global limiter on all of `/api/*`: 100 requests per 15 minutes per
  IP by default (`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX_REQUESTS`,
  config-driven). There is currently no separate, stricter limiter
  specifically on auth endpoints — brute-force protection for login is
  the per-account lockout described above (`ACCOUNT_LOCKED`), not a
  tighter IP rate limit. A Redis-backed limiter shared across instances
  is planned for Release 2 (see `RELEASE_2_PLAN.md`, R2-c); today's
  limiter is correctly in-process/single-instance for Release 1's
  single-instance deployment target.

---

## Billing Endpoints

### List Available Plans
Get all active billing plans.

**Request**
```http
GET /api/billing/plans
Authorization: Bearer <jwt_token>
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "plan_123",
      "key": "pro",
      "name": "Professional",
      "interval": "MONTH",
      "priceCents": 2999,
      "creditsPerInterval": 10000,
      "trialDays": 14,
      "features": { "text_generation": true, "image_generation": true },
      "sortOrder": 1,
      "status": "ACTIVE",
      "isDefault": false
    }
  ]
}
```

---

### Get Subscription
Get the current subscription for a workspace.

**Request**
```http
GET /api/workspaces/{workspaceId}/billing/subscription
Authorization: Bearer <jwt_token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "sub_123",
    "workspaceId": "ws_123",
    "planId": "plan_123",
    "plan": { /* plan object */ },
    "status": "ACTIVE",
    "externalSubscriptionId": "sub_stripe_123",
    "externalCustomerId": "cus_stripe_123",
    "provider": "stripe",
    "currentPeriodStart": "2026-07-01T00:00:00Z",
    "currentPeriodEnd": "2026-08-01T00:00:00Z",
    "cancelAtPeriodEnd": false,
    "createdAt": "2026-07-01T12:00:00Z",
    "updatedAt": "2026-07-01T12:00:00Z"
  }
}
```

---

### Create Checkout Session
Initiate a checkout session for plan purchase.

**Request**
```http
POST /api/workspaces/{workspaceId}/billing/checkout
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "planId": "plan_123",
  "successUrl": "https://app.example.com/billing/success",
  "cancelUrl": "https://app.example.com/billing/plans"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "url": "https://checkout.stripe.com/pay/cs_test_...",
    "sessionId": "cs_test_..."
  }
}
```

Redirects to external payment provider (Stripe). Session is valid for 24 hours.

---

### Change Plan
Change the current subscription plan.

**Request**
```http
POST /api/workspaces/{workspaceId}/billing/subscription/change-plan
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "planId": "plan_456"
}
```

**Response**
```json
{
  "success": true,
  "data": { /* updated subscription object */ }
}
```

**Status Codes**
- `200`: Plan changed successfully
- `400`: Invalid plan or subscription state
- `404`: Workspace or plan not found
- `503`: Billing provider unavailable

---

### Cancel Subscription
Cancel the current subscription.

**Request**
```http
POST /api/workspaces/{workspaceId}/billing/subscription/cancel
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "atPeriodEnd": true
}
```

If `atPeriodEnd` is `true`, subscription cancels at the end of the current billing period. If `false`, cancellation is immediate.

**Response**
```json
{
  "success": true,
  "data": { /* updated subscription object */ }
}
```

---

### Get Credit Balance
Get the current credit balance for a workspace.

**Request**
```http
GET /api/workspaces/{workspaceId}/billing/credits
Authorization: Bearer <jwt_token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "credits_123",
    "workspaceId": "ws_123",
    "balance": 5250,
    "createdAt": "2026-07-01T12:00:00Z",
    "updatedAt": "2026-07-15T14:30:00Z"
  }
}
```

---

### List Credit Ledger
Get recent credit transactions.

**Request**
```http
GET /api/workspaces/{workspaceId}/billing/credits/ledger
Authorization: Bearer <jwt_token>
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "ledger_123",
      "workspaceId": "ws_123",
      "type": "GRANT",
      "amount": 10000,
      "balanceAfter": 15000,
      "reason": "Monthly subscription grant",
      "actorId": null,
      "createdAt": "2026-07-01T00:00:00Z"
    },
    {
      "id": "ledger_124",
      "workspaceId": "ws_123",
      "type": "DEDUCTION",
      "amount": -750,
      "balanceAfter": 14250,
      "reason": "Usage: text_generation",
      "actorId": null,
      "createdAt": "2026-07-15T10:30:00Z"
    }
  ]
}
```

Returns up to 50 most recent ledger entries sorted by date descending.

---

### Get Usage Summary
Get usage breakdown by capability.

**Request**
```http
GET /api/workspaces/{workspaceId}/billing/usage
Authorization: Bearer <jwt_token>
```

**Response**
```json
{
  "success": true,
  "data": {
    "text_generation": {
      "quantity": 1234,
      "creditsCost": 1850
    },
    "image_generation": {
      "quantity": 456,
      "creditsCost": 2280
    }
  }
}
```

---

### List Invoices
Get billing invoices for a workspace.

**Request**
```http
GET /api/workspaces/{workspaceId}/billing/invoices
Authorization: Bearer <jwt_token>
```

**Response**
```json
{
  "success": true,
  "data": [
    {
      "id": "invoice_123",
      "subscriptionId": "sub_123",
      "workspaceId": "ws_123",
      "externalInvoiceId": "inv_stripe_123",
      "status": "PAID",
      "amountDueCents": 2999,
      "amountPaidCents": 2999,
      "hostedInvoiceUrl": "https://invoice.stripe.com/...",
      "paidAt": "2026-07-01T15:00:00Z",
      "createdAt": "2026-07-01T12:00:00Z",
      "updatedAt": "2026-07-01T15:00:00Z"
    }
  ]
}
```

---

## Billing Webhooks

### Stripe Webhook Handler
The platform listens for Stripe webhook events at `POST /api/billing/webhook` (signature header: `stripe-signature`).

Handled event types:
- `checkout.session.completed` — Creates/updates subscription
- `customer.subscription.updated` — Updates subscription status and billing period
- `customer.subscription.deleted` — Reverts to default plan
- `invoice.paid` — Records payment and grants credits
- `invoice.payment_failed` — Marks subscription as past due
- `payment_method.attached` — Stores payment method
- `payment_method.detached` — Removes payment method

All webhook events are idempotent (deduplicated by external event ID). Webhook processing failures are logged but do not cause the endpoint to return an error (retry is provider's responsibility).

---

**Last Updated**: 2026-07-26 (Release 2, Milestone 6)
