# R1-d: Account Lockout on Login

**Status:** ✅ Complete
**Master plan item:** P0-5 (security audit CRITICAL-003)
**Release:** 1

## What was wrong (verified from source)

Per-account brute force on `/api/auth/login` was completely unthrottled: nothing counted failed attempts per account, and nothing locked an account regardless of how many consecutive wrong passwords it received. The only rate limiting in the app was the global IP-based `express-rate-limit` on all of `/api/*`, which does not protect an individual account from a distributed or slow-and-low attack.

An existing `RateLimiterService` (`services/mfa/rate-limiter.service.ts`) already has this exact logic — but it is tightly coupled to the `MFAAuditLog` table, which is part of the MFA domain this roadmap explicitly defers to Release 2 (per the founder's own Option 1 decision this session). Repurposing it for ordinary login lockout would mean writing MFA-audit rows for a login flow that has nothing to do with MFA, and would silently depend on a feature not yet reintegrated. So R1-d is a small, dedicated implementation instead.

## What changed

- **Config:** `MAX_FAILED_LOGIN_ATTEMPTS` (default 5) and `LOCKOUT_DURATION_MINUTES` (default 15) added through all three config layers (`defaults.ts`, `schema.ts` zod validation, `configLoader.ts` env-var reading), following the exact existing pattern used for `JWT_EXPIRY`/`JWT_REFRESH_EXPIRY`.
- **Schema:** `User.failedLoginAttempts` (`Int @default(0)`) and `User.lockedUntil` (`DateTime?`), migration `20260722010000_add_login_lockout` generated via `prisma migrate diff` against a real shadow database and applied with `migrate deploy`.
- **`services/lockout.service.ts` (new):** `checkLockout(user)` (pure, no I/O), `recordFailedLogin(userId)` (increments the counter; at threshold, sets `lockedUntil` and resets the counter so the next window starts clean rather than immediately re-triggering), `clearLoginLockout(userId)` (reset on success). Deliberately DB-backed, not in-memory: Release 1 is single-instance, so this is already correct today and needs no migration when Redis-backed shared state (Release 2, P1-2) eventually replaces it for multi-instance atomicity — it's a complete, correct implementation for its target scope, not a stopgap.
- **`packages/shared`:** added `LockedException` (423 `ACCOUNT_LOCKED`) to the existing `ApiException` hierarchy, alongside `ValidationException`/`UnauthorizedException`/`ForbiddenException`.
- **`routes/auth.ts` login:** lockout is checked **before** password verification (a locked account rejects even a correct password — the whole point of lockout is time-based denial, not just stopping wrong guesses) and **after** the unknown-email check (so the enumeration-timing protection from R1-a is untouched — lockout only ever applies to accounts already confirmed to exist). A failed verification calls `recordFailedLogin`; a successful one calls `clearLoginLockout`.

## Tests (real Postgres, no mocks)

- `services/__tests__/lockout.service.test.ts` (7 tests): `checkLockout` pure-logic cases (null/future/past `lockedUntil`); `recordFailedLogin` increments below threshold, locks and resets the counter at the 5th failure, is a no-op (never throws) for a non-existent user id; `clearLoginLockout` resets both fields.
- `routes/__tests__/lockout.test.ts` (4 tests, through the real `/api/auth/login` route): 4 failures don't lock (5th, correct-password attempt still succeeds); the 5th consecutive failure locks the account and **the correct password is then rejected with 423 `ACCOUNT_LOCKED`**; the lockout expires automatically once the window elapses (forced by moving `lockedUntil` into the past directly in Postgres, proving the unlock is time-based/config-driven, not a manual action); a successful login resets the failed-attempt counter to 0.

## Production verification (the real artifact, live HTTP)

Built the backend, booted it in production mode against real Postgres, and drove the exact attack scenario the fix exists for:

```
register account (password: correct-password-1)
5x login with wrong password → 400, 400, 400, 400, 400
6th login attempt with the CORRECT password → 423 ACCOUNT_LOCKED
  {"lockedUntil":"2026-07-22T14:54:40.284Z"}
```

## Security / architecture / performance review

- **Security:** closes CRITICAL-003. Lockout triggers on the account, independent of source IP, so it isn't bypassed by rotating IPs (a limitation the global IP rate-limiter alone has). Checking lockout before password verification means an attacker cannot use a correct-password oracle to distinguish "locked" from "wrong password" as a way to skip past the lockout.
- **Architecture:** follows the exact module shape of `password.service.ts`/`token.service.ts` — small, dependency-injected via `@synora/database`'s shared client, directly unit-testable with no mocking.
- **Performance:** one indexed lookup (`User.id` is the PK) plus one update per failed/successful attempt; negligible, and only on the login path, never on authenticated request traffic.

## Verification summary

Backend type-check ✅ · lint 0 errors ✅ · 11 targeted tests ✅ · full suite 199 backend + 1 web ✅ · full build 5/5 ✅ · production boot with a live 5-failures-then-locked-then-423-on-correct-password cycle over real HTTP ✅ — all against live Postgres 16.
