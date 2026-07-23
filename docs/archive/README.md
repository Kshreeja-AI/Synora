# Archive

Historical, point-in-time documents preserved for provenance — **not**
current status. Every file here predates Release 1's actual completion and
describes a snapshot of the codebase as it existed on 2026-07-21, before
the R1-a through R1-h work landed.

Do not treat anything in this folder as a description of the current
system. For current status, see the documentation hierarchy described in
`docs/README.md`.

## `pre-release-1/`

Independent reviews and audits commissioned to find every gap standing
between the codebase (as of 2026-07-21) and a real launch. Their low
scores (28–54 out of 100, depending on the review) are not a current
assessment — they're exactly the list of problems Release 1 was scoped to
fix, and the actual fixes are verified in `RELEASE_1_FINAL.md` and
`PRODUCTION_READINESS_AUDIT.md`. Kept because they document *why* specific
Release 1 decisions were made, including the git-forensics investigation
(`REPOSITORY_FORENSIC_AUDIT.md`) that recovered the `recover/mfa` and
`recover/csrf` branches Release 2 depends on.

## `pr-descriptions/`

Draft PR body text written before three early feature branches
(`chore/pnpm-ci-migration`, `feature/secrets-management`,
`feature/environment-management`) were opened. The actual merged history
and review discussion live on GitHub; these are kept only as a record of
the stated intent at the time.
