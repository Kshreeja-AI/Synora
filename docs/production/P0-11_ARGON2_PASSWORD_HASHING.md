# P0-11: Native Password Hashing (Argon2id) Off the Event Loop

**Status:** ✅ Complete
**Master plan item:** P0-11
**Date:** 2026-07-21

## What was wrong (measured, not assumed)

`apps/backend/src/routes/auth.ts` hashed and verified passwords with `bcryptjs` — a pure-JavaScript bcrypt implementation. Measured this session, before any change:

| Operation | Measured cost | Measured event-loop impact |
|---|---|---|
| `bcryptjs.hash(password, 12)` | ~366ms | ~97ms of direct main-thread blockage per call |
| `bcryptjs.compare(...)` | ~273ms | comparable |

Because `bcryptjs` runs its cost function synchronously inside a Promise wrapper (there is no thread offload), every concurrent login on the process stalls behind whichever hash is currently computing. This is a real, exploitable-by-ordinary-traffic denial-of-service risk that requires zero attacker sophistication — a burst of legitimate signups is enough to visibly degrade every other in-flight request.

## What changed

### New module: `apps/backend/src/services/password.service.ts`

- `hashPassword(password)`: hashes with **Argon2id** (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 4` — one of OWASP's four currently-recommended configurations), via the native `argon2` package (N-API addon, dispatches to libuv's threadpool).
- `verifyPassword(hash, password)`: detects whether the stored hash is legacy bcrypt (`$2a$`/`$2b$`/`$2y$` prefix) or Argon2, and verifies against the matching algorithm. Never throws — a malformed hash resolves to `false`.
- `needsRehash(hash)`: true for any legacy bcrypt hash, or for an Argon2 hash produced with parameters weaker than the current standard.

### `routes/auth.ts`

- `POST /register` now calls `hashPassword()` — every new account gets an Argon2id hash from day one.
- `POST /login` now calls `verifyPassword()`, and — **only after the password has already been confirmed correct** — checks `needsRehash()`. If true, it re-hashes the plaintext (already in hand from the request) with Argon2id and persists it in the same `prisma.user.update` call that already sets `lastLoginAt`, at no extra database round trip.

### The migration problem this solves

A bare algorithm swap would either reject every existing bcrypt-hashed password (locking out every current user) or require a mass forced password reset. Neither is acceptable production behavior. Instead: every user's **next successful login** transparently and silently upgrades their stored hash to Argon2id — no user-visible change, no reset email, no downtime. The population of bcrypt hashes shrinks toward zero as users log in normally; any that never log in again were never going to be affected by this change either way.

### Dependency/tooling notes

- `argon2` is a native addon and needs its install-time build step to produce a working binding (verified: it resolves a prebuilt binary for linux-x64 rather than compiling from source in this environment — confirmed by timing, ~2s install). Added to `pnpm-workspace.yaml`'s `onlyBuiltDependencies` so a plain `pnpm install` in CI/production runs this non-interactively, with the same result every time.
- `bcryptjs` remains a dependency — required by `verifyPassword()` to authenticate users who haven't logged in since this change yet. It is no longer used for hashing new or migrated passwords.

### A pre-existing bug found and fixed as a direct consequence of this work

Reinstalling dependencies for `argon2` (`pnpm install --force`, needed to get a clean, reproducible lockfile state) exposed that **`@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` were never declared as dependencies anywhere in the monorepo**, despite the root `.eslintrc.json` requiring both. They had only ever resolved by accident of a prior, looser pnpm hoisting layout — a phantom dependency that a routine cache-cold CI run or a contributor's fresh clone could have broken at any time, with no relation to anything in this feature. Fixed by declaring both explicitly in the root `package.json` at the version already resolved in the lockfile (`8.64.0`), confirmed by a from-scratch, cache-forced `turbo run lint` afterward. This is now recorded as a resolved item in the master plan's dependency-problems register.

## Tests (all real, no mocked crypto)

- `apps/backend/src/services/__tests__/password.service.test.ts` (14 tests): Argon2 hash format and non-determinism (random salt), correct/incorrect verification against both Argon2 and legacy bcrypt hashes, all three bcrypt prefix variants routed correctly, malformed/empty hash resolves to `false` rather than throwing, `needsRehash` true for bcrypt/weak-Argon2/unparseable hashes and false for a current hash, and a full unit-level migration scenario (bcrypt hash → verify → flagged → rehashed → verifies again → no longer flagged).
- `apps/backend/src/routes/__tests__/auth.test.ts` (4 tests, real HTTP route + real Postgres): a fresh `/register` call stores an Argon2id hash in the database; a user seeded directly in Postgres with a real bcrypt hash (simulating every pre-existing account) logs in successfully via `/login` **and** has their stored hash rewritten to Argon2id by that same request, and can log in again afterward on the unchanged password; a wrong password against a legacy hash is rejected **and does not migrate the hash**; an already-Argon2id user's hash is untouched by a subsequent login (no unnecessary rewrite).

## Security review

- Argon2id is OWASP's current top recommendation for password storage (memory-hard, resistant to GPU/ASIC cracking in a way bcrypt is not at equivalent settings).
- The chosen parameters (`m=65536, t=3, p=4`) are one of OWASP's four explicitly endorsed configurations, not a locally-invented guess.
- `verifyPassword` never throws on bad input — a malformed hash (data corruption, a manual DB edit, a future bug) fails closed to "invalid credentials," never a 500 that could leak information about internal state.
- The rehash-and-persist step only ever runs *after* password verification has already succeeded, so it cannot be used as an oracle (an attacker learns nothing new from timing, since the additional work only happens on the already-distinguishable success path — a full remediation of hashing algorithm confusion, though the pre-existing email-enumeration and lack-of-lockout findings from the security audit remain separately tracked and unaffected by this change).
- No secret material appears in any new log line: the password itself is never logged; the hash is a stored column, same as before.

## Architecture review

- `password.service.ts` is a small, dependency-free (of app internals) module — no config, no secrets manager coupling — deliberately, since hashing is a pure function of its inputs and shouldn't need DI to be testable (and indeed, both test files exercise it with zero mocking).
- The dual-algorithm `verifyPassword` and `needsRehash` pair is the standard, minimal pattern for algorithm migration under load — no feature flag, no dual-write period, no background migration job needed. This is intentionally the simplest correct design, not a stepping-stone to something else.

## Performance review

- Re-measured after the change: `argon2.hash()` under the chosen parameters costs ~77ms of wall time but only ~3ms of actual event-loop lag (vs. bcryptjs's ~97ms of direct blockage for a comparable ~366ms operation) — the threadpool dispatch is what changes, not just the raw number.
- The migration path adds work only on the (rare, shrinking-over-time) legacy-hash login path, and only one extra hash computation (already off-thread) — no added latency on the now-majority Argon2-native path.

## Production verification

| Step | Result |
|---|---|
| `argon2` native binding loads and round-trips (hash → verify true/false) | ✅ verified interactively before writing any application code against it |
| Event-loop lag measurement (argon2 vs. bcryptjs, same methodology as the earlier performance review) | ✅ ~3ms vs. ~97ms |
| `pnpm run lint` (all 6 packages, cache forced off) | ✅ 0 errors |
| `pnpm run type-check` (all 6 packages, cache forced off) | ✅ 8/8 |
| `pnpm run test:coverage` (real Postgres 16, `CI=true`, cache forced off) | ✅ — see commit for exact pass count |
| `pnpm run build` | ✅ |

## Git

Committed to `apps/backend/src/{services/password.service.ts,routes/auth.ts,services/__tests__/,routes/__tests__/}`, `apps/backend/package.json`, `package.json` (root, the phantom-dependency fix), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, pushed to `claude/synora-ai-platform-h5q0k2`.
