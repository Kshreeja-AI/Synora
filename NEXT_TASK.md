# NEXT TASK — Release 2, Milestone 3.5: Onboarding, Workspace Creation, App Shell

**Maintenance rule:** this file always contains ONLY the exact next
development task. When a task completes (milestone gate passed: lint,
typecheck, tests, build all green → commit → push → green CI), replace
this file's content with the task named under "Next task after this
one".

## Why this file exists as "M3.5"

`RELEASE_2_PLAN.md`'s original Milestone 3 bundled six deliverables:
auth rebuild, forgot-password, onboarding wizard, workspace creation,
app shell, and cleanup. On 2026-07-25 the founder narrowed M3's actual
scope to auth/account UX only (auth screens, email verification,
password reset, session management, account/profile settings, avatar
upload — see `CURRENT_STATE.md`) and explicitly deferred onboarding,
workspace creation, and the app shell. This task is exactly that deferred
remainder, run as its own milestone so the gate (lint/typecheck/test/
build → commit → push → green CI) applies to it independently rather
than being silently folded into M4.

## Goal

Turn the post-registration experience from "land directly on an
otherwise-empty dashboard" into a real product entry flow, and replace
the placeholder dashboard shell with a navigable one:

1. **Onboarding wizard** — post-registration: name (pre-filled from
   registration, editable) → workspace creation → theme preference;
   skippable; runs once. Completion is derived server-side from "the user
   has at least one workspace" (per the original M3 spec's risk note —
   avoid a dedicated `onboardingComplete` flag unless deriving from
   workspace membership proves insufficient).
2. **Workspace creation (backend)** — first `Workspace` routes: `POST
   /api/workspaces` (create, slug uniqueness, creator becomes `OWNER`
   via `WorkspaceMember`), `GET /api/workspaces` (list mine), `GET
   /api/workspaces/:id` (membership-checked — 404 if the caller isn't a
   member, never a 403 that confirms existence).
3. **App shell** — replace `apps/web/src/app/dashboard/layout.tsx`'s
   current placeholder sidebar (fixed nav list, no workspace concept)
   with: a workspace switcher (design-system `DropdownMenu`) in the
   topbar, a user menu (`DropdownMenu` + `Avatar`, now that avatar upload
   is real — wire the actual `image` field), a command palette (⌘K) built
   on `Dialog` with keyboard handling for navigation actions (add `cmdk`
   only if hand-rolling proves inadequate, per the original spec), and
   keyboard shortcuts. Keep the M3 mobile-overlay sidebar behavior
   (`fixed` + backdrop + `md:` breakpoint split) — that part of the shell
   is already correct and browser-verified; extend it, don't replace it.
4. **Protected-route handling** — already exists (`useRequireAuth`,
   shipped in M3) and needs no rework; the app shell consumes it as-is.

## Dependencies

- M1 API client/auth store, M2 design bar, M3 auth/account UX and
  `useCurrentUser`/`useRequireAuth` hooks (all complete)
- No external infrastructure.

## Architecture decisions

- Workspace routes enforce membership on read from day one (the tenancy
  groundwork M5 builds on) — mirrors how M3's session/account routes
  scope everything to the authenticated caller.
- Command palette: design-system `CommandPalette` built on `Dialog` +
  keyboard handling; Radix's focus trap/restore must not be bypassed.
- Onboarding state: derive from "has a workspace" — add a dedicated field
  only if that proves genuinely insufficient in practice.

## Files to create

- Backend: `src/routes/workspaces.ts`, `src/services/workspace.service.ts`
  (slug generation/uniqueness), tests for both
- Database: migration adding nothing new if `Workspace`/`WorkspaceMember`
  already cover it (they do — schema exists, unused until now); verify
  before assuming a migration is needed
- Web: `src/app/onboarding/page.tsx` (+ step components),
  `src/components/shell/{Sidebar,Topbar,WorkspaceSwitcher,UserMenu,
  CommandPalette}.tsx`, `src/lib/api/workspaces.ts`, tests throughout

## Files to modify

- `apps/backend/src/app.ts` (mount workspaces router)
- `apps/web/src/app/dashboard/layout.tsx` (replace placeholder shell with
  the components above, keeping the M3 mobile-overlay logic)
- `apps/web/src/app/auth/register/page.tsx` or its post-register redirect
  (send to `/onboarding` instead of straight to `/dashboard` for a user
  with no workspace yet)
- Docs at close: `docs/api.md` (new workspace endpoints), `docs/database.md`
  (workspace routes now live, if that changes any documented status),
  `docs/architecture.md`, `CURRENT_STATE.md`, this file

## Testing requirements

- Backend: workspace routes (create/list/get, slug collisions, membership
  enforcement — a non-member gets 404 not 403)
- Web: onboarding step flow, workspace switcher render, command palette
  open/navigate, shell renders correctly with the new workspace context
- Full workspace suite (479+) stays green; milestone gate applies

## Security requirements

- Workspace reads/writes require membership — no cross-tenant leaks
- No new secrets or credentials introduced by this milestone

## Acceptance criteria

- Register → onboarding → workspace created → dashboard works end-to-end
  against the real backend
- ⌘K palette opens/navigates; sidebar/topbar responsive (building on the
  M3 mobile-overlay fix, not regressing it); workspace switcher shows the
  user's workspace(s)
- Browser-verified (screenshots, both themes, mobile + desktop) — same
  bar M3 was held to

## Definition of Done

Acceptance criteria met and the milestone gate passed: lint, type-check,
tests, build green locally → commit → push → CI green → `docs/api.md`,
`docs/architecture.md`, `CURRENT_STATE.md`, and this file updated.

## Risks

- **Scope creep back into full M5 workspace features** (invitations,
  roles beyond OWNER, settings) — out of scope here; this milestone only
  needs create/list/get and OWNER-on-create.
- **Command palette a11y** — must trap focus and restore it on close
  (Radix Dialog handles this; don't bypass it).

## Things that must not be changed

`PROJECT_HANDOVER.md` §20 in full, plus everything M3 established:
`useRequireAuth`/`useCurrentUser` hook contracts, the mobile sidebar
overlay behavior, the API envelope, and auth token invariants
(hash-at-rest, rotation, pinned algorithm) extending to the M3 reset/
verification tokens.

## Estimated effort

2–3 focused engineer-days (M–L) — smaller than the original M3 estimate
since the auth/account portion is already done.

## Next task after this one

**M4 — Core product surfaces** (per `RELEASE_2_PLAN.md`'s original
scope): project management UI (real CRUD flows on existing routes,
now workspace-aware), document editor, generation history, AI playground
(text/code) with model selector + provider management UI backed by a new
`GET /api/ai/providers` endpoint, prompt library (new model + routes).
Details will be written into this file when M3.5 closes.
