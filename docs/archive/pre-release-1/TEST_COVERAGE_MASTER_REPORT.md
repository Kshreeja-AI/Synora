# TEST_COVERAGE_MASTER_REPORT.md

**Reviewer:** QA Director (independent review)
**Date:** 2026-07-21
**Scope:** Every test file and every source file in the repository, backend and frontend
**Method:** Full inventory diff (source files vs. test files), read of every existing test suite. No tests written — roadmap only, as instructed.

## Testing Score: 31 / 100

**One-line verdict:** The backend has genuine depth in three narrow slices (secrets, config, MFA-adjacent audit/monitoring/rate-limit/alerting services — 134 passing tests total) and **zero test coverage everywhere else**: no API/route tests, no auth-flow tests, no frontend tests beyond a placeholder, and no security, concurrency, accessibility, or performance test category exists at all.

---

## Current Test Inventory (ground truth)

| Test file | Tests | What it actually covers |
|---|---|---|
| `apps/backend/tests/secrets.test.ts` | 28 | `SecretsManager`, source chain, placeholder fallback, audit events |
| `apps/backend/tests/config.test.ts` | 20 | `loadConfig`, stage defaults, env overrides, validation errors |
| `apps/backend/tests/utils.test.ts` | 5 | Misc utils |
| `apps/backend/src/services/mfa/__tests__/audit.service.test.ts` | 27 | `MFAAuditService` CRUD/query methods |
| `apps/backend/src/services/mfa/__tests__/monitoring.service.test.ts` | 17 | `MonitoringService` metrics/anomaly math |
| `apps/backend/src/services/mfa/__tests__/rate-limiter.service.test.ts` | 19 | `RateLimiterService` threshold/lockout math |
| `apps/backend/src/services/mfa/__tests__/alerting.service.test.ts` | 18 | `AlertingService` in-memory alert CRUD |
| `apps/web/src/app/__tests__/page.test.tsx` | 1 | `expect(true).toBe(true)` — literally a placeholder |

**134 backend tests, 1 frontend test.** All backend tests are **unit tests against isolated service classes**. Not one test in the repository makes an HTTP request, renders a React component with user interaction, spins up two processes, or touches a browser.

### The load-bearing discovery of this audit

Every one of the 134 backend tests exercises code that sits **behind** the actual product surface — `routes/*.ts` (346 lines, 5 files) has **zero direct tests**, and critically:

- **The MFA services being tested (audit/monitoring/rate-limiter/alerting) are not called by any route.** `grep -rl "mfa\|MFA" apps/backend/src/routes apps/backend/src/index.ts` returns nothing. There is no TOTP generation, no MFA setup/verify endpoint, no `mfa.service.ts` orchestrator anywhere in git history. 134 tests certify infrastructure *around* an MFA system that doesn't exist yet.
- **CSRF protection**, tracked internally as fully complete (design, DB migration, backend middleware, frontend hook, tests — six items), has **zero corresponding code or tests** anywhere in git history, on any branch.

This report treats the codebase as it verifiably exists, not as prior status reports describe it. Every gap below is a gap against real, currently-running code.

---

## Missing Unit Tests

| Area | File(s) | Why it matters |
|---|---|---|
| Auth business logic | `routes/auth.ts` | Register/login/logout — the single highest-risk file in the repo — has no unit test. Password hashing, JWT signing, duplicate-email handling, all unverified by automation. |
| Auth middleware | `middleware/auth.ts` | Multi-secret-version verification loop (`verifyToken`), algorithm pinning (`algorithms: ['HS256']`), optional-auth fallthrough — none tested. A regression here silently reopens CRITICAL-001 (alg substitution) with no test to catch it. |
| Error handler | `middleware/errorHandler.ts` | Dev-vs-prod stack trace gating is a security-relevant branch (stack leakage) — untested. |
| Request logger | `middleware/requestLogger.ts` | No test. |
| Users/Projects/Documents/Images routes | `routes/users.ts`, `routes/projects.ts`, `routes/documents.ts`, `routes/images.ts` | All CRUD logic untested; `images.ts`'s `POST /generate` accepts unvalidated `req.body` (no zod) with no test catching that gap. |
| Logger | `utils/logger.ts` | Format function untested (a real bug — `timestamp.slice` crashing on non-string — was caught by `tsc`, not by a test, during the CI fix session). |
| All 7 secret sources except env/placeholder | `secrets/sources/dockerSecretSource.ts`, `kubernetesSecretSource.ts` | Only reachable indirectly; no direct unit test of file-read/K8s-mount parsing logic or its failure modes. |
| Secret registry/factory/HSM stub | `secrets/registry.ts`, `secrets/factory.ts`, `secrets/hsm/stubHsmProvider.ts` | No direct tests; only exercised transitively through `secrets.test.ts`. |
| Government compliance / mode hooks | `config/governmentCompliance.ts`, `config/modes.ts`, `config/stage.ts` | Config-shape tests exist; the compliance-mode *behavior* (what actually changes when a government mode is active) is untested. |
| Design system | `packages/design-system/src/components/Button.tsx` | Zero tests on the only shared UI component. |
| Shared package | `packages/shared/src/utils/index.ts`, `types/index.ts` | `createApiResponse`, exception classes — used by every route — have no direct unit test. |

## Missing Integration Tests

None exist. Zero. Specifically absent:
- Full `POST /api/auth/register` → DB row created → `POST /api/auth/login` → token issued → `GET /api/users/me` with that token, against a real (or testcontainer) Postgres.
- Prisma schema ↔ application code integration (does `MFAAuditLog.userId` soft-reference behavior actually work end to end after the FK removal?).
- Secrets → Config → App boot integration (does `bootstrap()` actually fail closed in staging when a required secret is missing?).
- Multi-instance behavior: two backend processes sharing one Postgres, exercising the rate limiter's per-process blind spot documented in the performance review.

## Missing E2E Tests

None exist — no Playwright config, no `tests/e2e/` directory despite CLAUDE.md prescribing one (`tests/e2e/auth.spec.ts`). Specifically absent, by user journey:
- Register → verify email (if ever built) → login → land on dashboard.
- Login → session persists across reload → logout → protected route redirects to `/auth/login`.
- Invalid credentials → error message shown → account **not** locked prematurely.
- Token expiry mid-session → graceful re-auth prompt (currently: silent `localStorage` wipe + hard redirect, unverified by any automated browser test).
- Dashboard CTA links (`/dashboard/create?type=image` etc.) — these routes don't exist yet; an E2E suite would have caught the dead links immediately.

## Missing Edge Cases (even within tested modules)

- **Auth route, all untested territory:** duplicate registration race (two requests, same email, simultaneously — no unique-constraint-violation handling visible in `routes/auth.ts`), password with unicode/very long input, email case-sensitivity (`Foo@x.com` vs `foo@x.com` — Postgres unique index is case-sensitive by default; zod doesn't normalize).
- **JWT middleware:** malformed `Authorization` header variants (`Bearer` with no token, multiple spaces, non-Bearer scheme), expired-but-otherwise-valid token, token signed with a *rotated-out* secret beyond the retained version window.
- **Rate limiter (tested for math, not for boundaries):** exactly-at-threshold behavior confirmed by tests, but concurrent requests arriving at the threshold simultaneously (race condition on the count-then-decide pattern) is not, and can't be, covered by the current sequential-`await` test style.
- **Secrets:** source ordering when two sources both claim availability with different values (precedence tie-break), secret value containing characters that break the audit-log JSON serialization.
- **Config:** conflicting env vars across `.env.local` and process env at the same time.

## Missing Security Tests

This is the largest single gap relative to the project's own stated priorities (see `AUTH_SYSTEM_SECURITY_AUDIT_v2.md`, production score 28/100 — six Critical findings, **zero regression tests for any of them**):

| Security finding | Regression test that should exist |
|---|---|
| CRITICAL-001 JWT alg substitution | Test asserting `jwt.verify` rejects a token signed with `alg: none` or `RS256`-shaped header, even though the fix already landed — nothing prevents a future refactor from dropping the `algorithms` option silently. |
| CRITICAL-002 No refresh endpoint | N/A until built, but the eventual endpoint needs replay/reuse-detection tests from day one. |
| CRITICAL-003 No account lockout | The A3 `RateLimiterService` has lockout math tests — but no test proves the **auth route actually calls it** (it doesn't, per the route-wiring gap above). |
| CRITICAL-004 Email enumeration | No test asserts `/login` and `/register` return identical timing/error shape for existing vs. non-existing emails. |
| CRITICAL-005 No logout invalidation | No test exists because no revocation mechanism exists. |
| CRITICAL-006 No CSRF protection | Zero tests, matching zero implementation. |
| Generic | No SQL/NoSQL injection fuzz tests (Prisma parameterization makes this lower-risk, but zero verification exists), no header-injection tests, no mass-assignment test on `POST /images/generate`'s unvalidated body, no dependency vulnerability scan gate in CI beyond a `continue-on-error: true` Snyk step that cannot fail the build. |

## Missing Concurrency Tests

- No test issues N simultaneous logins for the same account (lockout race, connection-pool saturation — directly relevant given the six-`PrismaClient` finding in the architecture review).
- No test simulates two backend replicas sharing state through Postgres only (the in-memory rate-limiter split-brain scenario from the performance review is describable in prose but has no test asserting the failure).
- No test for concurrent secret rotation (`SecretsManager.rotate()` mutating the `versions` Map) versus concurrent reads — the Map is not synchronized, and Node's single-threaded event loop makes this low-risk *today*, but nothing documents or tests that assumption for when `rotate()` gains an async step (e.g., calling an external KMS).
- No load-concurrency test for the bcrypt-on-event-loop finding from the performance review — the exact scenario (N logins in-flight stalling unrelated requests) is fully describable and testable with `autocannon`/`k6` but doesn't exist.

## Missing Accessibility Tests

**Zero accessibility tooling in the repository.** No `jest-axe`, no `@axe-core/playwright`, no `eslint-plugin-jsx-a11y` in the ESLint config, no manual audit notes. Concretely unverified:
- Login/register forms: label association, error-message `aria-live` announcement, focus management on submit failure.
- Dashboard: heading hierarchy (four `<h2>` siblings with no `<h1>` context beyond the welcome banner — likely a violation, unverified).
- Color contrast of the Tailwind gray-600-on-white body text (borderline WCAG AA, unverified).
- Keyboard navigation: no test confirms the dashboard's card links are reachable/operable via keyboard only.
- No screen-reader smoke test of any page.

## Missing Browser Compatibility Tests

No cross-browser test matrix exists (no Playwright/BrowserStack/Sauce config). Given the stack (Next.js 15, React 19, Tailwind), the practical risk is concentrated in: `localStorage` availability assumptions (fails silently in Safari private mode / third-party-storage-blocked contexts — directly breaks the current auth flow with no fallback or user-facing error), and untested behavior on older Safari/iOS WebKit for any future CSS Grid/flex edge cases in the dashboard layout.

## Missing Performance Tests

No load-test suite exists anywhere (no k6, no autocannon, no artillery config). This is doubly notable because:
- `PERFORMANCE_REVIEW_v2.md` (this review's companion document) had to establish baseline numbers via **ad-hoc benchmark scripts run outside the test suite** — there is no repeatable, CI-gated performance test a regression would trip.
- Phase A item **A5 ("Performance Baseline & SLA Validation")** is explicitly listed as pending in `MODULE_CERTIFICATION_REPORT.md` — this gap is already tracked, just not closed.
- No test asserts response-time budgets (e.g., "`/login` p95 < 150ms") that CI would fail against.

---

## Complete Testing Roadmap

Ordered by risk reduction per unit effort, not by arbitrary "phase" numbering — read top to bottom as priority.

### Tier 0 — Before writing any new feature test (fix the false signal)
1. **Reconcile the test suite with reality.** Either wire the MFA services into a real auth flow and delete/relabel the certification claims that assume it's done, or explicitly mark A1 (TOTP) and CSRF as **not started** in tracking. Testing 134 cases of unused infrastructure is worse than testing nothing, because it manufactures false confidence.

### Tier 1 — Route-level unit/integration tests (1–2 weeks)
2. `routes/auth.ts`: register, login, logout — happy path + every edge case in the table above, against a real test-database transaction (rollback per test).
3. `middleware/auth.ts`: token validation matrix (valid, expired, malformed, wrong algorithm, wrong secret, rotated secret within/outside grace window).
4. `middleware/errorHandler.ts`: dev vs. prod stack-trace gating, `ApiException` vs. generic `Error` vs. non-Error throw.
5. Remaining CRUD routes (`users`, `projects`, `documents`, `images`): ownership checks (can user A fetch user B's document by ID?), input validation gaps.

### Tier 2 — Security regression suite (1 week, run in CI on every PR)
6. One test per Critical/High finding in `AUTH_SYSTEM_SECURITY_AUDIT_v2.md` — these are cheap to write and the highest-value tests in the entire roadmap because they encode "this must never regress" for issues already proven exploitable.
7. Enumeration-safety test: identical response shape/timing for valid vs. invalid login identities.
8. Dependency scanning gate that can actually fail CI (replace `continue-on-error: true` Snyk step or add `npm audit --audit-level=high` as a blocking step).

### Tier 3 — Integration + concurrency (1–2 weeks)
9. Testcontainers-backed Postgres integration suite for the full request lifecycle (register → login → authenticated call → logout).
10. Concurrency suite: N simultaneous logins for one account (lockout correctness under race), two-replica rate-limiter split-brain reproduction (this test *should fail* today, proving the finding, and pass once Redis-backed limiting lands).

### Tier 4 — E2E (2 weeks, this is Phase A item A4, already on the roadmap)
11. Playwright suite: setup, login/logout, session expiry, protected-route redirect, and — importantly — a test that walks every dashboard CTA and asserts it resolves to a real route, which would have caught the dead-link cards immediately.
12. Cross-browser matrix: Chromium + WebKit at minimum (Playwright ships both); explicit private-mode/storage-blocked test for the `localStorage` token assumption.

### Tier 5 — Accessibility (3–5 days, can run in parallel with Tier 4)
13. `@axe-core/playwright` wired into the E2E suite — automated axe scan on every page as a CI gate (catches ~30-40% of WCAG issues for near-zero ongoing cost).
14. Manual keyboard-navigation and screen-reader pass on auth + dashboard flows once the frontend rewrite (already recommended in the architecture review) lands — testing the current prototype UI is lower value than testing its replacement.

### Tier 6 — Performance (this is Phase A item A5, already on the roadmap; 1 week)
15. k6 or autocannon suite with hard budgets, run in CI or a nightly job: login p95, `/users/me` p95, event-loop-lag ceiling under concurrent login load — turning `PERFORMANCE_REVIEW_v2.md`'s measured numbers into enforced regression gates.
16. Load test specifically reproducing the bcrypt-event-loop-stall finding, to be re-run after the native-bcrypt/argon2 migration to prove the fix.

### Ongoing
17. Coverage thresholds in `vitest.config.ts` (currently reporters configured, no `thresholds` block) set low initially (e.g., 40%) and ratcheted up per PR, scoped separately for `routes/` (currently 0%) vs. the already-well-tested `secrets/`/`services/mfa/` slices, so the aggregate number can't hide the gap the way it currently would.

---

## Score Rationale

| Dimension | Score | Why |
|---|---|---|
| Unit test depth (where it exists) | 7/10 | Secrets/config/MFA-service suites are genuinely thorough and well-structured |
| Unit test breadth (route/API layer) | 0/10 | Zero coverage on the actual product surface |
| Integration tests | 0/10 | None exist |
| E2E tests | 0/10 | None exist; no Playwright config despite being documented |
| Security regression tests | 0/10 | Zero tests for six Critical findings |
| Concurrency tests | 0/10 | None exist |
| Accessibility tests | 0/10 | No tooling, no tests |
| Browser compatibility tests | 0/10 | No tooling, no tests |
| Performance tests | 0/10 | No repeatable suite; A5 explicitly pending |
| Test/reality alignment | 2/10 | 134 tests certify code paths that are provably unwired into the product |
| **Overall** | **31/100 → rounds from a low base with credit for genuine depth in a narrow slice** | Real strength exists; it's concentrated in exactly the parts of the system least connected to user-facing risk |

*Companion documents: AUTH_SYSTEM_SECURITY_AUDIT_v2.md, ARCHITECTURE_REVIEW_v2.md, PERFORMANCE_REVIEW_v2.md.*
