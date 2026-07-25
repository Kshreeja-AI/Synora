# NEXT TASK — Release 2, Milestone 2: Marketing Site

**Maintenance rule:** this file always contains ONLY the exact next
development task. When a task completes (milestone gate passed: lint,
typecheck, tests, build all green → commit → push → green CI), replace
this file's content with the task named under "Next task after this
one".

## Goal

Ship the public marketing surface of Synora as a premium, animated,
dark-first experience built exclusively from `@synora/design-system`:

1. **Landing page** (`/`) — replace the placeholder: hero with animated
   gradient/background treatment, product narrative sections, feature
   grid, social-proof placeholder section, CTA sections, footer with
   real information architecture, sticky glass navbar.
2. **Pricing page** (`/pricing`) — plan cards (Free / Pro / Team,
   content-driven from a typed data module so M7 billing can bind to the
   same source), feature comparison, FAQ.
3. **Feature pages** (`/features/[slug]`) — one template + typed content
   modules for: text generation, code generation, image/video/audio
   (marked "coming soon" honestly), collaboration.
4. **Changelog** (`/changelog`) — content-driven timeline page; entries
   as typed data (no CMS yet).
5. Shared marketing layout (navbar + footer), SEO metadata per page,
   OpenGraph tags, sitemap + robots via Next conventions.

## Why this task exists

R2's objective is a complete customer-facing platform; the public site
is the front door and has zero dependencies on backend work, so it
comes directly after the design-system foundation (M1) and before the
authenticated app rebuild (M3). It also pressure-tests the design
system against real, polished pages early.

## Dependencies

- M1 (complete): design tokens, Tailwind preset, component library,
  fonts, theming. No backend, DB, or infra dependencies.

## Architecture decisions

- Marketing pages are **static** (Server Components, `generateStaticParams`
  for feature slugs) — no client data fetching.
- All copy/plans/changelog entries live in typed data modules under
  `apps/web/src/content/` so later CMS/billing integration is a data-
  source swap, not a page rewrite.
- Animations: CSS/token keyframes from the preset + small client
  components only where interaction demands it; no heavy animation
  library in M2.
- Route groups: `(marketing)` for the public site so its layout doesn't
  leak into auth/dashboard.

## Files to create

- `apps/web/src/app/(marketing)/layout.tsx` (navbar/footer/theme toggle)
- `apps/web/src/app/(marketing)/page.tsx` (landing — moves from current root)
- `apps/web/src/app/(marketing)/pricing/page.tsx`
- `apps/web/src/app/(marketing)/features/[slug]/page.tsx`
- `apps/web/src/app/(marketing)/changelog/page.tsx`
- `apps/web/src/components/marketing/*` (hero, nav, footer, plan card,
  section primitives)
- `apps/web/src/content/{plans,features,changelog}.ts`
- `apps/web/src/app/sitemap.ts`, `robots.ts`
- Tests: content-module validation + component render tests for nav,
  plan cards, feature template, changelog list

## Files to modify

- `apps/web/src/app/page.tsx` (relocated into the marketing group)
- `apps/web/src/app/layout.tsx` (only if shared metadata needs lifting)
- `docs/architecture.md` frontend section + `CURRENT_STATE.md` +
  this file, at milestone close

## Database changes

None.

## Backend changes

None. (If a "request demo/contact" form is added, it ships as a
mailto/no-op stub — the feedback backend is M8 scope.)

## Frontend changes

As listed above. Design bar: comparable to Linear/Vercel — glass
navbar, subtle gradients, micro-interactions on cards/CTAs, skeleton-
free static pages (no loading states needed), fully responsive down to
360px, dark mode first with correct light mode, keyboard-navigable,
semantic landmarks (`nav`/`main`/`footer`), reduced-motion respected
(`motion-safe:` variants for nontrivial animation).

## Testing requirements

- Vitest + Testing Library: marketing nav (links render, mobile menu
  toggles), plan card (renders plan data, highlights popular), feature
  template (renders a content module), changelog (ordered entries).
- Content modules: schema-validate entries in a test (zod) so a typo'd
  entry fails CI, not production.
- Existing 303 tests stay green; milestone gate applies.

## Security requirements

No new attack surface (static pages, no inputs except a stubbed form —
if present it must not POST anywhere yet). No secrets in content
modules. External links get `rel="noopener"`.

## Acceptance criteria

- `/`, `/pricing`, `/features/<each slug>`, `/changelog` render
  polished, responsive, dark+light correct, no horizontal scroll at
  360/768/1280.
- Lighthouse-sane static output (all marketing routes prerendered in
  `next build` route table).
- All copy/plans/changelog sourced from `src/content/` typed modules.
- Sitemap + robots emitted; every page has title/description/OG tags.
- Browser-verified (screenshots at mobile + desktop, both themes).

## Definition of Done

Acceptance criteria met **and** the milestone gate passed: `pnpm run
lint`, `type-check`, `test` (with `CI=1` + `DATABASE_URL`), `build` all
green locally → commit (conventional message) → push to
`claude/synora-ai-platform-h5q0k2` → CI green on the pushed commit →
`CURRENT_STATE.md` + this file updated.

## Risks

- **Scope creep toward M3** (auth UX, app shell) — resist; marketing
  only.
- **Design drift** — new one-off styles instead of tokens/components;
  anything reusable goes into the design system, not page files.
- **Route-group move of `/`** can break the root page test — update it
  deliberately, don't delete it.
- Turbo cache can mask stale design-system dist — CI builds fresh, so
  trust CI, and use `pnpm --filter @synora/design-system build` after
  editing the package locally.

## Things that must not be changed

The full list in `PROJECT_HANDOVER.md` §20 applies. Specifically here:
no backend changes, no auth changes, no new runtime dependencies
without need (no animation megalibs), no hardcoded colors, CI gates
untouched.

## Estimated effort

2–4 focused engineer-days (L on the roadmap scale).

## Next task after this one

**M3 — Auth UX + onboarding + app shell**: rebuild login/register on
the M1 API client + auth store (remove the deprecated `token` alias
consumer and the raw-fetch pages, drop `axios`), forgot-password flow
(needs the first backend addition: password-reset tokens + mailer
abstraction with console transport), onboarding wizard, workspace
creation flow (first Workspace routes), authenticated app shell
(sidebar, topbar, command palette ⌘K, keyboard shortcuts), protected-
route handling. Details will be written into this file when M2 closes.
