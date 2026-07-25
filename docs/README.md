# Documentation Hierarchy

Start at the repo root, not here — `PROJECT_HANDOVER.md` is the entry
point for a new engineer, and `RELEASE_1_FINAL.md` is the authoritative
snapshot of what Release 1 actually shipped. This folder holds the
supporting reference material those two documents point into.

## Current (living — kept accurate as the code changes)

- `architecture.md`, `api.md`, `database.md`, `deployment.md`,
  `security.md` — the five reference docs `CLAUDE.md` names as the
  project's core documentation set. Each covers its area end to end;
  update the relevant one whenever a change touches it.
- `operations/ENVIRONMENT_MANAGEMENT.md`,
  `operations/ENVIRONMENT_MIGRATION_GUIDE.md` — the config/stage/mode
  system and how to migrate onto it.
- `security/SECRET_MANAGEMENT.md` — the `SecretsManager` subsystem: secret
  sources, the catalog, audit logging.
- `production/*.md` — one document per shipped Release 1 item (`R1-a`
  through `R1-g`, plus two pre-Release-1 fixes `P0-10`, `P0-11`), each
  pairing what was wrong, what changed, and how it was verified. Add a new
  one here for any similarly-scoped future item; don't fold new work into
  an existing item's doc.

## Historical (frozen — describes a past state, not current)

- `archive/` — point-in-time reviews, audits, and forensic reports from
  before Release 1 was complete, plus early PR-description drafts. See
  `archive/README.md`. Never edit these to "catch up" — if something in
  there is now wrong, that's expected; it was a snapshot of an earlier,
  incomplete state.

## Root-level documents this folder supports

- `PROJECT_HANDOVER.md` — start here, zero-context entry point.
- `CURRENT_STATE.md` — exact point-in-time state of the platform,
  refreshed at the end of every milestone.
- `NEXT_TASK.md` — the single next development task (always current;
  the source of truth for what to work on next).
- `RELEASE_1_FINAL.md` — the authoritative Release 1 snapshot: features,
  API summary, database summary, deployment, environment variables,
  CI/CD, Docker, security, limitations, known issues, Release 2 starting
  point.
- `RELEASE_1_LAUNCH_READINESS.md` — the exact env vars/keys/commands
  needed to launch, written during Release 1 as the launch checklist.
- `RELEASE_1_VERIFICATION_REPORT.md` — every CI failure hit while
  stabilizing Release 1's pipeline, with root cause and fix for each.
- `PRODUCTION_READINESS_AUDIT.md` — the final CTO-level audit performed
  after Release 1 shipped.
- `RELEASE_ROADMAP.md` — the living roadmap across all planned releases.
- `RELEASE_2_PLAN.md` — Release 2's objectives, priorities, milestones.
