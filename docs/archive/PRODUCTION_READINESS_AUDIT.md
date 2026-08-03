# Production Readiness Audit — Release 1

**Performed:** 2026-07-23, as a final CTO-level review before handover to a senior engineering team
**Scope:** entire repository — architecture, security, scalability, performance, code quality, database, API design, logging/monitoring, Docker, CI/CD, documentation, developer experience
**Final green commit:** `c76426370b471418600e23433dd4109ab1fec19e`, CI run [30038594061](https://github.com/Kshreeja-AI/Synora/actions/runs/30038594061) — `test` ✅ `security` ✅ `docker` ✅

This audit challenges the assumptions behind Release 1, not just re-reads
its own documentation. Two real issues were found, fixed, verified, and
shipped as part of this audit (not deferred to a follow-up):

1. **Redundant database indexes** — `User.email` and `Workspace.slug`
   each carried an explicit `@@index` duplicating the index Prisma already
   creates for their `@unique` constraint: pure write-time overhead with
   zero query benefit. Dropped both, generated migration
   `20260723192205_drop_redundant_unique_indexes`, verified against the
   full test suite (nothing depended on the redundant index — nothing
   could, since the unique index already serves every query pattern a
   plain index would). Commit `a9feeb3`.
2. **A newly-disclosed set of high/critical CVEs** — `pnpm audit --prod
   --audit-level=high` (this repo's own blocking CI gate) failed for the
   first time on this branch, one day after the branch had last been
   audited, with 17 findings (3 critical, 6 high, 8 moderate) in
   `apps/web`'s production dependency tree: `next` 15.5.20 (SSRF in Server
   Actions and in rewrites), `next-auth`/`@auth/core` (uncaught exception
   on malformed headers), and `postcss` <=8.5.11 (arbitrary file read via
   `sourceMappingURL`), the last of which required a `pnpm.overrides`
   entry since it's pinned internally by `next` itself, not a direct
   dependency this repo controls. Bumped to the latest available patched
   versions of each, verified the audit now reports zero findings, full
   suite still green. Commit `c764263`.

Also corrected one documentation inaccuracy found during the same pass:
`PROJECT_HANDOVER.md` understated the state of MFA-adjacent code — 4
support services already exist unwired in mainline (`services/mfa/`), not
only on the `recover/mfa` branch as originally written. Fixed in the same
commit as the index cleanup.

Everything else this audit checked — duplicated code, dead files beyond
the two already-flagged/documented MFA cases, TODO/FIXME/HACK comments,
unused dependencies beyond the intentionally-forward-provisioned frontend
stack, naming conventions, CORS/rate-limit configuration, error-handling
internals-leakage, and the CI/CD pipeline itself — came back clean or
already correctly documented as a deliberate Release 1 scope decision. See
section-by-section detail below.

---

## 1. Overall architecture review

The monorepo split (Next.js frontend / Express backend / Prisma-backed
Postgres / shared packages) is conventional and appropriate for the
product's current size. The backend's layering — routes validate with zod
before touching Prisma, a centralized error handler maps exception types
to status codes, config and secrets are two deliberately separate systems
(non-sensitive typed config vs. audited secret reads) — is a real,
enforced discipline, not aspirational documentation: every mutating route
actually validates, every error path actually goes through the one
handler, every secret read actually gets audit-logged with an actor tag.

The one genuine architecture gap is the frontend: `apps/web` declares
`next-auth`, `@tanstack/react-query`, `zustand`, and `axios` as
dependencies (matching `CLAUDE.md`'s stated intended stack) but the actual
page code uses raw `fetch` + `useState` + `localStorage`. This is not a
newly-discovered problem — it's already correctly flagged in
`PROJECT_HANDOVER.md`'s Known Limitations — but it means the frontend's
real architecture currently lags its declared one. Not a Release 1
blocker (the backend API is what Release 1's launch condition depends on),
but worth tracking explicitly rather than assuming the dependency list
reflects reality.

**Verdict:** sound foundation, one known and already-documented frontend gap, no undiscovered architecture violations.

## 2. Security review

- **AuthN/AuthZ:** JWT access tokens (15 min, HS256, algorithm pinned —
  closes the classic `alg:none` bypass), opaque rotating refresh tokens
  (7 day, SHA-256 hashed at rest, single-use with reuse detection),
  Argon2id password hashing with transparent bcrypt migration, per-account
  login lockout (5 attempts / 15 min, DB-backed). All independently
  tested with real Postgres, not mocked.
- **Input validation:** every mutating route validates its body with zod
  before it can reach Prisma; `ZodError` maps to 400, never 500.
- **Error handling:** stack traces and internal error messages are hidden
  outside `development` stage — verified directly in
  `middleware/errorHandler.ts`, not just by reading its comments.
- **CORS:** explicit, zod-validated (`z.string().url()`) origin allowlist,
  defaults to `localhost` only — no wildcard-plus-credentials
  misconfiguration.
- **Rate limiting:** global IP-based limit on all of `/api/*`
  (100 req/15 min default, config-driven), layered with the per-account
  lockout above.
- **Secrets:** never logged in plaintext; every read goes through
  `SecretsManager` with an audit trail; `.dockerignore` excludes every
  `.env*` file except `.env.example` from the build context.
- **Dependency/secret scanning:** this audit is the first time the
  blocking `pnpm audit --prod --audit-level=high` gate actually caught a
  real, live advisory set on this branch (see summary above) — proof the
  gate works, not just that it's configured. Gitleaks (OSS, no license)
  scans the full tree and history on every push.
- **Known, deliberately-scoped gaps:** no MFA enforced anywhere yet (core
  implementation lives on `recover/mfa`, needs rebasing — Release 2,
  R2-a); no CSRF protection (correctly deferred — Release 1 uses bearer
  tokens in the `Authorization` header, which aren't CSRF-vulnerable;
  CSRF only matters once auth moves to cookies, which is coupled to that
  same R2-b migration).

**Verdict:** no undocumented security gaps found. The one real finding (fresh CVEs) is fixed and verified.

## 3. Scalability review

Release 1 runs correctly on a **single instance** — login lockout and
rate-limit state are DB-backed, which is correct for one instance but
will not correctly share state across two or more. This is a known,
explicitly documented Release 2 item (R2-c, Redis-backed shared state),
not an oversight discovered here. The Prisma schema uses a single shared
client (fixed pre-Release-1 as P0-10) rather than per-request clients,
avoiding a common connection-pool-exhaustion mistake. All foreign-key
columns are indexed (`userId`, `workspaceId`, `projectId`, etc.) — the
audit specifically checked for missing indexes on FK/join columns beyond
the two redundant ones found and fixed, and found none missing.

**Verdict:** correctly scoped to its single-instance design goal; the multi-instance path is planned, not broken.

## 4. Performance review

No N+1 query patterns found in the route handlers reviewed (each route's
Prisma calls are direct, single-purpose queries, not loops issuing
per-item queries). The two redundant indexes fixed in this audit were a
real, if minor, write-path cost (every `INSERT`/`UPDATE` on `User` or
`Workspace` was maintaining a second index that could never be used,
since the unique index already covers the only query pattern a plain
index on the same single column could help with). Response bodies are
capped (`express.json({ limit: '10mb' })`), and the AI abstraction layer
correctly defaults `maxTokens` rather than leaving it unbounded. No other
performance issues surfaced.

**Verdict:** clean; one real (minor) issue found and fixed.

## 5. Code quality score: **8/10**

Strong points: zero `TODO`/`FIXME`/`HACK` comments anywhere in source; zero
lint errors; strict TypeScript throughout with zero `any` in
production-reachable code (the 22 pre-existing lint warnings are entirely
in already-dead, already-documented `services/mfa/*` files, plus a
handful of test-file `any`s); every mutating route has both a happy-path
and a validation-failure test. Points held back: the frontend's
architecture-vs-dependencies drift noted above, and the pre-existing
orphaned `services/mfa/*` directory, which — while correctly understood
and documented — is still four files of tested code sitting unused in the
tree today.

## 6. Maintainability score: **8/10**

The per-item production docs (`docs/production/R1-a_*.md` through
`R1-g_*.md`) pairing every shipped change with what-was-wrong /
what-changed / how-it-was-verified is a genuinely strong pattern that
will save a new engineer real time. The AI provider abstraction
(`apps/backend/src/ai/`) is a good example of extensibility done right —
one generic OpenAI-compatible adapter serves five providers, adding a
sixth is a config entry, not new code. Held back half a point for the
volume of historical, dated audit/certification markdown files at the
repo root, which risk being mistaken for living documents by a new
engineer scanning the root directory (mitigated by `PROJECT_HANDOVER.md`
explicitly calling this out and naming which docs are current).

## 7. Production readiness score: **9/10**

All three CI gates (`test`, `security`, `docker`) are green on the final
commit, verified via the GitHub API, not asserted from memory. The full
production verification checklist (build, 274 tests, live boot exercising
`/health`, `/ready`, register, login, refresh with rotation and
reuse-detection, logout with revocation, the AI endpoint's clean failure
path, and account lockout) passes against the actual built artifact. The
one point held back reflects Release 1's own explicitly-scoped gaps (no
MFA, no CSRF, single-instance only, manual deploys) — every one of them a
documented decision with a stated rationale, not a surprise, but real
enough to keep this from being a 10.

## 8. Technical debt remaining

- `services/mfa/*` (4 files) — dead code today, real code tomorrow (R2-a);
  needs re-review against `recover/mfa`'s `mfa.service.ts` during that
  rebase, not just a straight re-enable.
- Frontend dependency-vs-implementation drift (`next-auth`,
  `@tanstack/react-query`, `zustand`, `axios` declared, not used yet).
- Historical audit/certification markdown at the repo root — accurate as
  point-in-time records, actively misleading if mistaken for current
  status; `PROJECT_HANDOVER.md` flags this but the files themselves
  remain.
- No CD pipeline — every deploy is a manual, documented sequence of
  commands (R2-e).
- No `/metrics` endpoint or alerting beyond `/health`/`/ready` and winston
  console logs (R2-f).

None of these block Release 1. All are either already scheduled in
`RELEASE_2_PLAN.md` or newly flagged above for that plan to pick up.

## 9. Known limitations

Unchanged from `PROJECT_HANDOVER.md` §11 — re-verified accurate during
this audit, with one correction applied (the `services/mfa/` clarification
described above): no MFA enforced, no CSRF protection (both deliberately
deferred, not missing by accident), single-instance-only shared state, no
media generation (text/code only), manual deploys, minimal observability,
backup/restore delegated to the managed Postgres provider, no workspace
multi-tenancy enforcement beyond per-user scoping, and the frontend
state-management gap noted above.

## 10. Recommendations for Release 2

In priority order, matching `RELEASE_2_PLAN.md`'s own sequencing, with one
addition from this audit:

1. Land M1 (MFA rebase + CSRF/cookie-auth migration) first, per the
   existing plan's rationale — the longer these wait, the more the
   `recover/*` branches drift from mainline.
2. **New, from this audit:** when rebasing MFA, explicitly re-verify the
   4 already-in-mainline `services/mfa/*` files against whatever
   `recover/mfa`'s `mfa.service.ts` actually expects from them — don't
   assume they're still a drop-in fit after sitting unwired since before
   Release 1.
3. Re-run a dependency audit (`pnpm audit --prod --audit-level=high`)
   immediately before cutting the Release 2 branch, not just relying on
   CI's per-push gate — this audit found that a full day's gap was enough
   for 17 new findings to appear; the gate catches it on push, but a
   fresh audit at branch-cut time costs nothing and confirms the starting
   point is clean.
4. Once M1 lands, consider whether the frontend's declared state-
   management stack should finally be wired in, or whether that's better
   scoped as its own explicit Release 2/3 item rather than assumed.
5. Proceed with M2 (Redis) → M3 (media) → M4 (CD/observability/backups) →
   M5 (closeout) as planned.

---

## Conclusion

**A) Release 1 is production-ready.**
