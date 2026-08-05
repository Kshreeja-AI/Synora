# SYNORA — UI System

**Created**: 2026-08-05
**Status**: LIVING DOCUMENT — maintained continuously alongside
`SYNORA_MASTER_BLUEPRINT.md` (product destination) and
`CURRENT_CAPABILITY_MATRIX.md` (present truth). This document records how
Synora's interface behaves and why, so every new surface is built to the
same rules instead of rediscovering them. It documents what actually
exists in `packages/design-system` and the app — nothing aspirational.

---

## 1. Foundations

**Tokens** (`packages/design-system/src/styles/tokens.css`). Every color
is an HSL triple consumed by the shared Tailwind preset as
`hsl(var(--token) / <alpha>)`. **Dark is the default theme** (`:root`);
light is the `[data-theme='light']` override, toggled via `next-themes`
with `attribute="data-theme"`. Semantic tokens only — components never
use raw hex: `background/foreground`, `card`, `popover`, `primary`
(violet, 252° hue), `secondary`, `muted`, `accent`, `destructive`,
`success`, `warning`, `border`, `input`, `ring`. One radius token
(`--radius: 0.625rem`).

**Component library** (`packages/design-system/src/components`). Avatar,
Badge, Breadcrumb, Button, Card, Checkbox, Command (palette primitives),
Container, CTA, Dialog, DropdownMenu, EmptyState, FeedbackCorrection,
FeedbackHallucination, Grid, Heading, Input, Kbd, Label, Separator,
Skeleton, Spinner, Switch, Tabs, Textarea, Toaster, Tooltip. New shared
primitives go here with tests; app-specific composites stay in
`apps/web/src/components`.

**Icons**: lucide-react, sized `h-3 w-3` (inline/dense) or `h-4 w-4`
(headings/buttons), always `aria-hidden` when decorative.

**Feedback**: `sonner` toasts. Success is stated plainly
(`toast.success('Run cancelled')`); errors surface the server's message
verbatim (`toast.error(e.message)`), never a generic "something went
wrong" when a real reason exists.

**State**: TanStack Query for server state (5-min staleTime, retry 1,
no refetch-on-focus — see `app/providers.tsx`); Zustand for the little
UI state that must persist (e.g. current workspace id). Polling for
liveness uses `refetchInterval` predicated on non-terminal state and
stops the moment nothing is in motion (see `useAgentRuns`,
`useToolExecution`) — push channels are reserved for realtime surfaces
that already have sockets.

## 2. The interface laws

These are behavioral rules every Synora surface follows. They exist
because each was decided deliberately at least once, with reasons; new
surfaces inherit them rather than re-litigating.

1. **Absent, not zero-valued.** An empty section disappears entirely.
   No "0 new items" banners, no empty headings that read as warnings
   about nothing, no dropdowns with no options (a project select with no
   projects is not rendered). `EmptyState` is for pages whose whole
   purpose is the missing thing, with a next action attached.

2. **Facts, never verdicts.** "Last activity 3 weeks ago" — yes.
   "This project is stalled" — never. The platform states what it knows
   and lets the person interpret it; a judgement would be wrong exactly
   during a deliberate pause.

3. **Provenance is always visible and never collapsed.** Model output,
   deterministic local output, and human-authored content are labeled
   distinctly (`planned by a model` / `deterministic plan` / `steps you
   wrote`; LOCAL/SIMULATED/REAL runtime notices). No surface may imply
   reasoning happened where it did not.

4. **Human words are verbatim.** Anything a person typed — a task, a
   decision note, a rejection reason — is stored and displayed exactly
   as written. Truncation for lists (80 chars) is allowed; rewording,
   summarising, or "cleaning up" is not.

5. **Undo over confirmation.** Destructive actions execute immediately
   and are reversible in one press, with the undo button *naming* what
   it will reverse ("Undo deleting 2 blocks"). One user action = one
   undo entry, however many records it touched. Confirmation dialogs are
   reserved for the genuinely irreversible.

6. **Consequences are stated before the click, not discovered after.**
   "Rejecting ends the whole run. A refused step is never skipped past."
   "This agent has been edited since this run — 'Run again' uses the
   current version." The sentence sits next to the button.

7. **Every dead end has a way back and a reason.** Not-found states say
   plainly what could not be found and link somewhere useful. Ancillary
   lookups that fail (a filed project no longer reachable) degrade to
   omission — the page never breaks over a label.

8. **The keyboard path survives.** Pointer affordances (drag, multi-
   select) always coexist with labeled, focusable controls doing the
   same job. Selection is an explicit toggle, never a modifier-click
   convention someone must be told about. Inputs have real `<label>`s
   (visually hidden where needed), interactive elements have accessible
   names, alerts use `role="alert"`.

9. **Offered, never demanded.** Optional structure (a project goal, a
   filing target, memory access) is presented as an offer with the
   benefit stated, and its absence never blocks starting work.

10. **One control shows and changes the same fact.** The select that
    files a conversation into a project also displays where it currently
    sits; taking it out is choosing "No project" (an explicit null),
    not a separate hidden affordance.

11. **Waiting states are honest about motion.** In-progress work polls
    and visibly updates; pages never freeze at the state the first
    request returned. Loading is a `Spinner` or `Skeleton`, and a panel
    that has nothing yet renders nothing rather than scaffolding.

12. **Security is invisible but absolute.** Cross-boundary probes get
    404 (never 403 where existence is the secret); UI hides controls the
    server would refuse (an Edit button a non-owner can see is a lie),
    but hiding is a courtesy — the server check is the enforcement.

## 3. Composition patterns (with canonical examples)

- **The decision surface** (`/dashboard`): sections ordered by how real
  their claim on attention is — waiting on you → running now → stopped
  unexpectedly → plain history. Each section absent when empty (law 1).
  Canonical: `WaitingForYou`, `ActiveWork`, `NeedsAttention`,
  `RecentActivity`.
- **The place work lives** (`ProjectWorkspacePanel`): identity + goal,
  "since you were last here" (only when it says something), one merged
  chronology across every kind of work, a single primary "continue"
  action, and a zero-friction capture field (decision notes).
- **The record of what happened** (`RunDetail`): nothing summarised
  away — every step, its state, attempts, approver, output, error, and
  the verbatim log behind a `<details>`.
- **The enrollment handshake** (`MfaSection`): multi-step flows advance
  only on server-verified proof, show secrets both scannable and
  copyable, and require explicit acknowledgment of recovery material
  before activation.
- **The permalink** (`/agents/runs/[runId]`, `/documents/[id]`): every
  page assumes nothing about how it was reached — it resolves identity
  cold from the URL, names what it shows, and links its context
  ("Filed in X", a back path).

## 4. Voice

Sentence case everywhere. Buttons name the action's object ("Add note",
"Stop this run", "Continue where you left off") — never bare "Submit" /
"OK". Explanatory microcopy is one plain sentence stating a reason, not
a marketing claim. The interface says "you", never "the user", and never
pretends to be a person.

## 5. Maintenance rule

A change that establishes a new interface behavior, or knowingly breaks
one of the laws above for a stated reason, updates this document in the
same commit. A law that acquires exceptions without this file recording
them is a bug in the documentation.
