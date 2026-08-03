# M1 Verification Report — Release 3, Milestone 1

**Subject commit:** `fb1c1b6bce6f46bf119ef3a70424c16a3196dcdb` (M1 close-out:
Conversation/Message schema tests + docs), on branch
`claude/synora-ai-platform-h5q0k2`, PR #38.

**Workflow run:** [`30481629336`](https://github.com/Kshreeja-AI/Synora/actions/runs/30481629336)
("CI Pipeline"), triggered by the push of `fb1c1b6`. All data below is
read directly from that run's jobs, steps, and logs — not re-derived
locally, except where explicitly marked "local re-run" for a gate GitHub
Actions doesn't expose as its own job/step.

**Overall result at the time of this report: all three GitHub check runs
(`test`, `security`, `docker`) report `success`.** Two non-blocking defects
were found in gate *plumbing* (not in M1's code) during the deep read of
this run's logs; both are fixed in this same pass (see "Fixes applied").

---

## Gate-by-gate

### ✓ lint

- **Status:** PASS
- **Where it runs:** `test` job → step "Lint" (`pnpm run lint`, which is
  `turbo run lint` across all 6 workspace packages).
- **Duration:** 22s (18:49:53 → 18:50:15 UTC).
- **Warnings:** 44, all `@typescript-eslint/no-explicit-any` on mock
  objects inside pre-existing test files (`ai/index.test.ts`,
  `ai/providers/*.test.ts`, `billing/**/*.test.ts`,
  `routes/__tests__/billing*.test.ts`, `services/__tests__/*.test.ts`).
  Zero warnings in any file this milestone touched
  (`conversationSchema.test.ts` is clean). Confirmed via local re-run
  (`pnpm run lint`) matching the CI step exactly.
- **Failures:** none.
- **Root cause (if any):** N/A.

### ✓ typecheck

- **Status:** PASS
- **Where it runs:** `test` job → step "Type check" (`pnpm run type-check`,
  `turbo run type-check` across all 6 packages, includes
  `packages/database` — so a `prisma generate` mismatch would surface
  here).
- **Duration:** 30s (18:50:15 → 18:50:45 UTC).
- **Warnings:** none besides an informational Prisma CLI notice ("a newer
  version of prisma/@prisma/client is available") emitted during
  `@synora/database:build`'s `prisma generate` — not a type error, not
  specific to this milestone, and pre-existing.
- **Failures:** none.
- **Root cause (if any):** N/A.

### ✓ tests

- **Status:** PASS
- **Where it runs:** `test` job → step "Run tests" (`pnpm run
  test:coverage`, `turbo run test:coverage`), against the real
  `postgres:16-alpine` service container, after "Run database migrations"
  (`prisma migrate deploy`) succeeded in step 9.
- **Duration:** 174s / 2m54s (18:50:45 → 18:53:39 UTC).
- **Results:**
  - `@synora/backend`: **66 test files passed (66), 652 tests passed
    (652)**, 0 failed. Includes this milestone's new
    `db/__tests__/conversationSchema.test.ts` (8 tests) and the updated
    `services/__tests__/permissions.test.ts`.
  - `@synora/web`: **56 test files passed (56), 245 tests passed (245)**,
    0 failed. Untouched by this milestone; included because it's the same
    CI step.
  - `@synora/design-system`: no test files (pre-existing; a `turbo`
    warning notes "no output files found for task
    `@synora/design-system#test:coverage`" — this is that package having
    no tests, not a failure).
- **Warnings:** none beyond the pre-existing jsdom/`act()`/React
  stderr notices already present before this milestone (unrelated to
  Conversation/Message).
- **Failures:** none.
- **Root cause (if any):** N/A.

### ✓ coverage

- **Status:** PASS (numbers), **defect found and fixed in upload
  plumbing** — see "Fixes applied".
- **Where it runs:** produced by the same "Run tests" step
  (`test:coverage` is a single Vitest invocation with `--coverage`);
  "uploaded" by a separate step, "Upload coverage" (`codecov-action@v3`).
- **Numbers:**
  - `@synora/backend`: 84.15% statements, 76.73% branch, 87.4% functions,
    84.15% lines.
  - `@synora/web`: 77.36% statements, 83.53% branch, 78.1% functions,
    77.36% lines.
- **Warnings:** the "Upload coverage" step logged `[error] None of the
  following appear to exist as files: ./coverage/coverage-final.json` —
  Codecov could not find any coverage file and uploaded nothing, but
  exited 0 (`fail_ci_if_error: false`, and Codecov's uploader itself exits
  0 on "no files matched" by design), so the step showed green while
  silently doing nothing.
- **Failures:** none reported (masked — see root cause).
- **Root cause:** the workflow pointed Codecov at a repo-root
  `./coverage/coverage-final.json`, but this is a Turborepo monorepo —
  each package's `test:coverage` writes its own
  `<package>/coverage/coverage-final.json`. No file was ever at the
  repo-root path, on this run or (almost certainly) any prior run since
  the monorepo restructure. **Fixed** in `.github/workflows/ci.yml`: the
  step now lists the three packages that actually produce coverage
  (`apps/backend`, `apps/web`, `packages/design-system`) by their real
  paths.

### ✓ build

- **Status:** PASS
- **Where it runs:** `test` job → step "Build" (`pnpm run build`, `turbo
  run build` — `@synora/database`, `@synora/shared`,
  `@synora/design-system`, `@synora/backend`, `@synora/web` in dependency
  order).
- **Duration:** 45s (18:53:39 → 18:54:24 UTC).
- **Warnings:** none new. (`@synora/backend` build via `tsup` — confirmed
  separately with a local `pnpm --filter @synora/backend build`, ESM
  output, no warnings.)
- **Failures:** none.
- **Root cause (if any):** N/A.

### ✓ docker

- **Status:** PASS
- **Where it runs:** separate `docker` job (not a step in `test`).
- **Duration:** 3m — job start-to-finish 18:49:01 → 18:52:01; the two
  substantive steps: "Build backend production image" 158s (18:49:14 →
  18:51:52), "Smoke-test the built image starts and reports liveness" ~1s
  (18:51:52 → 18:51:53, confirms the container boots and `/health`
  responds).
- **Warnings:** none.
- **Failures:** none.
- **Root cause (if any):** N/A.

### ✓ security

- **Status:** PASS (job conclusion), **one non-blocking sub-step defect
  found and fixed** — see "Fixes applied".
- **Where it runs:** separate `security` job, three sub-steps.
- **Duration:** job 1m28s (18:49:05 → 18:50:33); "Secret scan (gitleaks)"
  10s, "Run Snyk security scan" 5s.
- **Warnings:** the "Run Snyk security scan" step's own log shows a real
  CLI error (`SNYK-CLI-0000`, "Both pnpm-lock.yaml and
  pnpm-workspace.yaml were found... Please run your command again
  specifying --all-projects"), but the GitHub Actions step still reports
  `success` because the workflow sets `continue-on-error: true` on it —
  by design, since it also requires a `SNYK_TOKEN` secret a fresh clone
  won't have.
- **Failures:** none blocking (by design).
- **Root cause:** the Snyk CLI invocation was missing `--all-projects`,
  which this pnpm-workspace monorepo requires — the scan has been failing
  on a CLI usage error *before it ever reaches authentication*, meaning
  even a correctly configured `SNYK_TOKEN` would not have produced a real
  scan until this is fixed. **Fixed** in `.github/workflows/ci.yml`: added
  `args: --all-projects`. Note: this step will still not perform a real
  scan until a maintainer adds a `SNYK_TOKEN` repository secret — that is
  an operations action outside what a code change can fix, and is
  reported here rather than silently left for the next person to
  rediscover.

### ✓ dependency audit

- **Status:** PASS
- **Where it runs:** `security` job → step "Audit production dependencies
  (blocking, high+)" (`pnpm audit --prod --audit-level=high`) — this is
  the actual blocking dependency-vulnerability gate; it does not require
  any token and ran successfully.
- **Duration:** <1s (18:50:14 → 18:50:15).
- **Result:** `No known vulnerabilities found`.
- **Warnings:** none.
- **Failures:** none.
- **Root cause (if any):** N/A.

---

## Fixes Applied

Both fixes are to `.github/workflows/ci.yml` only — no M1 application
code, schema, test, or documentation file was touched, since neither
defect originated in or was introduced by M1's diff. They were found by
reading this run's raw logs in full rather than trusting the green
checkmark alone, per the instruction to report warnings and root causes
for every gate, not just pass/fail.

1. **Snyk CLI invocation** — added `args: --all-projects` so the scan can
   get past its own usage-error stage in this pnpm workspace. Non-code,
   config-only change; does not affect any other step or job.
2. **Codecov upload path** — changed from a nonexistent repo-root path to
   the three real per-package `coverage-final.json` paths this monorepo
   actually produces. Non-code, config-only change.

Both changes were validated as syntactically correct YAML
(`python3 -c "import yaml; yaml.safe_load(...)"`) before commit. Their
actual runtime effect will be confirmed by the next CI run on the commit
that includes them (see "Verification of this report" below) — GitHub
Actions workflow-file behavior cannot be verified any other way than
running it.

---

## Verification of This Report

This report's gate data is real, per-step data pulled from workflow run
`30481629336` via the GitHub API (`get_workflow_job` for exact step
timings, `get_job_logs` for actual output), cross-checked against a local
`pnpm run lint` / `pnpm run type-check` re-run that reproduced identical
warning counts. Coverage percentages and test counts are copied verbatim
from the job's own Vitest output, not estimated.

The two fixes above are pushed as a follow-up commit; per the standing
instruction, CI is watched again on that commit before Milestone 1 is
considered closed. If that run surfaces anything new, this report will be
superseded by `M1_FINAL_AUDIT.md`'s findings rather than edited in place.
