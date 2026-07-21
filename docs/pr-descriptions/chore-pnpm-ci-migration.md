# chore(ci): migrate tooling from npm to pnpm workspaces

**Branch**: `chore/pnpm-ci-migration` → `SYNORA`
**Commit**: `0a49ad8` (1 commit, rebase-verified up to date with `origin/SYNORA` @ `8f1635a`)
**Type**: Tooling / CI only — no application behavior changes
**Merge order**: 1st (per [Merge Plan](../MERGE_PLAN.md) — everything else's CI run benefits from this landing first)

## Summary

Fixes CI's `test` job, which has been failing on a missing lockfile:
npm workspaces had no committed lockfile for `npm ci` to install from.
Switches package management to pnpm with a committed `pnpm-lock.yaml`,
`--frozen-lockfile` installs in CI, and pnpm-based dependency caching.

## What changed

- **`.github/workflows/ci.yml`**: installs via `pnpm install --frozen-lockfile` instead of `npm ci`; all subsequent steps (`db:generate`, `db:migrate`, lint, type-check, test, build) run through `pnpm run` instead of `npm run`; cache key switched from `npm` to `pnpm`.
- **`package.json`** (root): replaced the `workspaces` array with `packageManager: "pnpm@10.33.0"` + `pnpm-workspace.yaml`; dropped the now-redundant `engines.npm` constraint.
- **`apps/backend/package.json`**: `jsonwebtoken` pin fixed from `^9.1.2` (does not exist on the registry) to `^9.0.3` (latest real 9.x).
- **`apps/web/package.json`**: `next-auth` pin fixed from `^5.0.0` (v5 only exists as a beta tag, not a stable release) to `5.0.0-beta.31`.
- **`apps/backend/package.json`**, **`apps/web/package.json`**: added the `@vitest/coverage-v8` devDependency that `test:coverage` scripts already referenced but neither package declared.
- **`packages/shared/package.json`**, **`packages/design-system/package.json`**: added an explicit `eslint: ^8.56.0` devDependency — under npm's hoisting these packages implicitly reached `apps/backend`'s eslint; pnpm's strict, non-hoisted linking doesn't provide that, so `pnpm run lint` fell through to an incompatible global `eslint@10` and broke on both packages. This is a direct, in-scope consequence of the package-manager switch.
- **`turbo.json`**: added `dependsOn: ["^build"]` to `lint`/`test`/`test:coverage`/`type-check` tasks; removed a stale `version`/`extends` pair.
- **`.gitignore`**: added `.turbo/`.
- **New**: `pnpm-workspace.yaml`, `pnpm-lock.yaml` (committed, 7631 lines).

## Explicitly out of scope

Per an earlier explicit decision on this branch (user confirmed "no action" when asked whether to expand scope to broader app-level errors), this PR does **not** touch:

- `apps/backend`'s `db:generate` script pointing at a `prisma/schema.prisma` that doesn't exist in that package (schema lives in `packages/database`) — pre-existing, confirmed present on baseline `SYNORA` before this branch existed
- Pre-existing TypeScript build errors (`TS2742`/`TS2769`/`TS2741`) in original Milestone-1 files (`routes/*.ts`, `middleware/auth.ts`, `logger.ts`) that make `pnpm run build` fail regardless of package manager
- A missing `--run` flag on the `test:coverage` script, which currently defaults to watch mode and hangs instead of exiting — found during this branch's verification
- The `@types/react@^18` vs `react@^19` version mismatch in `apps/web`

All four are called out in [`docs/MERGE_PLAN.md` §7](../MERGE_PLAN.md#7-pre-existing-blockers-found-during-verification-not-fixed--out-of-scope) as pre-existing, cross-branch blockers, tracked separately rather than folded into this tooling PR.

## Quality checks

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ Succeeds — this is the actual fix for CI's original failure mode |
| `pnpm run lint` | 4 errors, all confirmed pre-existing on baseline `SYNORA` (`middleware/auth.ts` ×2, `middleware/errorHandler.ts`, `routes/auth.ts`) — verified by diffing lint output against `git show 8f1635a:...` for the same files. None introduced by this branch; the `packages/shared`/`design-system` breakage this branch *did* introduce is fixed (see above). |
| `pnpm run type-check` | 5 errors, all pre-existing baseline (`jwt.sign` overload mismatch ×2, `middleware/auth.ts` payload shape ×2, `logger.ts` unknown timestamp) |
| `apps/backend` tests | 5/5 passing (`tests/utils.test.ts`) — this branch doesn't carry the feature-stack's additional test files, by design, since it's an independent sibling branch |
| Secret scan | No hardcoded credentials in this branch's diff |
| Conflict check (`git merge-tree`) | Clean against `origin/SYNORA` and clean against the full 9-branch doc/feature stack tip |

`pnpm run build` and `pnpm run test:coverage` still fail at the root — both for the pre-existing, out-of-scope reasons listed above, not because of anything in this diff. Merging this branch does not fix those, and does not regress them either.

## Test plan

- [x] `pnpm install --frozen-lockfile` succeeds from a clean clone
- [x] `pnpm run lint` reaches actual project files in every package (previously errored out entirely on `packages/shared`/`design-system`)
- [x] `pnpm run type-check` — only pre-existing baseline errors remain
- [x] Backend test suite passes
- [x] No secrets or temporary code in the diff
- [ ] CI actually goes green end-to-end on this PR (blocked on the pre-existing build/coverage issues in Merge Plan §7 — expect the `Build` and coverage steps to still fail until those are separately fixed; lint/type-check/test steps should pass modulo documented baseline errors)
