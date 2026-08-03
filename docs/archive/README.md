# Archive

Historical, point-in-time documents preserved for provenance — **not**
current status. Each describes the codebase as it stood on the day it was
written, and none has been updated since.

Do not treat anything in this folder as a description of the current
system. For current status, see the documentation hierarchy described in
`docs/README.md`.

## Release reports (root of this folder)

Per-milestone and per-subsystem reports spanning Releases 1 through 3 —
audits, completion reports, implementation plans, and verification
write-ups. These accumulated at the repository root, where their volume
made it hard to tell the handful of living documents from the many frozen
ones; they were moved here in one batch on 2026-08-03 with their contents
unchanged.

Their claims were true when written and are not maintained. Where one
contradicts the code, the code wins. The living documents that supersede
them are `PROJECT_HANDOVER.md`, `RELEASE_ROADMAP.md`, `CURRENT_STATE.md`,
and the five core references in `docs/`.

## `pre-release-1/`

Independent reviews and audits commissioned to find every gap standing
between the codebase (as of 2026-07-21) and a real launch. Their low
scores (28–54 out of 100, depending on the review) are not a current
assessment — they're exactly the list of problems Release 1 was scoped to
fix, and the actual fixes are verified in `RELEASE_1_FINAL.md` and
`docs/archive/PRODUCTION_READINESS_AUDIT.md`. Kept because they document *why* specific
Release 1 decisions were made, including the git-forensics investigation
(`REPOSITORY_FORENSIC_AUDIT.md`) that recovered the `recover/mfa` and
`recover/csrf` branches Release 2 depends on.

## `pr-descriptions/`

Draft PR body text written before three early feature branches
(`chore/pnpm-ci-migration`, `feature/secrets-management`,
`feature/environment-management`) were opened. The actual merged history
and review discussion live on GitHub; these are kept only as a record of
the stated intent at the time.
