# Release 1 Verification Report

**Branch:** `claude/synora-ai-platform-h5q0k2`
**Final green commit:** `6c97f92ea44886f98ff9780eea0c3ba41b304c69`
**Final CI run:** [29952937907](https://github.com/Kshreeja-AI/Synora/actions/runs/29952937907) — `test` ✅ `security` ✅ `docker` ✅

This report documents every CI failure encountered while stabilizing the
`test`, `security`, and `docker` GitHub Actions jobs, the root cause of
each, the fix applied, how it was verified, and the CI evidence proving it.
An initial claim that "all GitHub Actions are green" did not match the
actual GitHub API data for that commit — every issue below was found by
checking real CI run/job data via the GitHub API, not by re-asserting
success.

---

## Issue 1 — Seven latent AI test bugs, never actually exercised

**Discovered in:** run [29948945062](https://github.com/Kshreeja-AI/Synora/actions/runs/29948945062) (commit `15aea26`), `test` job — 7 failed / 256 passed of 263.

**Root cause:** The R1-e AI provider abstraction (committed earlier as
`81917f0`) had never had its test suite run against real infrastructure:

- `ai/resolver.test.ts` called `resolveTextGenerationProvider()` without
  first calling `initConfig()` → `ConfigNotInitializedError`.
- `ai/shared.test.ts` asserted `resolveSystemPrompt()` returns a defined
  value for `mode: 'text'`, but the implementation correctly returns
  `undefined` for text mode (only `code` mode gets a default prompt) — the
  test's own expectation was wrong.
- `ai/index.test.ts` asserted a provider call with `mode: 'code-generation'`
  — a stale string left over from an earlier `TextGenerationMode` rename;
  the real type is `'text' | 'code'`.
- `ai/providers/openaiCompatible.provider.test.ts` asserted an error
  message (`'OpenAI-compatible text generation failed'`) that didn't match
  the actual per-provider message (`` `${this.id} text generation failed` ``).
- `routes/__tests__/ai.test.ts`: the `vi.mock()` factory assigned to a
  plain `let mockGenerateText` declared later in the file — since
  `vi.mock()` calls are hoisted above the rest of the module, the factory
  ran while that binding was still in its temporal dead zone
  (`ReferenceError: Cannot access 'mockGenerateText' before initialization`).
  The same file's hand-rolled error middleware also didn't map `ZodError`
  to 400 the way the real `errorHandler` does, so every validation test
  asserted the wrong status.

**Fix (commit [`bf74b7b`](https://github.com/Kshreeja-AI/Synora/commit/bf74b7b88b63081ddc01456fc3373aef2517e4d1)):**
Added `initConfig()` + a fake `ANTHROPIC_API_KEY` to `resolver.test.ts`;
corrected the `shared.test.ts` expectation to `toBeUndefined()`; fixed the
stale `'code-generation'` string in `index.test.ts`; corrected the expected
error message in `openaiCompatible.provider.test.ts`; rewrote the mock in
`ai.test.ts` using `vi.hoisted()` and swapped in the real `errorHandler`.

Also found and fixed, in the same commit, a real production bug surfaced
during this verification: ambient `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
(common in AWS-hosted environments for reasons unrelated to AI) satisfied
Bedrock's `isConfigured()` check, silently auto-activating Bedrock instead
of the intended "no provider configured" clean failure. Fixed by requiring
an explicit `BEDROCK_REGION` (no default), mirroring Ollama's existing
`OLLAMA_BASE_URL` (no default) pattern.

**Verification:** `pnpm run type-check` (0 errors), `pnpm run lint` (0
errors), full backend suite 273/273 passing locally against live Postgres,
production boot showing a clean `NoProviderConfiguredError` with zero AI
keys set.

**CI evidence:** run [29950784476](https://github.com/Kshreeja-AI/Synora/actions/runs/29950784476) (commit `bf74b7b`) — `test` job: ✅ success (all 273+1 tests, lint, type-check, build all green).

---

## Issue 2 — `pnpm prune --prod` corrupts the workspace's node_modules

**Discovered in:** run [29948945062](https://github.com/Kshreeja-AI/Synora/actions/runs/29948945062), `docker` job — smoke test failed: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv'`.

**Root cause:** An earlier fix (this session, before this report's scope)
added `CI=true` to `pnpm prune --prod` to stop it aborting on an
interactive prompt in Docker's non-TTY build environment. That let prune
actually *run* for the first time — and running it revealed a deeper bug:
`pnpm prune --prod`, invoked at this pnpm workspace's root with no
`--filter`, deletes **every** symlink under `apps/backend/node_modules`
— including production dependencies like `dotenv` — while leaving the
packages themselves untouched in the `.pnpm` content-addressable store.
`node dist/index.js` then fails on its very first import.

Verified by reproduction in a scratch clone (`git archive HEAD | tar -x`,
`pnpm install --frozen-lockfile`, `pnpm run build --filter=@synora/backend...`,
`CI=true pnpm prune --prod`): confirmed `apps/backend/node_modules/dotenv`
and, in fact, the entire `apps/backend/node_modules` directory's contents
were gone post-prune, while `node_modules/.pnpm/dotenv@16.6.1` remained.
Also tried `pnpm --filter=@synora/backend deploy --prod --legacy` as a
workspace-aware alternative — it correctly preserves production-dependency
symlinks, but performs a fresh install into a *new* virtual store that
does not carry over Prisma's already-generated client, breaking
`@prisma/client` in a different way (`SyntaxError: Named export
'PrismaClient' not found`).

**Fix (commit [`2ef36d1`](https://github.com/Kshreeja-AI/Synora/commit/2ef36d156238aad46482940a25753acf756b330d)):**
Removed the prune step entirely. The runtime stage ships the full,
already-correct `node_modules` the builder stage produced (dev tooling —
eslint, vitest, typescript, tsup, turbo — included). `docs/production/R1-f_DOCKERFILE.md`
already treats image-size optimization as an explicit, deferred-to-R2
tradeoff, so this keeps R1 correct without a deeper redesign.

**Verification:** reproduced the bug and the fix in a scratch clone;
booted the unpruned build directly (`node dist/index.js`, `NODE_ENV=production`)
and confirmed `/health` and `/ready` both return 200.

**CI evidence:** run [29951342946](https://github.com/Kshreeja-AI/Synora/actions/runs/29951342946) (commit `2ef36d1`) — `docker` job's build step succeeded and the dotenv error was gone (next issue below was a *different*, newly-surfaced failure in the same job).

---

## Issue 3 — gitleaks install script 404s

**Discovered in:** run [29948945062](https://github.com/Kshreeja-AI/Synora/actions/runs/29948945062), `security` job — `curl: (22) The requested URL returned error: 404` fetching `https://raw.githubusercontent.com/gitleaks/gitleaks/master/install.sh`.

**Root cause:** No such install script exists at that path — an incorrect
assumption made in an earlier (pre-this-report) fix attempt while
replacing the licensed `gitleaks/gitleaks-action`.

**Fix (commit [`2ef36d1`](https://github.com/Kshreeja-AI/Synora/commit/2ef36d156238aad46482940a25753acf756b330d)):**
Per this task's instruction to verify against official sources rather than
assume: queried the GHCR registry API directly
(`https://ghcr.io/v2/gitleaks/gitleaks/tags/list`) and confirmed
`ghcr.io/gitleaks/gitleaks` is a real, public, anonymously-pullable image
with 38 tags including `v8.21.2`. Replaced the broken install-script
approach with `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.21.2
detect --source=/repo --exit-code 1 --verbose` — no GitHub Action license,
no `GITHUB_TOKEN`, no account.

**Verification:** confirmed the GHCR manifest for `v8.21.2` resolves (200,
via the anonymous registry token flow) before pushing.

**CI evidence:** run [29951342946](https://github.com/Kshreeja-AI/Synora/actions/runs/29951342946) (commit `2ef36d1`) — the gitleaks image pulled and **ran successfully** (see Issue 4 — it then correctly found real pattern matches, proving the scanner itself now works).

---

## Issue 4 — gitleaks correctly found 11 pattern matches (all verified false positives)

**Discovered in:** run [29951342946](https://github.com/Kshreeja-AI/Synora/actions/runs/29951342946), `security` job, after Issue 3's fix — `leaks found: 11`.

**Root cause:** Not a bug — gitleaks was, for the first time, actually
running and scanning real git history. It correctly flagged 11 pattern
matches. Each was individually verified against the actual commit content
(`git show <commit>:<file>`) before being classified as a false positive:

| Finding | File(s) | Why it's not a real secret |
|---|---|---|
| RFC 6238/4648 base32 test vector | `totp.service.rfc6238.test.ts`, `MFA_DESIGN.md` ×2 | Explicitly commented `// RFC example`; the literal example value from the RFC spec |
| `abc123def456...` placeholder token | `CSRF_PROTECTION.md` ×3, `csrf.test.ts` | Documentation illustration / deterministic test fixture value |
| `dev-key.dev-secret` | `README.md` ×2 | README quickstart example, literally named "dev-secret" |
| JWT with `alg:none` | `AUTH_SYSTEM_SECURITY_AUDIT_v2.md` ×2 | Illustrates the exact `alg:none` vulnerability the audit found and this codebase already closed (JWT algorithm pinning, CRITICAL-001) — not a live token |

**Fix (commit [`e81d225`](https://github.com/Kshreeja-AI/Synora/commit/e81d225f318a8f2185adf50dd9c00e45ec8c3644)):**
Added `.gitleaksignore` with gitleaks' own computed fingerprint
(`commit:file:rule:line`) for each of the 11 verified entries, so the gate
stays fully blocking for any real secret while these known examples don't
fail every run.

**Verification:** every finding read from the actual git blob at its
reported commit/line before being allowlisted — none accepted on the scan
tool's word alone.

**CI evidence:** run [29951790817](https://github.com/Kshreeja-AI/Synora/actions/runs/29951790817) (commit `0af2ca6`, includes `e81d225`'s `.gitleaksignore` cumulatively) — `security` job: ✅ success.

---

## Issue 5 — winston File transport crashes the container (EACCES)

**Discovered in:** run [29951342946](https://github.com/Kshreeja-AI/Synora/actions/runs/29951342946), `docker` job (after Issue 2's fix removed the dotenv failure) — `Error: EACCES: permission denied, mkdir 'logs'`.

**Root cause:** `utils/logger.ts` unconditionally added two winston `File`
transports writing to a relative `logs/` directory. `File`'s constructor
synchronously calls `mkdirSync` for that directory. The production
container runs as the non-root `node` user (`USER node` in the Dockerfile)
against a root-owned `/app`, so it can't create the directory — the
process crashed at module-import time, before ever calling
`app.listen()`. This was invisible in every earlier local "production
boot" check because those ran the built artifact directly on this
sandbox's host, as root, where the permission check never applied.

**Fix (commit [`0af2ca6`](https://github.com/Kshreeja-AI/Synora/commit/0af2ca670ae116f3589982645d17cd52ed71b71e)):**
Only add the `File` transports outside `NODE_ENV=production`. A
container's filesystem is ephemeral and log files written to it are lost
on restart anyway, so Console-only output (captured by `docker logs`/any
real orchestrator) is the correct behavior for every real deployment
target — not merely a permissions workaround. Local development keeps its
`logs/error.log` + `logs/all.log` files.

**Verification:** rebuilt, booted with `NODE_ENV=production`, confirmed no
`logs/` directory is created and `/health` responds 200; full backend
suite (273 tests) unaffected.

**CI evidence:** run [29951790817](https://github.com/Kshreeja-AI/Synora/actions/runs/29951790817) (commit `0af2ca6`) — `docker` job's smoke test no longer crashes at startup (container logs show a clean `🚀 Server running...`); a *different*, newly-surfaced issue follows in Issue 6.

---

## Issue 6 — server not reachable through Docker's port mapping

**Discovered in:** run [29951790817](https://github.com/Kshreeja-AI/Synora/actions/runs/29951790817), `docker` job — smoke test timed out after 30s; container logs showed `🚀 Server running at http://localhost:3001` with **no crash**, but zero incoming requests ever reached the request-logging middleware.

**Root cause:** `app.listen(config.server.port, callback)` in `index.ts`
omitted the host argument, leaving Node to choose a default bind address.
This is exactly the kind of behavior that can vary by environment; every
earlier local verification ran the process directly on the host, in the
same network namespace as the `curl` check, so this had never had a
chance to surface — only an actual Docker container, reached through its
published port from *outside* its network namespace, exercises this path.

**Fix (commit [`a78c533`](https://github.com/Kshreeja-AI/Synora/commit/a78c53308074bcebd3c57d2e15fefc392c721877)):**
Bind explicitly to `0.0.0.0` — `app.listen(config.server.port, '0.0.0.0', callback)`. This is the standard, unambiguous practice for any containerized Node/Express server.

**Verification:** rebuilt, booted locally, confirmed still reachable via
both `127.0.0.1` and `localhost`; full backend suite unaffected.

**CI evidence:** run [29952316977](https://github.com/Kshreeja-AI/Synora/actions/runs/29952316977) (commit `a78c533`) — the health-check request now reaches the app (see Issue 7 — it then crashed on a *different*, newly-reachable code path, proving the binding fix worked).

---

## Issue 7 — Prisma's query engine can't load: missing OpenSSL

**Discovered in:** run [29952316977](https://github.com/Kshreeja-AI/Synora/actions/runs/29952316977), `docker` job, immediately after Issue 6's fix — `PrismaClientInitializationError: ... Details: libssl.so.1.1: cannot open shared object file`.

**Root cause:** `node:22-bookworm-slim` ships with no OpenSSL at all
(unlike the full, non-slim `node:22-bookworm` image). Prisma's platform
detection queries the local OpenSSL version at `prisma generate` time to
choose which pre-built query-engine binary to bundle; finding none
installed, it silently fell back to a stale default target
(`debian-openssl-1.1.x`) instead of the real one (bookworm is OpenSSL
3.x) — and since no SSL library exists anywhere in the image, that
mismatched engine can't load at runtime either, whenever a request
actually touches Prisma. This was invisible locally for the same reason
as Issue 5: this sandbox's own host OS already has a full OpenSSL
install, unlike the minimal container image.

**Fix (commit [`6c97f92`](https://github.com/Kshreeja-AI/Synora/commit/6c97f92ea44886f98ff9780eea0c3ba41b304c69)):**
Verified against Prisma's own documented requirement for Debian-slim Docker
images before making this change (per this task's explicit instruction to
check official documentation rather than assume). Installed
`openssl` via `apt-get` in **both** the builder stage (so `prisma generate`
detects the real OpenSSL 3.x and bundles the matching engine) and the
runtime stage (so that engine can actually load when a request needs it).

**Verification:** Dockerfile-only change; confirmed the package name
(`openssl`) is a standard, universally-available Debian bookworm package
(not a guessed URL); type-check/lint unaffected; deferred final
confirmation to the real CI Docker build (the only environment that can
actually exercise this).

**CI evidence:** run [29952937907](https://github.com/Kshreeja-AI/Synora/actions/runs/29952937907) (commit `6c97f92`) — `docker` job: ✅ success, smoke test completed in 2 seconds.

---

## Final CI state — all three jobs green

Run [29952937907](https://github.com/Kshreeja-AI/Synora/actions/runs/29952937907), commit `6c97f92ea44886f98ff9780eea0c3ba41b304c69`:

| Job | Conclusion | Key steps |
|---|---|---|
| `test` | ✅ success | checkout → pnpm/node setup → install → db:generate → db:migrate → lint ✅ → type-check ✅ → tests ✅ → build ✅ → coverage upload ✅ |
| `security` | ✅ success | install → `pnpm audit --prod --audit-level=high` ✅ → gitleaks (Docker image) ✅ → Snyk (best-effort) ✅ |
| `docker` | ✅ success | Buildx setup → image build ✅ → smoke test (`/health` responds 200) ✅ |

---

## Final production verification (performed locally, after CI went green)

This sandbox has no Docker daemon (`docker info` fails), so the actual
container image build/boot is verified authoritatively by the `docker` CI
job above, which does have one. To supplement, the same built artifact
(`apps/backend/dist/index.js`, identical bundle to what ships in the
image) was run directly in production mode against live Postgres 16 and
exercised end-to-end:

```
pnpm run build            → 5/5 tasks ✅
pnpm vitest run            → 273 backend + 1 web = 274/274 tests ✅

Production boot (NODE_ENV=production, real secrets as env, live Postgres):
  GET  /health                          → 200 {"status":"ok",...}
  GET  /ready                           → 200 {"status":"ready","checks":{"database":{"status":"ok",...}}}
  POST /api/auth/register               → 201, accessToken + refreshToken issued
  POST /api/auth/login                  → 200, accessToken + refreshToken issued
  POST /api/auth/refresh                → 200, new token pair (rotation confirmed)
  POST /api/auth/refresh (reused token) → 401 UNAUTHORIZED (reuse-detection confirmed)
  POST /api/auth/logout                 → 200, refresh token revoked
  POST /api/auth/refresh (post-logout)  → 401 UNAUTHORIZED (revocation confirmed)
  POST /api/ai/generate (no key set)    → 500 to client (production hides detail);
                                           server log: clean NoProviderConfiguredError
  5× POST /api/auth/login (wrong pw)    → 400 × 5
  6th POST /api/auth/login (correct pw) → 423 ACCOUNT_LOCKED
```

Every endpoint the task specified — `/health`, `/ready`, register, login,
refresh, logout, the AI endpoint, and account lockout — was exercised over
real HTTP against the actual built artifact and behaved correctly.

## Release 1 status: complete

All CI gates (`test`, `security`, `docker`) are green on commit
`6c97f92`. All eight Release 1 blockers (R1-a through R1-h, see
`RELEASE_1_LAUNCH_READINESS.md`) are implemented, tested, and verified.
No known issues remain.
