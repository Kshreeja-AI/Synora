# NEXT TASK — Release 2, Milestone 5: Core Product Surfaces

**Maintenance rule:** this file always contains ONLY the exact next
development task. When a task completes (milestone gate passed: lint,
typecheck, tests, build all green → commit → push → green CI), replace
this file's content with the task named under "Next task after this
one".

## Why this file exists as "M5"

`RELEASE_2_PLAN.md`'s milestone table was renumbered on 2026-07-25 when
the founder split the original M3 into M3 (auth/account UX) + M4
(application shell), each independently gated. What the plan originally
called M4 ("Core product surfaces") shifted to M5 — this file — with no
change to its content. M4 (application shell: dashboard, sidebar,
workspace switcher/creation, command palette, notifications, settings
navigation, 404/error handling) is complete; see `CURRENT_STATE.md`.

## Goal

Give the product something real to *do* inside a workspace. Today the
workspace switcher and dashboard overview exist, but `Project` and
`Document` are bare CRUD-by-userId models with no UI, and there is no way
to actually use the 10-provider AI abstraction from the browser. This
milestone turns that into:

1. **Project management UI** — real CRUD screens on the existing
   `Project`/`Document` routes, now workspace-scoped rather than
   user-scoped (the routes currently filter by `userId`; they need to
   filter by workspace membership instead, matching M4's workspace
   membership-check pattern — 404, not 403, for non-members).
2. **Document editor** — a real editing surface for `Document` records
   (the model already has a `format`/`content` shape — check
   `packages/database/prisma/schema.prisma` before assuming a schema
   change is needed).
3. **AI playground (text/code)** — a real chat/completion UI hitting the
   existing `POST /api/ai/generate` endpoint, with a model/provider
   selector.
4. **Provider management UI** — a new `GET /api/ai/providers` endpoint
   exposing the registered provider descriptors (id, capabilities,
   `isConfigured()` result) so the playground's selector reflects what's
   actually usable, never a hardcoded list.
5. **Generation history** — list past `/api/ai/generate` calls per
   workspace (new model or reuse `ActivityLog` — evaluate both before
   building a new table).
6. **Prompt library** — save/reuse prompts (new model + routes).

## Dependencies

- M1–M4 complete (design system, marketing site, auth/account UX,
  application shell — including the workspace model, `useCurrentWorkspace`,
  and the shell's `Sidebar`/`Breadcrumbs`/`CommandPalette`, all of which
  this milestone's new pages plug into rather than duplicate).
- No external infrastructure (Redis/queues arrive in M7, after this).

## Architecture decisions

- **Workspace-scope, not user-scope**: `Project`/`Document` routes must
  become membership-checked against `workspaceId` the same way M4's
  workspace routes are — reuse `workspace.service.ts`'s membership-check
  pattern rather than inventing a second one. This likely means adding a
  `workspaceId` column to `Project` (check the schema first — it may
  already be workspace-aware and simply unused, the way `Workspace`
  itself was before M4).
- **`GET /api/ai/providers`**: exposes descriptor metadata only — never
  secret values. Mirrors the existing AI descriptor-registry-resolver
  pattern; add a read method to the registry rather than reaching into
  `secretsManager` from a route handler.
- **Sidebar integration**: M4 deliberately did not add "Projects" to the
  sidebar nav because the page didn't exist yet (a dead link would have
  violated the "no mock UI" principle). This milestone should add it now
  that the destination is real — extend `Sidebar.tsx`'s `NAV_ITEMS`
  array, don't rebuild the sidebar.
- **Command palette**: add "New project", "AI playground", "Prompt
  library" entries to the existing `CommandPalette.tsx` rather than
  building a second palette.

## Files to create

- Backend: `src/routes/ai.ts` extension for `GET /api/ai/providers`
  (or a new route file if `ai.ts` is already large), prompt-library
  model + routes, generation-history routes (model TBD per the
  ActivityLog evaluation above), tests for all of it
- Web: `src/app/dashboard/projects/{page.tsx,[id]/page.tsx}`,
  `src/app/dashboard/playground/page.tsx`, `src/app/dashboard/library/
  page.tsx` (prompt library), `src/lib/api/{projects,documents,
  prompts}.ts`, `src/hooks/use{Projects,Documents,AiProviders}.ts`,
  tests throughout

## Files to modify

- `packages/database/prisma/schema.prisma` (workspace-scope `Project`;
  new models for prompts/generation-history if `ActivityLog` proves
  insufficient) + migration
- `apps/backend/src/routes/projects.ts`, `documents.ts` (membership
  checks instead of `userId` checks)
- `apps/web/src/components/shell/Sidebar.tsx` (add real nav items —
  Projects, Playground, Library)
- `apps/web/src/components/shell/CommandPalette.tsx` (add navigation/
  action entries for the new surfaces)
- Docs at close: `docs/api.md`, `docs/database.md`, `docs/architecture.md`,
  `CURRENT_STATE.md`, this file

## Testing requirements

- Backend: workspace-scoped project/document CRUD (membership 404s,
  same pattern M4's workspace tests already establish), `GET
  /api/ai/providers` (returns real descriptor state, no secrets leaked),
  prompt library CRUD, generation history list
- Web: project list/create/detail, document editor save/load, playground
  generate flow (mocked API, asserts the real provider list drives the
  selector), prompt library CRUD, sidebar/command-palette additions
- Full suite (577+) stays green; milestone gate applies

## Security requirements

- Workspace-scoped reads/writes require membership — no cross-tenant
  leaks (same discipline as M4's workspace routes)
- `GET /api/ai/providers` must never expose secret values, only
  descriptor metadata and a boolean `isConfigured`
- No new secrets or credentials introduced by this milestone

## Acceptance criteria

- Create a project inside a workspace → add a document → edit and save
  it, all workspace-scoped and membership-checked
- Playground generates real text/code via `/api/ai/generate`, with the
  model/provider selector reflecting `GET /api/ai/providers`'s real
  output — swapping the configured provider changes the selector with no
  code change
- Generation history and prompt library both round-trip against the real
  backend — no mock UI
- Browser-verified (screenshots, both themes, mobile + desktop) — same
  bar M3/M4 were held to

## Definition of Done

Acceptance criteria met and the milestone gate passed: lint, type-check,
tests, build green locally → commit → push → CI green → `docs/api.md`,
`docs/database.md`, `docs/architecture.md`, `CURRENT_STATE.md`, and this
file updated.

## Risks

- **Scope creep into M6 territory** (team invitations, roles beyond
  OWNER) — out of scope here; workspace membership is read-only context
  for this milestone, not something it manages.
- **Schema surprises**: `Project`/`Document` may already have more
  workspace-awareness than expected, or less. Verify against
  `schema.prisma` before assuming either a migration is or isn't needed
  — the M4 workspace milestone found the `Workspace`/`WorkspaceMember`
  models fully built and simply unused; the same could be true here, or
  the opposite.

## Things that must not be changed

`PROJECT_HANDOVER.md` §20 in full, plus everything M3/M4 established:
`useRequireAuth`/`useCurrentUser`/`useCurrentWorkspace` hook contracts,
the mobile sidebar overlay behavior, the command palette's keyboard
model, the API envelope, and auth token invariants (hash-at-rest,
rotation, pinned algorithm).

## Estimated effort

3–4 focused engineer-days (L) — four real product surfaces plus a new
backend endpoint and workspace-scoping migration.

## Next task after this one

**M6 — Teams, invitations & extended security** (per `RELEASE_2_PLAN.md`'s
renumbered scope): team invitations, roles beyond OWNER, API key
management, extended workspace/security settings, **R2-a (MFA)** rebase
from `recover/mfa`, **R2-b (CSRF + cookie auth)** rebase from
`recover/csrf`. Details will be written into this file when M5 closes.
