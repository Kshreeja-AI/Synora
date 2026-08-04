# Synora UI System

**Canonical UI and design-system document.**
**Created:** 2026-08-04, reconstructed from the codebase (see
`SYNORA_MASTER_BLUEPRINT.md` §0 for provenance and status-label rules).
Everything here is **Implemented** unless labelled otherwise; nothing is
documented that does not exist in `packages/design-system` or
`apps/web/src`.

---

## 1. Foundations

**Stack:** Next.js 15 App Router, React 19, Tailwind CSS, shadcn/ui-style
components in `packages/design-system`. Server Components by default;
Client Components opt-in. TanStack Query for server state, Zustand for UI
state (e.g. `keyboard-shortcuts-store`).

**Typography:** Geist Sans (UI) and Geist Mono (code), loaded in the root
layout and exposed as `--font-sans` / `--font-mono`.

**Theming:** dark-first. `:root` carries the dark palette;
a light theme overrides it. All colors are HSL triplet CSS custom
properties consumed as `hsl(var(--token))`, defined in
`packages/design-system/src/styles/tokens.css`.

### Design tokens (the real values)

| Token | Dark | Light |
|---|---|---|
| `--background` | `240 10% 4%` | `0 0% 100%` |
| `--foreground` | `240 6% 96%` | `240 10% 8%` |
| `--card` | `240 8% 6%` | `0 0% 100%` |
| `--popover` | `240 8% 7%` | `0 0% 100%` |
| `--primary` | `252 92% 68%` (violet) | `252 82% 58%` |
| `--secondary` / `--muted` | `240 5% 12%` | `240 5% 96%` |
| `--muted-foreground` | `240 5% 64%` | `240 4% 42%` |
| `--accent` | `240 5% 14%` | `240 5% 94%` |
| `--destructive` | `0 72% 56%` | `0 72% 48%` |
| `--success` | `152 60% 44%` | `152 60% 34%` |
| `--warning` | `38 92% 50%` | `32 95% 44%` |
| `--border` | `240 6% 14%` | `240 6% 90%` |
| `--input` | `240 6% 16%` | `240 6% 88%` |
| `--ring` | `252 92% 68%` | `252 82% 58%` |
| `--radius` | `0.625rem` | same |

Rule: **components consume tokens, never raw colors.** A hex literal in a
component is a defect.

---

## 2. Design-system components — `packages/design-system` (27)

Primitives: `Button`, `Input`, `Textarea`, `Checkbox`, `Switch`, `Label`,
`Badge`, `Avatar`, `Separator`, `Kbd`, `Spinner`, `Skeleton`.

Containers: `Card`, `Container`, `Grid`, `Dialog`, `Tabs`, `DropdownMenu`,
`Tooltip`, `Command` (palette primitives), `Breadcrumb`, `EmptyState`,
`Toaster`, `Heading`, `CTA`.

Domain: `FeedbackCorrection`, `FeedbackHallucination` — structured AI
feedback capture (corrections and hallucination reports), wired to the
feedback API.

Utility: `cn()` class-merge helper. Components are typed, accept refs where
relevant, and are tested (design-system coverage runs in CI).

---

## 3. Application shell — `apps/web/src/components/shell/`

`AppShell` composes: `Sidebar` (primary navigation), `Topbar`,
`WorkspaceSwitcher`, `UserMenu`, `NotificationsMenu`, `Breadcrumbs`,
`CommandPalette`, `KeyboardShortcutsDialog`, `CreateWorkspaceDialog`.
Every shell component has a colocated test.

### Keyboard shortcuts (as shipped, from `KeyboardShortcutsDialog`)

| Keys | Action |
|---|---|
| `⌘/Ctrl K` | Open command palette |
| `⌘/Ctrl /` | Show shortcuts list |
| `↑` `↓` | Move through palette results |
| `↵` | Select highlighted result |
| `Esc` | Close open dialog or menu |

Additional per-surface keys: `Enter`/`Escape` in folder rename and
creation dialogs; `↑`/`↓`/`Enter`/`Escape` in the search dialog.

---

## 4. Route map — `apps/web/src/app/`

```
(marketing)/            landing · pricing · features · changelog
auth/                   login · register · forgot-password · reset-password · verify-email
welcome/                post-signup
invite/                 invitation acceptance (public)
share/                  shared conversation view (public, token-scoped)
dashboard/              entry redirect
(dashboard)/
  conversations/        chat: list, detail, folders, branching
  knowledge/            prompt & conversation templates
  search/               full-text search
  studio/               media generation (credential-gated)
  developer/            API keys        [Partially implemented]
  admin/                admin console · engineering dashboard
```

Global: `error.tsx`, `global-error.tsx`, `not-found.tsx` — all tested.
`robots.ts` and `sitemap.ts` generate SEO artifacts. The `(dashboard)`
group is auth-guarded as a group, not per page.

---

## 5. Feature components — `apps/web/src/components/` (49, by domain)

**chat/** `Composer` (auto-expanding input, send control),
`MessageBubble` (attachments, editing, pin/unpin), `MessageEditor`,
`Markdown` (code highlighting), `MessageAttachments`, `ModelPicker`,
`FeedbackControls`, `ReportProblemDialog`.

**conversations/** list, `ConversationCreateDialog`, `FolderTree`
(rename/create inline, keyboard-driven), wired to the backend folder API.

**branching/** branch selector and tree view on the real branch API.

**search/** `SearchDialog` with full keyboard navigation.

**files/** upload, processing status, download.

**sharing/** share dialog and revocation, public-link surface.

**collaboration/** presence and typing indicators over Socket.IO.

**library/** prompt and conversation template browsing/use.

**studio/** image, video, and audio generation surfaces; honest empty/error
states when providers are unconfigured (they surface the backend's 503,
never fake output).

**history/** conversation activity.

**analytics/** usage summary and ledger tables.

**settings/** profile, account, sessions, workspace settings.

**tools/** tool registration and execution surfaces.

**auth/**, **marketing/** supporting components.

Domains with `__tests__/`: analytics, branching, chat, files, history,
sharing, studio, tools, shell (fully), plus page-level tests.

---

## 6. Admin engineering dashboard

`(dashboard)/admin/engineering/page.tsx` — the founder-facing readiness
surface, in plain business language:

1. **Launch gates** (top): each gate passed / failed / **unmeasured**, with
   value, threshold, evidence source, and sample size. Unmeasured gates
   state what evidence they are waiting for. **No overall percentage is
   rendered, by design** — see the blueprint §9 for why.
2. Watcher banner (dependency probes), coverage, runtime check.
3. Provider observatory matrix; prompt intelligence.
4. Cost table; latency and reliability drift (shared `DriftTable`).
5. Case capture status; event bus health.
6. `ProposalsPanel` — improvement proposals with caveats rendered at
   **equal visual weight** to the proposal itself: an unmeasured draft must
   not look like a verified fix.

---

## 7. UX principles enforced in code

- **Honest empty states.** "Not established" for an absent baseline —
  never `0`, because zero is a measurement and absence is not.
- **Unavailable ≠ broken.** Credential-gated features render as "not
  configured", not as errors.
- **Loading:** `Skeleton` for layout-known content, `Spinner` for actions.
- **Destructive actions** use `--destructive` and confirmation dialogs.
- **Feedback is structured** — corrections and hallucination reports are
  typed objects feeding the feedback pipeline, not free-text into a void.

## 8. Accessibility — Partially implemented

Present today: ARIA attributes and roles across 37 component files;
semantic HTML and labelled inputs in design-system primitives; full
keyboard operation of palette, dialogs, search, and folder tree; visible
focus rings via `--ring`.

**Not yet done** (recorded so it cannot be mistaken for done): no audited
WCAG conformance statement, no systematic screen-reader test pass, no
automated a11y suite (axe/Lighthouse) in CI, no formal contrast audit of
every token pairing. These belong to the launch-validation phase
(Lighthouse is already named in the local-first tooling list).

## 9. Motion — Partially implemented

Current: skeleton pulse, spinner rotation, dialog/menu transitions from
the component library defaults. **No documented motion language** (durations,
easings, reduced-motion policy) exists yet; defining one is Planned. Nothing
further is claimed.

## 10. Responsive behaviour — Implemented, unevenly verified

Layouts use responsive Tailwind classes throughout; the shell collapses for
narrow viewports. Systematic verification across breakpoints has not been
performed as a distinct pass — the E2E suite (thin today, see blueprint
§10) is where that evidence will come from.

## 11. Planned / Future vision (UI)

**Planned:** version-history UI (`ConversationVersion` model exists),
richer analytics dashboards, developer portal completion, motion language,
a11y audit pass.

**Future vision** (no implementation, no specification): AI Canvas,
mobile and desktop applications, offline mode, real-time co-editing
surfaces, marketplace/extension UI.

## 12. Maintenance protocol

Same rules as the blueprint: update in the same commit as UI changes;
tokens documented here must match `tokens.css` exactly (this table is a
copy, and drift between them is a defect); removals require a logged
reason; never document what does not exist.
