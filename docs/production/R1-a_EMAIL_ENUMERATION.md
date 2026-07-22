# R1-a: Email Enumeration Resistance (login)

**Status:** ✅ Complete (login vector). Register duplicate-signup reveal is documented and deferred to email verification in R2.
**Master plan item:** P0-6 (security audit CRITICAL-004)
**Release:** 1

## What was wrong (verified from source)

`routes/auth.ts` login already returned an identical *message* (`'Invalid email or password'`) for both "no such account" and "wrong password" — but a **timing side channel** remained: for an unknown email the handler returned immediately after the failed `findUnique`, while for a known email it ran a full ~77ms Argon2 verify. An unauthenticated attacker could therefore distinguish registered from unregistered emails by response latency alone, and harvest a valid-account list for password-spraying.

## What changed

- `services/password.service.ts`: added `fakeVerifyPassword(password)` — performs a real Argon2 verify against a fixed, module-loaded dummy hash, always returns `false`, and exists purely to spend the same wall-clock time a genuine verification would.
- `routes/auth.ts` login: when the account does not exist (or has no password set), it now calls `await fakeVerifyPassword(password)` before returning the generic error, so the "no account" path costs the same as the "wrong password" path.

## Scope decision (honest)

The **login** enumeration vector — the serious one, because login is unauthenticated, high-volume, and scriptable — is now fully closed (identical message **and** identical timing).

The **register** endpoint still returns `'Email already registered'` on a duplicate signup, which reveals existence. This is intentional for Release 1: hiding it without an email-verification flow (send a neutral "check your inbox" and reveal nothing in the HTTP response) would break signup UX, and duplicate-email reveal on register is industry-standard and mitigated by the global rate limiter. It is fully closed in Release 2 when email-sending infrastructure lands. This document does not claim register enumeration is fixed — only mitigated.

## Tests (real Postgres, real HTTP route)

- `services/__tests__/password.service.test.ts`: `fakeVerifyPassword` always resolves `false`; it spends real (>5ms) verification time (proving the equalization is not a no-op); and it takes the same order of magnitude as a real `verifyPassword` against a real hash.
- `routes/__tests__/auth.test.ts`: login with an unknown email and login with a known email + wrong password return byte-identical status (400), error code, and message.

## Security / architecture / performance review

- **Security:** closes the timing oracle; message parity was already present. No secret in logs; the dummy hash is a constant, not derived from any user input.
- **Architecture:** the timing-equalizer lives in `password.service` alongside the other hashing primitives — one place owns all password-timing concerns.
- **Performance:** adds ~77ms only to the failed-login-for-unknown-email path (already the slow path for real accounts); no impact on successful logins or any other route. Acceptable and by design — equal timing is the security property.

## Verification

Type-check (backend) ✅ · lint 0 errors ✅ · targeted tests 22/22 ✅ against live Postgres 16. Full-suite + build verified in the R1 batch commit.
