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

**Last Updated**: 2026-07-25 (Release 2, Milestone 3)
