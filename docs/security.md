# Synora AI - Security & Compliance Guide

## Security Overview

This document describes what Release 1 actually implements, verified
against the current source — not a generic security-best-practices
template. Sections marked **Not yet implemented** describe real,
tracked gaps (with a pointer to where the work is planned), not
aspirational examples presented as if they exist.

> **Secret management** (how JWT signing keys, database credentials, and
> API keys are stored, rotated, versioned, and audited across every
> environment and deployment platform) has its own document:
> [Secret Management System](security/SECRET_MANAGEMENT.md).

## Authentication & Authorization

### JWT access tokens

15-minute, `HS256`-signed access tokens with the signing algorithm
explicitly pinned in verification (closes the classic `alg: none` bypass
class of vulnerability). Payload:

```json
{
  "userId": "user_id",
  "email": "user@example.com",
  "role": "USER",
  "iat": 1673616000,
  "exp": 1673616900
}
```

### Refresh tokens

Opaque, 7-day, single-use, rotating refresh tokens — not JWTs. Only a
SHA-256 hash is stored (`RefreshToken.tokenHash`); a database read alone
cannot mint a session. Presenting a refresh token revokes it and issues a
new pair atomically, so reuse of an already-consumed token is detected
and rejected. Logout revokes the presented refresh token; this is what
makes "log out" actually end a session, since the short-lived access
token can't be individually revoked but becomes useless once no refresh
token can renew it. Full detail: `docs/production/R1-c_REFRESH_TOKENS.md`.

There is no cookie-based session (`Session` model in the schema exists
for a possible future NextAuth-style flow but is not used by the current
auth system — don't follow it as a reference for how sessions actually
work today).

### Password hashing

Argon2id (not bcrypt) via the `argon2` package, with the parameters
`services/password.service.ts` sets. Password hashes created before this
migration (bcrypt) are transparently re-hashed to Argon2id on the user's
next successful login — no forced reset, no downtime. Full detail:
`docs/production/P0-11_ARGON2_PASSWORD_HASHING.md`.

**Password requirement enforced today:** minimum 8 characters
(`z.string().min(8)` in the registration schema). There is no complexity
requirement (uppercase/lowercase/number/special character) enforced —
if the product needs one, it belongs in that same zod schema.

### Login lockout

Per-account, not just per-IP: 5 failed attempts locks the account for 15
minutes (both `MAX_FAILED_LOGIN_ATTEMPTS`/`LOCKOUT_DURATION_MINUTES`,
config-driven), tracked on `User.failedLoginAttempts`/`lockedUntil`,
reset on the next successful login. Full detail:
`docs/production/R1-d_ACCOUNT_LOCKOUT.md`.

### Email-enumeration prevention

Register and login return an identical response shape (and status code)
for "email already exists" as for "wrong password" — an attacker cannot
distinguish the two to enumerate which emails have accounts. Full detail:
`docs/production/R1-a_EMAIL_ENUMERATION.md`.

### MFA — Not yet implemented

A complete TOTP-based MFA implementation exists on the `recover/mfa`
branch (challenge/setup/recovery-code services, `routes/mfa.ts`, frontend
components, RFC 4226/6238 test vectors) but is not merged or wired into
the running app. Four MFA-*adjacent* services (audit, rate-limiter,
monitoring, alerting logging) already sit unwired in mainline at
`apps/backend/src/services/mfa/`. Landing both halves is Release 2, R2-a
— see `RELEASE_2_PLAN.md`.

### OAuth2 — Not yet implemented

The `Account` model exists in the schema for future OAuth provider
linkage, and `apps/web`'s declared dependencies include `next-auth`, but
no OAuth provider is currently wired into either the backend or frontend.
Registration/login today is email+password only.

## API Security

### Rate limiting

One global, IP-based limiter across all of `/api/*`:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,   // default 15 minutes
  max: config.rateLimit.maxRequests,     // default 100
});

app.use('/api/', limiter);
```

There is **no separate, stricter limiter on auth endpoints** — brute-force
protection against password guessing is the per-account lockout above,
not a tighter IP rate limit. A Redis-backed limiter shared across
multiple instances is planned for Release 2 (R2-c); today's in-process
limiter is correct for Release 1's single-instance deployment target.

### CORS

```typescript
app.use(
  cors({
    origin: config.server.corsOrigins,  // explicit allowlist, zod-validated
                                          // as URLs — no wildcard, defaults
                                          // to localhost only
    credentials: true,
  })
);
```

### CSRF — Not yet implemented

A complete CSRF implementation (middleware, client hook, DB migration,
tests) exists on the `recover/csrf` branch but is not merged. This is a
deliberate Release 1 scope decision, not an oversight: Release 1's auth
uses bearer tokens in the `Authorization` header, which browsers don't
attach automatically the way they do cookies — so there's no live CSRF
vector to close yet. CSRF becomes necessary once auth moves to
browser-auto-sent cookies, which is why R2-b couples the CSRF work to
that same cookie-auth migration. See `RELEASE_2_PLAN.md`.

### Security headers

```typescript
import helmet from 'helmet';
app.use(helmet());
```
Default `helmet()` configuration — no custom CSP directives are currently
set. If the frontend needs a specific Content-Security-Policy (e.g. to
allow a CDN or analytics script), configure it explicitly rather than
assuming the defaults cover it.

## Data Protection

### SQL injection prevention

Every database access goes through Prisma's generated client with
parameterized queries; no `$queryRaw`/`$executeRaw` calls exist anywhere
in the codebase. This isn't a policy to remember — it's simply how the
codebase is written today, verified by grep, not assumed.

### Input validation

Every mutating route validates its request body with a zod schema before
it can reach Prisma; a `ZodError` maps to `400 VALIDATION_ERROR`, never a
raw 500. Full detail: `docs/production/R1-b_INPUT_VALIDATION.md`.

### Error handling

`middleware/errorHandler.ts` hides internal error messages and stack
traces outside `NODE_ENV=development` — a caught error returns a generic
`"Internal server error"` in staging/production, with the real detail
only in the server-side log, never the HTTP response.

### Encryption at rest, XSS sanitization, field-level encryption — Not implemented, no current requirement

No field-level encryption, no `ENCRYPTION_KEY`-based cipher, and no
HTML-sanitization library (e.g. DOMPurify) exist anywhere in this
codebase today. Add them if and when a real requirement appears (e.g. a
feature that renders user-supplied HTML, or a field with a specific
compliance requirement to encrypt at the application layer) — don't
treat their absence as an oversight; Postgres-level encryption at rest
(via the managed hosting provider) is the current baseline.

## Dependency & Secret Security

### Vulnerability scanning (real, CI-enforced)

```bash
# What CI actually runs, blocking, on every push (.github/workflows/ci.yml):
pnpm audit --prod --audit-level=high
```
This gate is not theoretical — it has already caught and blocked a real
set of freshly-disclosed CVEs once in this repository's history (see
`PRODUCTION_READINESS_AUDIT.md`). Package manager is pnpm; `npm audit`
commands from generic guides don't apply here.

### Secret scanning (real, CI-enforced)

Gitleaks (official OSS Docker image, no license, no token) scans the full
tree and git history on every push, blocking on any match not explicitly
allowlisted in `.gitleaksignore` (each entry there is a verified false
positive — an RFC test vector, a documentation placeholder — never a
real secret).

### Secrets never hit git

`.dockerignore` and `.gitignore` both exclude every `.env*` file except
`.env.example`. Every real secret value is read through `SecretsManager`
(`docs/security/SECRET_MANAGEMENT.md`), which audit-logs every read with
an actor tag — never logged in plaintext.

## API keys and audit logging — reserved, not yet wired

The `ApiKey` model (workspace-scoped keys) and `ActivityLog` model
(per-user action audit trail) both exist in the Prisma schema but no
route currently creates, verifies, or queries either — they're
provisioned for a future feature, not a gap in an existing one. Don't
reference either as if it's currently protecting anything.

## GDPR & Privacy — no current implementation

There is no data-export or right-to-be-forgotten (anonymization) code in
this repository today. If GDPR/CCPA compliance is a near-term
requirement, scope it explicitly (likely Release 2 or 3) rather than
assuming it's covered.

## Security Checklist

### Verified true today (Release 1)
- [x] Secrets never committed (`.gitignore`/`.dockerignore` exclude every `.env*` except `.env.example`; gitleaks scans every push)
- [x] CORS explicitly allowlisted, no wildcard
- [x] Global rate limiting enabled on `/api/*`
- [x] Input validation (zod) on every mutating route
- [x] SQL injection prevented structurally (Prisma only, no raw queries)
- [x] Security headers via `helmet()`
- [x] Passwords hashed with Argon2id (bcrypt legacy hashes migrate transparently)
- [x] Error messages don't leak internals outside `development`
- [x] Per-account login lockout
- [x] Refresh-token rotation with reuse detection; real, revocable logout
- [x] JWT algorithm pinned (`HS256` enforced at verification)
- [x] Blocking CI gates: `pnpm audit --prod --audit-level=high`, gitleaks
- [x] Database backups: satisfied by choosing a managed Postgres provider with automated backups/PITR (a deployment requirement, not app code — see `PROJECT_HANDOVER.md` §10)

### Not yet implemented (tracked, not accidental)
- [ ] MFA (`recover/mfa` branch exists, needs rebase — R2-a)
- [ ] CSRF protection (`recover/csrf` branch exists, coupled to cookie-auth migration — R2-b)
- [ ] OAuth2 provider login
- [ ] Password complexity requirements beyond minimum length
- [ ] Auth-endpoint-specific rate limiting (mitigated today by per-account lockout)
- [ ] Redis-backed shared rate-limit/lockout state for multi-instance deployments (R2-c)
- [ ] Field-level encryption at rest
- [ ] Data export / right-to-be-forgotten (GDPR)
- [ ] `/metrics` endpoint and alerting beyond `/health`/`/ready` (R2-f)

## Security Contact

For security issues, please email: security@synora.ai

**Do not** open public GitHub issues for security vulnerabilities.

---

**Last Updated**: 2026-07-23 (Release 1)
