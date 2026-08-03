# Synora Final Security Audit

**Date**: 2026-07-28
**Scope**: Dependencies, authentication, authorization, data protection, input validation, secrets, transport, infrastructure
**Commit**: `e122248`

---

## Verdict

**Production security posture: STRONG.** Zero production dependency vulnerabilities. Authentication and authorization are correctly designed and consistently enforced. Three medium-severity gaps must be closed before Release 3 endpoints are exposed to users.

---

## 1. Dependency Vulnerabilities

```
pnpm audit --prod   →  No known vulnerabilities found
pnpm audit          →  8 vulnerabilities (1 critical, 3 high, 3 moderate, 1 low)
```

Every finding is confined to the development toolchain. None is present in the production dependency graph or the deployed container.

| Advisory | Severity | Package | Path | Production reachable |
|----------|----------|---------|------|---------------------|
| GHSA-5xrq-8626-4rwp | Critical | vitest | `backend > vitest` | No — test runner |
| GHSA (fs.deny bypass) | High | vite | `backend > vitest > vite` | No — dev server |
| brace-expansion DoS | High | brace-expansion | transitive build dep | No — build time |
| GHSA-67mh-4wv8-2f99 | Moderate | esbuild | `backend > vitest > vite > esbuild` | No — dev server |
| GHSA-4w7w-66w2-5vf9 | Moderate | vite | `backend > vitest > vite` | No — dev server |
| launch-editor NTLMv2 | Moderate | launch-editor | dev dependency | No — dev only |
| esbuild arbitrary read | Low | esbuild | transitive | No — dev server |

**Assessment**: The critical vitest advisory requires the Vitest UI server to be listening and network-exposed. Synora never runs the Vitest UI, and CI runs tests headless. Real-world exploitability is nil.

**Action**: Patch to clear Dependabot noise and protect developer machines. Not a launch blocker.

---

## 2. Authentication

### Implemented and verified

| Control | Implementation | Status |
|---------|---------------|--------|
| Password storage | bcrypt with per-password salt | Correct |
| Access tokens | JWT, 15-minute expiry | Correct |
| Refresh tokens | Rotating, 7-day expiry, DB-tracked | Correct |
| Session identity | `sid` claim binds token to a session row | Correct |
| Login lockout | Failed-attempt counter, time-based lock | Correct |
| Password reset | Single-use, expiring tokens | Correct |
| Email verification | Single-use, expiring tokens | Correct |
| Logout | Invalidates the session server-side | Correct |
| Logout-all | Revokes every session for a user | Correct |
| Device metadata | Captured per refresh token | Correct |

Refresh-token rotation with server-side session records is the right design: a stolen access token expires in 15 minutes, and a stolen refresh token is invalidated the moment the legitimate holder rotates it.

### Gap — MFA is implemented but unreachable

`apps/backend/src/services/mfa/` contains a complete MFA implementation with tests. **No route mounts it.** It is dead code.

**Risk**: Not a vulnerability, but a documentation and audit hazard — a reader of the codebase would reasonably conclude MFA is available. It is not.

**Action**: Either wire it to routes or remove it. Do not ship security code that does not run.

---

## 3. Authorization

### Design — correct

Permission checks live in the **service layer**, not in middleware. Every Release 3 service method independently resolves the caller's `WorkspaceMember` row and validates the role before touching data.

This is the stronger choice. Middleware-based authorization fails open when a new route forgets to attach the middleware; service-layer authorization fails closed because the check is inside the function that does the work.

Roles: `VIEWER` < `MEMBER` < `EDITOR` < `ADMIN` < `OWNER`. `VIEWER` is read-only and is rejected on every mutating path.

### Workspace isolation

Every Release 3 entity carries `workspaceId` with a cascading foreign key. Cross-tenant access requires a service method to skip its membership check — no such path was found.

**Gap**: isolation is enforced only in application code. There is no database-level backstop.

**Recommendation**: PostgreSQL row-level security as defense in depth. A single forgotten check in future code becomes a tenant-data breach without it. Not a launch blocker given current code is correct, but the blast radius of one mistake is total.

---

## 4. Input Validation

Every route validates its body with a Zod schema before the service is called. Types flow from the schema, so validation and typing cannot drift.

### Gap — no maximum length on message content

```ts
const createMessageSchema = z.object({
  content: z.string().min(1),   // no .max()
  role: z.nativeEnum(MessageRole),
  parentId: z.string().optional(),
})
```

An authenticated user can POST a message of arbitrary size. Express's default body limit provides a coarse ceiling, but the application expresses no intent.

**Action**: Add `.max(100_000)` (or the provider's context limit) before exposing chat. Medium severity.

---

## 5. Injection

| Vector | Assessment |
|--------|-----------|
| SQL injection | **Not reachable.** All queries go through Prisma's parameterized query builder. No raw SQL string concatenation found anywhere in the codebase. |
| Command injection | **Not reachable.** No `exec`/`spawn` on user input. |
| XSS | **Mitigated.** React escapes by default; no `dangerouslySetInnerHTML` found. |
| CSRF | **Mitigated.** CSRF tokens required on state-changing operations. |
| Path traversal | **Not reachable in app code.** File access goes through the storage abstraction with generated keys, never user-supplied paths. |

---

## 6. Rate Limiting

Auth endpoints (login, register, password reset) are rate-limited.

### Gap — Release 3 endpoints are unthrottled

`POST /conversations` and `POST /messages` have no rate limit. An authenticated user can create unbounded conversations and messages, each of which will trigger a paid AI provider call once streaming is wired.

**Risk**: Cost amplification and storage exhaustion by a single authenticated account.

**Action**: Add per-user and per-workspace rate limits to conversation and message creation before exposing chat. Medium severity — becomes high the moment provider calls are wired to real API keys.

---

## 7. Secrets Management

Secrets are read through an audited `SecretsManager` abstraction rather than direct `process.env` access in service code. Reads are logged. The manager supports multiple backends (env, file, and a stubbed HSM path) selected by stage.

Configuration is validated by a Zod schema at startup. **The application refuses to boot on invalid or missing required config** rather than failing at first use — correct fail-fast behavior.

Stage-aware with `government` and `enterprise` modes that tighten defaults.

**No hardcoded secrets found.** `.env.example` contains only placeholder values and generation instructions.

---

## 8. Transport and Headers

| Control | Status |
|---------|--------|
| HTTPS enforced in production | Configured |
| CORS restricted to configured origins | Configured |
| Compression middleware | Enabled |
| Structured request logging (Winston) | Enabled |

---

## 9. Data Protection

- Passwords: bcrypt, never logged, never returned in API responses
- Tokens: stored hashed where applicable, transmitted over HTTPS only
- Audit trail: `createdAt`/`updatedAt` on all entities; dedicated `AuditLog` model for workspace actions
- Cascading deletes: removing a workspace removes all dependent data — no orphaned tenant data

### Gap — StreamingJob records failures without detail

`StreamingJob` has `status = FAILED` but no `error` column. A failed stream is unexplainable after the fact, which impedes incident response.

**Action**: Add an `error` text column before shipping streaming. Low severity, high operational value.

---

## 10. Infrastructure

**CI security job**: passing on commit `e122248`.

**Gaps**:
- Node 20 deprecation on three GitHub Actions — will break when runners are removed
- No `prisma migrate diff` drift check — this is what allowed the schema divergence documented in `FINAL_AUDIT.md` to reach CI
- `infrastructure/k8s/` is empty (correctly scoped to Release 4)

---

## Findings Summary

| ID | Severity | Finding | Blocks launch |
|----|----------|---------|---------------|
| SEC-01 | Medium | No rate limiting on Release 3 endpoints | Yes, if chat ships |
| SEC-02 | Medium | No max length on message content | Yes, if chat ships |
| SEC-03 | Medium | MFA implemented but unwired | No — wire or remove |
| SEC-04 | Low | No DB-level tenant isolation (RLS) | No — code is correct today |
| SEC-05 | Low | StreamingJob has no error field | No |
| SEC-06 | Low | 8 dev-only dependency CVEs | No |
| SEC-07 | Low | Node 20 deprecation in CI actions | No |

**Zero high or critical findings in production code or production dependencies.**

---

## Conclusion

Synora's security engineering is above the bar for a launch-stage platform. The authentication design is correct, authorization is enforced at the right layer, injection vectors are closed, and the production dependency tree is clean.

The three medium findings (SEC-01, SEC-02, SEC-03) are all scoped to Release 3, which — per `FINAL_AUDIT.md` — cannot ship anyway without a frontend. They should be closed in the same work that builds the chat UI.

**Security does not block a Releases 1–2 launch. Security does add three required items to a Release 3 launch.**
