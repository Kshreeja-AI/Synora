# NEXT TASK — Release 2, Milestone 3: Auth UX + Onboarding + App Shell

**Maintenance rule:** this file always contains ONLY the exact next
development task. When a task completes (milestone gate passed: lint,
typecheck, tests, build all green → commit → push → green CI), replace
this file's content with the task named under "Next task after this
one".

## Goal

Turn the authenticated side of Synora from a skeleton into a real
product entry experience:

1. **Auth rebuild** — login/register pages rewritten on the M1 API
   client + Zustand auth store (delete the raw-`fetch` +
   `localStorage['token']` logic), with polished error states, loading
   states, and password visibility toggle.
2. **Forgot-password flow** — the milestone's one backend addition:
   password-reset tokens (hashed at rest, single-use, short expiry) +
   a provider-agnostic mailer abstraction with a console/dev transport
   (real email provider is a launch-time config choice), plus
   `/auth/forgot-password` and `/auth/reset-password` pages.
3. **Onboarding wizard** — post-registration: name → workspace creation
   → theme preference; skippable; runs once.
4. **Workspace creation** — first Workspace routes on the backend
   (create + list mine + get, slug uniqueness, creator becomes OWNER)
   and the frontend flow using them.
5. **App shell** — replace the basic dashboard sidebar: collapsible
   token-styled sidebar with real navigation, topbar with workspace
   switcher + user menu (design-system DropdownMenu/Avatar), command
   palette (⌘K) with navigation actions, keyboard shortcuts, protected-
   route handling (redirect to login when unauthenticated, back to
   original destination after login).
6. **Cleanup** — remove the deprecated `token` alias from backend auth
   responses once no consumer remains; remove `axios` (unused) from web
   dependencies.

## Why this task exists

Everything after M3 (playground, teams, billing) lives inside the
authenticated app; the shell, session handling, and workspace primitive
must exist first. The marketing site (M2) now sends traffic to
register — the flow it lands in must match its quality bar.

## Dependencies

- M1 API client/auth store, M2 design bar (both complete)
- No external infrastructure. Mailer ships with a console transport;
  real provider keys are a launch-time env choice (per the launch
  principle: env vars only).

## Architecture decisions

- Mailer: `apps/backend/src/mail/` mirroring the AI abstraction —
  descriptor registry (console transport first; SMTP/provider adapters
  later via config only). No vendor SDK imports outside the adapter.
- Password reset: `PasswordResetToken` model (userId, tokenHash,
  expiresAt, usedAt) — same hash-at-rest discipline as refresh tokens;
  reset consumes the token and revokes all refresh tokens.
- Workspace routes enforce membership on read from day one (the
  tenancy groundwork M5 builds on).
- Protected routes: client-side guard component/hook on top of the auth
  store (cookie/middleware-based guarding moves in with M5 cookie auth).
- Command palette: design-system `CommandPalette` built on Dialog +
  keyboard handling (add `cmdk` only if hand-rolling proves inadequate).

## Files to create

- Backend: `src/mail/*` (types, registry, console transport, facade),
  `src/services/passwordReset.service.ts`, `src/routes/workspaces.ts`,
  password-reset endpoints in `routes/auth.ts`, tests for all
- Database: migration adding `PasswordResetToken`
- Web: `src/app/auth/forgot-password/page.tsx`,
  `src/app/auth/reset-password/page.tsx`,
  `src/app/onboarding/page.tsx`,
  `src/components/shell/*` (Sidebar, Topbar, WorkspaceSwitcher,
  UserMenu, CommandPalette), `src/lib/api/workspaces.ts`,
  `src/hooks/useRequireAuth.ts`, tests throughout

## Files to modify

- `apps/web/src/app/auth/login/page.tsx`, `register/page.tsx` (rebuild
  on api client), `dashboard/layout.tsx` (new shell),
  `dashboard/page.tsx` (real user via React Query `users/me`)
- `apps/backend/src/routes/auth.ts` (reset endpoints; later drop
  `token` alias), `src/app.ts` (mount workspaces router)
- `apps/web/package.json` (remove axios)
- Docs at close: `docs/api.md` (new endpoints), `docs/database.md`
  (new model), `docs/architecture.md`, `CURRENT_STATE.md`, this file

## Database changes

One additive migration: `PasswordResetToken` table (id, userId FK
cascade, tokenHash unique, expiresAt, usedAt?, createdAt; index userId,
index expiresAt). No changes to existing tables.

## Backend changes

As above: mailer abstraction, password-reset service + endpoints
(`POST /api/auth/forgot-password` — always 200, no account
enumeration; `POST /api/auth/reset-password`), workspace routes
(`POST /api/workspaces`, `GET /api/workspaces`, `GET /api/workspaces/:id`
— membership-checked), all zod-validated, all rate-limited by the
existing global limiter.

## Frontend changes

As above. Design bar unchanged from M2: token-driven, dark-first,
responsive, accessible (focus management in the palette and dialogs
comes from Radix), skeleton/loading states everywhere data loads.

## Testing requirements

- Backend: reset-token lifecycle (issue/consume/expire/reuse-rejected,
  refresh tokens revoked on reset, no-enumeration response shape),
  workspace routes (create/list/get, membership enforcement, slug
  collisions), mailer facade (console transport records mail in tests)
- Web: rebuilt auth pages (submit success/error via mocked client),
  useRequireAuth redirect behavior, workspace switcher render,
  command palette open/navigate, onboarding step flow
- Full workspace suite (312+) stays green; milestone gate applies

## Security requirements

- Reset tokens: cryptographically random, hashed at rest, single-use,
  ≤1 h expiry; consuming one revokes all refresh tokens
- Forgot-password never reveals whether an email exists
- No mailer credentials in code; SecretsManager + catalog entry
- Workspace reads/writes require membership — no cross-tenant leaks

## Acceptance criteria

- Register → onboarding → workspace created → dashboard, and
  login → dashboard, both work end-to-end against the real backend
- Forgot/reset password works end-to-end with the console transport
  (token visible in backend logs in dev)
- ⌘K palette opens/navigates; sidebar/topbar responsive; protected
  routes redirect correctly
- Legacy raw-fetch auth code, `token` alias, and axios are gone
- Browser-verified (screenshots, both themes, mobile + desktop)

## Definition of Done

Acceptance criteria met and the milestone gate passed: lint,
type-check, tests (CI=1 + DATABASE_URL), build green locally → commit →
push → CI green → `docs/api.md`, `docs/database.md`,
`docs/architecture.md`, `CURRENT_STATE.md`, and this file updated.

## Risks

- **Backend surface creep** — only reset + workspaces routes; teams/
  invitations/settings are M5.
- **`token`-alias removal ordering** — remove only after both auth
  pages are on the new client, in the same milestone, with tests
  updated.
- **Onboarding state** — track completion server-side via
  UserPreferences (add a field only if genuinely needed; prefer
  deriving from "has a workspace").
- **Command palette a11y** — must trap focus and restore it on close
  (Radix Dialog handles this; don't bypass it).

## Things that must not be changed

`PROJECT_HANDOVER.md` §20 in full. Specifically: auth token invariants
(hash-at-rest, rotation, pinned algorithm) extend to reset tokens; no
vendor mail SDK outside the adapter; API envelope unchanged.

## Estimated effort

4–6 focused engineer-days (L–XL).

## Next task after this one

**M4 — Core product surfaces**: project management UI (real CRUD flows
on existing routes), document editor, generation history, AI playground
(text/code) with model selector + provider management UI backed by a new
`GET /api/ai/providers` endpoint, prompt library (new model + routes).
Details will be written into this file when M3 closes.
