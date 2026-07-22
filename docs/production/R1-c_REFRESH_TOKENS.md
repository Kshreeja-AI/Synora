# R1-c: Refresh Tokens + Real Logout Invalidation

**Status:** ✅ Complete
**Master plan item:** P0-4 (security audit CRITICAL-002/005)
**Release:** 1

## What was wrong (verified from source)

`routes/auth.ts` issued a single 15-minute access JWT on login with no way to renew it — a customer would be forced to re-enter their password every 15 minutes, which is unusable. `POST /logout` was a no-op returning a canned success message with no session state to revoke. A stolen access token therefore remained valid for its full lifetime regardless of "logout," and there was no mechanism to end a session server-side at all.

## What changed

### Schema: `RefreshToken` model

Added to `packages/database/prisma/schema.prisma` (migration `20260722000000_add_refresh_token`, generated via `prisma migrate diff` against a real shadow database and applied with `migrate deploy`): `tokenHash` (unique), `userId` (FK, cascade delete), `expiresAt`, `revokedAt`. Only the **SHA-256 hash** of the opaque refresh token is stored — a database read alone cannot mint a session, matching the design already used for password hashing in this codebase.

### `services/token.service.ts` (new)

- `issueTokens(claims)`: signs a short-lived HS256 access JWT (unchanged expiry, still validated the same way by `middleware/auth.ts`) and creates a new, cryptographically-random (48 bytes, base64url) refresh token record.
- `rotateTokens(rawRefreshToken)`: looks up by hash; returns `null` (never throws) if the token is unknown, revoked, expired, or belongs to a non-`ACTIVE` user. On success, **revokes the presented token and issues a new pair in one `prisma.$transaction`** — rotation means a refresh token is single-use; presenting it again after it has been rotated is a leaked/reused-token signal and is rejected.
- `revokeRefreshToken(raw)`: idempotent revoke (a second call on an already-revoked token is a no-op, so double-logout never errors).
- `revokeAllUserTokens(userId)`: revokes every active session for a user — available now for a future "log out everywhere" / forced-invalidation-on-password-change feature, not yet wired to a route in R1.
- `durationToMs(duration)`: parses the existing `jwtRefreshExpiry` config string (`"7d"`, etc.) into milliseconds for the DB expiry, so the refresh token's server-side lifetime and its documented config value can never drift apart. Throws on unparseable input rather than silently producing `NaN`.

### `routes/auth.ts`

- `/register` and `/login` now call `issueTokens()` and return `{ accessToken, refreshToken, token, user }` — `token` is kept as a deprecated alias for `accessToken` so the current bearer-token frontend (not yet rewritten — that's R2/R1-P1-4) keeps working unmodified.
- **New `POST /api/auth/refresh`**: exchanges a valid refresh token for a new pair. Invalid/expired/revoked → 401 `Unauthorized`.
- **`POST /api/auth/logout`** now actually revokes the presented refresh token via `revokeRefreshToken()`. This is what makes logout real: the access token still expires on its own short clock, and no new one can be minted without a live refresh token.

## Tests (real Postgres, real HTTP routes, no mocks)

- `services/__tests__/token.service.test.ts` (4 tests): `durationToMs` unit parsing (all units, bare-number-as-seconds, whitespace tolerance, throws on garbage).
- `routes/__tests__/session.test.ts` (8 tests, the core of this work): register issues both tokens; refresh returns a new pair and **rotates** (the old token is provably rejected on reuse — a direct reuse-detection test, not just a happy path); a second refresh with the *new* token succeeds; logout revokes so a subsequent refresh is rejected; logout is idempotent; an unknown token is rejected; an **expired** token (forced by moving `expiresAt` into the past directly in Postgres) is rejected; a refresh for a user whose status was changed to `SUSPENDED` is rejected; missing-field requests 400.
- `routes/__tests__/auth.test.ts`: extended to assert `accessToken`/`refreshToken` are present on login, alongside the existing `token` alias check.

## Production verification (not just unit tests — the real artifact)

Built the backend, booted it in production mode (`NODE_ENV=production`, real secrets as env, real Postgres), and drove the entire lifecycle over real HTTP:

```
register  → 201, accessToken + refreshToken issued
refresh   → 200, new pair issued
reuse old refresh token → 401 (rotation/reuse-detection confirmed live)
logout with new refresh token → 200
refresh after logout → 401 (revocation confirmed live)
```

## Security / architecture / performance review

- **Security:** closes CRITICAL-002 (no refresh mechanism, forcing either unusable 15-min sessions or the temptation to issue long-lived access tokens) and CRITICAL-005 (logout was fully cosmetic) at once. Only token hashes are stored. Rotation means a captured-in-transit or logged refresh token has a one-time window before reuse is detectable. Non-`ACTIVE` users cannot refresh, so suspending an account takes effect on their next token cycle even if they're mid-session.
- **Architecture:** `token.service.ts` follows the same pattern as `password.service.ts` — a small, DI-free, directly-testable module the routes call into, not logic embedded in the route handler.
- **Performance:** refresh does one indexed lookup (`tokenHash` is `@unique`) plus a two-statement transaction; negligible cost, off the hot per-request path (only invoked on the refresh cadence, not every request).

## Verification summary

Backend type-check ✅ · lint 0 errors ✅ · 17 targeted tests ✅ · full suite 188 backend + 1 web ✅ · full build 5/5 ✅ · production boot + live register/refresh/rotate/reuse-reject/logout/post-logout-reject cycle over real HTTP ✅ — all against live Postgres 16.
