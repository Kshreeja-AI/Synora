# READY_TO_DEPLOY — Synora pilot (updated 2026-11-08)

**STATUS: BLOCKED.** Code fixes are committed locally and checked locally, but the push was denied by the permission system, so CI has not run on them. Nothing was deployed. Render, DNS and Hostinger were not touched.

Branch: `launch/pre-deploy-2026-11-08`. Unpushed commits: `9fbad00`, `caf9d8f` (and this file's update).

## WHAT CHANGED
| Commit | What |
|---|---|
| `9fbad00` fix(deps) | nodemailer ^10.1.4, zod ^4.6.7, same-major security overrides, `vite ^7.3.7` pinned where `@vitejs/plugin-react` auto-installed an out-of-range vite 8; zod 4 code changes (`error.errors` to `error.issues`, `z.record(z.string(), v)`) in 6 backend files |
| `caf9d8f` test(web) | `testTimeout: 30_000` in `apps/web/vitest.config.ts`. No assertion touched. |

## CI (real result of the last pushed run, 42474846168, sha 78def88)
| Job | Result | Why |
|---|---|---|
| docker | success | |
| security | FAILED | `pnpm audit --prod --audit-level=high`: 3 high (nodemailer x2, zod) + 16 moderate. Fixed by `9fbad00`. |
| test | FAILED | 10 `Sidebar.test.tsx` cases, all "Test timed out in 5000ms", 0 assertion errors. Fixed by `caf9d8f`. |
| e2e | skipped | |

CI on the new commits: **NOT VERIFIED** (push denied).

## VERIFIED locally
- Prod `pnpm audit`: 0 vulnerabilities (LOCALLY VERIFIED).
- Backend and web type-check: exit 0 after the patch (LOCALLY VERIFIED).
- Lint: exit 0, 0 errors, 213 warnings (LOCALLY VERIFIED).
- `node scripts/guardrails.mjs`: 8/8 pass (LOCALLY VERIFIED).
- Migrations: 40 applied on throwaway Postgres `synora-pr-test-pg` only (LOCALLY VERIFIED).
- Backend: 43 test files passed, 0 failed; 8 targeted files (zod/nodemailer paths) pass 77/77 with throwaway Postgres + Redis. The first run of `evaluation.test.ts` failed only because Redis was absent (environment); with Redis it passes 14/14.
- Web: `Sidebar.test.tsx` 13/13 pass with the new timeout (one case took 8.4s, which the old 5s limit would have failed); 33 web files passed, 0 failed.

## NOT VERIFIED
- Full backend suite: 262 of 305 files did not run locally (40 min cap hit, `fileParallelism: false`). CI is the check.
- Full web suite: about 73 of 106 files did not run locally (55 min cap hit). CI is the check.
- CI on the new commits (push denied).
- Tar backup re-hash: failed twice with ENOMEM, passed once. The git bundle is verified and is the reliable git backup.
- Deployment, preview, smoke tests, RLS test on the knowledge-base migration, rollback target, the 5 DB-writing launch steps. None were attempted.
- STT/TTS/search/RAG/vision/image/video: no live tested endpoint. Hindi TTS not tested.

## KNOWN ACCEPTED RISKS
- Dev-only advisories remain and do not ship to production: tinypool (2 critical, via vitest 3), vitest/@vitest/mocker (moderate), `apps/web` zod 3 (high, dev audit), glob and minimatch (moderate). Fix is vitest 4 and web zod 4, a separate branch after CI is green. Not mixed into this branch.
- Backend moved to zod 4 while `apps/web` stays on zod 3. They do not share schemas at runtime; if a shared package ever imports zod it must be checked.
- Local test runs were capped by laptop speed, so coverage of this change relies on CI.

## FOUNDER ACTION
1. Push the branch: `! git push origin launch/pre-deploy-2026-11-08` (normal push, no force).
2. Wait for CI (test, docker, security). If any job fails, send me the run id.
3. Only after CI is green: decide on preview/production deployment. Not done here.

## NEXT STEP
Push, then CI, then fix anything it finds, then the vitest 4 and web zod 4 branch.

SYNORA_LINKS=NOT DEPLOYED (no working URL)
