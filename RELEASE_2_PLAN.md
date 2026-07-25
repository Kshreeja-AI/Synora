# Release 2 Plan — Complete Customer-Facing Platform

**Status:** In progress
**Depends on:** Release 1 (complete — see `RELEASE_ROADMAP.md`, `RELEASE_1_FINAL.md`)
**Supersedes:** the earlier hardening-only draft of this document. The
founder expanded Release 2's scope from "production hardening" to the
**complete customer-facing Synora platform**. Every task from the original
R2 register (R2-a through R2-h) is still in scope — it is folded into the
milestone structure below rather than dropped.

---

## 1. Objective

Release 1 proved the product can launch and serve real customers safely on
a single instance, with a provider-agnostic AI backend. Release 2 turns it
into a product people can actually buy and love: a premium, animated,
dark-mode-first frontend (landing/pricing/marketing, full application UI,
billing, teams, playground, media generation, admin), plus the hardening
and scale work from the original register (MFA, CSRF, Redis, async media
jobs, CD, observability, E2E).

When Release 2 finishes, the only remaining launch tasks are:

1. Add environment variables.
2. Configure payment keys.
3. Configure AI provider keys.
4. Configure email provider.
5. Deploy.

## 2. Non-negotiable principles (from the founder)

- Production-grade and future-proof. No temporary solutions, no throwaway code.
- Scalable to millions of users.
- Provider-agnostic everywhere — AI providers, payment provider, email
  provider, object storage are all replaceable through configuration only.
  UI never couples to a specific provider.
- Preserve every Release 1 guarantee. Do not rewrite working code unless
  objectively necessary.
- UI quality comparable to Linear, Vercel, Framer, Raycast, OpenAI. No
  generic dashboard templates. Dark mode first, light mode supported,
  accessible, keyboard-shortcut friendly, animated, responsive.
- Every new feature ships with unit + integration tests; E2E lands with
  the Playwright suite in M9.
- Milestone gating: after each milestone — lint, typecheck, tests, build
  all green, commit, push, wait for green CI. Never proceed on red.

## 3. Milestones

**Founder-directed renumbering (2026-07-25):** the original M3 ("Auth UX +
onboarding + app shell") was split into two independently-gated
milestones on the founder's instruction: **M3 — Auth/account UX** (auth
screens, email verification, password reset, session management,
account/profile settings — no onboarding wizard or app shell) shipped
first, followed by **M4 — Application shell** (dashboard, sidebar,
workspace switcher + workspace create/list/get/rename backend, header,
search, command palette, notifications, profile menu, workspace settings,
breadcrumbs, responsive nav, keyboard shortcuts, theme persistence, empty/
loading states, error boundaries, 404/500 pages). Everything the original
M4–M9 covered shifted down one slot to M5–M10 as a result — the content
of each is unchanged, only the number.

| # | Milestone | Contains | Exit criteria |
|---|---|---|---|
| **M1** | Foundation: design system + frontend infrastructure | Design tokens (dark-first), shared Tailwind preset, core component library (`@synora/design-system`) with tests, typed API client with automatic refresh-token rotation, TanStack Query + Zustand wiring, theme system, typography | Components render + pass tests; web app consumes the design system; lint/typecheck/test/build green |
| **M2** | Marketing site | Landing page, pricing page, feature pages, changelog — premium, animated, responsive | Pages ship, Lighthouse-sane, dark/light correct |
| **M3** | Auth/account UX | Rebuilt login/register UX, forgot/reset password, email verification, session management (list/revoke/logout-everywhere, remember-me), account settings (password change, notification preferences, soft-delete), profile settings (edit + avatar upload), provider-agnostic mailer + storage abstractions | Full signup → verify → sign-in flow works against the real backend; sessions listable/revocable |
| **M4** | Application shell | Workspace model surfaced for the first time (create/list/get/rename backend, membership-checked), dashboard with real empty/loading states, sidebar + topbar shell, workspace switcher, global ⌘K command palette (doubling as header search), in-app notification center (real triggers, not sample data), profile menu with theme submenu (persisted server-side via `UserPreferences.theme`), breadcrumbs, keyboard-shortcuts dialog, workspace settings page, branded 404/error boundaries at both the root and dashboard-shell level | Register → create workspace → navigate the full shell works end to end against the real backend; ⌘K opens/filters/navigates; 404/error pages render correctly inside and outside the shell; browser-verified in both themes, desktop + mobile |
| **M5** | Core product surfaces | Project management, document editor, generation history, AI playground (text/code) with model selector + provider management UI, prompt library | Playground generates via the existing `/api/ai` abstraction; provider swap is config-only |
| **M6** | Teams, invitations & extended security | Team invitations, roles beyond OWNER, API key management, extended workspace settings, security settings; **R2-a (MFA)** and **R2-b (CSRF + cookie auth)** land here | MFA enroll/verify/recovery green; CSRF enforced on cookie-auth mutations |
| **M7** | Media generation + assets | **R2-c (Redis)**, **R2-d (async job queue)**, image/video/audio generation backend + UIs, asset manager, file uploads, object-storage slice (pulled forward from R3-c) | 202-enqueue → worker completes → result durably stored and visible in the asset manager |
| **M8** | Billing, usage & analytics | Provider-agnostic billing abstraction (Stripe as first adapter), subscription management, usage dashboard, analytics; extends M4's notification center with billing-related notifications | Plans purchasable in test mode via env-config only; usage metered and displayed |
| **M9** | Admin, support & content | Admin dashboard, monitoring dashboard, audit log viewer, feedback system, support center, error reporting, documentation pages, blog system, API documentation | Admin-gated routes enforce role; docs/blog content-driven |
| **M10** | Quality closeout & ops | **R2-e (CD)**, **R2-f (metrics/alerting)**, **R2-g (backups)**, **R2-h (Playwright E2E + security regression suite)**, mobile polish, accessibility pass, docs sync, Release 2 closeout doc | Full E2E suite green in CI; CD tag-to-production path proven; `/metrics` scrapeable |

Ordering rationale: M1 is a hard dependency of everything visual (M2–M9).
M6 precedes M7/M8 because billing and media both assume the workspace/team
model is fully surfaced. R2 register constraints carry over: R2-d requires
R2-c; R2-b requires the cookie-auth migration (both inside their milestones).

## 4. Original R2 register mapping

| Register task | Lands in |
|---|---|
| R2-a MFA reintegration (`recover/mfa` rebase) | M6 |
| R2-b CSRF + cookie auth (`recover/csrf` rebase) | M6 |
| R2-c Redis shared state | M7 |
| R2-d Async media job queue | M7 |
| R2-e CD pipeline | M10 |
| R2-f Metrics/alerting/tracing | M10 |
| R2-g Automated backup + restore drill | M10 |
| R2-h Security Highs + E2E suite | M10 |

## 5. External infrastructure (unchanged from original plan)

- **Redis** — managed instance required before M7.
- **Object storage** — S3-compatible bucket required before M7 media results land.
- **Payment provider** — Stripe test-mode keys required before M8 can be verified end-to-end (the abstraction itself needs none).
- **Email provider** — required for invitations (M6) and billing receipts (M8); abstracted behind a mailer interface with a console/dev transport so features work locally without one (shipped in M3).
- **CD platform / metrics backend** — confirm targets before M10 scoping (same as original plan).

## 6. Founder decisions carried over

- MFA/CSRF deferred from R1 → land in M6. Cookie-auth migration remains
  the slip-risk item.
- `recover/mfa` and `recover/csrf` are rebases, not rewrites.
- Everything AI remains behind `apps/backend/src/ai/`; media generation
  extends that abstraction rather than bypassing it.
