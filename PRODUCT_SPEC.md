# PRODUCT SPEC — Synora AI Platform

**Created:** 2026-07-25
**Status:** Permanent product bible
**Maintenance rule:** Never remove information from this file. Only append
updates. Every AI engineer must read and follow this document before
implementing any feature, screen, or interaction.

---

## 1. Product Vision

Synora exists to give every creator on Earth a single, beautiful place to
create anything with AI — text, code, images, video, and audio — without
being locked into any provider, without surrendering ownership of their
work, and without needing to understand the machinery underneath.

We believe the AI creation tool of the future is not a chatbot, not a
prompt box, and not a collection of disconnected tabs. It is an
integrated creative workspace where every modality flows together, where
switching from one AI model to another is a settings change, and where
teams can collaborate on AI-generated work as naturally as they
collaborate on a Google Doc or a Figma file.

Five years from now, Synora should be what Figma is to design, what
Linear is to project management, and what Notion is to knowledge — the
default workspace that creators open every morning.

---

## 2. Product Mission

Make AI creation effortless, provider-agnostic, and collaborative for
every creator — from solo writers to enterprise teams — with a product
so polished it feels invisible.

Every decision we make must serve three commitments:

1. **The creator's flow is sacred.** Never interrupt it with loading
   states that could be avoided, modal dialogs that could be inline, or
   configuration that could be defaulted.
2. **The creator's work is theirs.** Every prompt, every asset, every
   project is portable, exportable, and survives any provider swap.
3. **The creator's trust is earned by transparency.** We tell them what
   model they're using, what it costs, and what happens to their data.

---

## 3. Target Users

### Primary: Professional creators (Pros)

Writers, content marketers, developers, designers, and video producers
who use AI tools daily and have outgrown single-purpose apps. They pay
for tools that save time. They care about output quality, workflow
speed, and not being locked into a vendor. Age 24-45, tech-comfortable
but not necessarily technical.

### Secondary: Creative teams (Teams)

Small-to-mid agencies, startup marketing teams, content studios, and
internal creative teams (5-50 people) who need shared workspaces, role
controls, a shared asset library, and visibility into what the team is
generating. The buyer is usually a team lead or director; the users are
individual creators.

### Tertiary: Enterprise creative organizations

Large organizations (500+ employees) with compliance requirements,
SSO/SAML mandates, audit log needs, data residency constraints, and the
desire to run AI on their own infrastructure. They buy through
procurement, require a security review, and need a self-hosted option.

### Not our users (today)

Hobbyists who won't pay for a tool. Developers building AI applications
(they need an API, not a workspace). Researchers who need fine-tuning
and training capabilities. These may become users in future releases, but
we do not design for them now.

---

## 4. User Personas

### Maya — the content lead

Maya manages a 6-person content team at a Series B SaaS company. She
uses ChatGPT, Midjourney, and ElevenLabs daily, but hates switching
between tabs, re-entering context, and explaining to her CEO why the team
uses four different AI subscriptions. She wants one tool where her team
can generate copy, images, and audio, see what everyone's working on,
and have a single bill. She evaluates tools based on how fast her team
ships, not on which model is underneath.

**Pain points:** Tool fragmentation, no shared history, no team
visibility, managing multiple API keys, explaining costs.

**Success metric:** Her team publishes content 2x faster with half the
tool subscriptions.

### Dev — the indie creator

Dev is a solo developer-creator who writes newsletters, builds side
projects, and generates marketing images. He's deeply technical, has
opinions about which AI model is best for which task, and wants to bring
his own API keys to keep costs low. He cares about keyboard shortcuts,
dark mode, and not being patronized by a UI that hides power features.

**Pain points:** Generic chat UIs that waste screen space, no model
choice, paying for capacity he doesn't use, no prompt library.

**Success metric:** He replaces three separate AI tools with one Synora
workspace and spends less.

### Ava — the creative director

Ava runs a 30-person creative agency. She cares about brand consistency,
client separation (one workspace per client), approval workflows, and
being able to show clients what was generated, by whom, and when. She
needs SSO for her team, an audit trail for compliance, and the ability
to restrict which AI providers are used (her clients in regulated
industries won't allow certain cloud providers).

**Pain points:** No client separation, no audit trail, can't restrict
providers, can't demonstrate compliance.

**Success metric:** Her agency onboards clients to Synora workspaces
and replaces their internal toolchain.

---

## 5. User Problems

These are the problems Synora solves, ordered by severity:

1. **Tool fragmentation.** Creators use 3-5 separate AI tools (text,
   image, video, audio, code), each with its own account, interface,
   billing, and data silo. Context is lost between tools. There is no
   unified history.

2. **Provider lock-in.** When a creator builds workflows around one AI
   provider and that provider raises prices, degrades quality, or changes
   terms, migration is manual and painful. Prompts are tied to one
   vendor's format.

3. **No team workflow.** Most AI tools are single-player. There is no
   shared workspace, no role-based access, no way to see what the team
   has generated, and no shared prompt library.

4. **Wasted time on infrastructure.** Technical creators spend hours
   managing API keys, building wrappers, and stitching tools together.
   Non-technical creators can't self-serve at all.

5. **Poor creative UX.** Most AI tools are chat-first interfaces that
   waste 60% of the screen on conversation chrome. Creators need a
   canvas-oriented, project-organized workspace — not a messaging app.

6. **Opacity.** Creators don't know which model generated their output,
   what it cost, or whether their prompts are being used for training.

---

## 6. User Journey

### Discovery → Trial

1. Creator finds Synora via search, word of mouth, or a shared asset link
2. Lands on the marketing site — reads the value proposition in under 10
   seconds
3. Clicks "Start creating free" — no credit card required
4. Registers with email (or OAuth in a future release)

### Onboarding (first 2 minutes)

5. Enters their name (pre-filled from registration if provided)
6. Creates their first workspace (suggested name, auto-generated slug)
7. Picks a theme preference (dark is default — this is a signal that we
   respect their taste, not a throwaway setting)
8. Lands in the dashboard with their first workspace ready

### First value (under 5 minutes)

9. The dashboard has a prominent "Try AI generation" card with a
   pre-filled example prompt
10. They generate their first piece of content (text or code) with one
    click — zero configuration if an API key is provided by the platform,
    or a guided "bring your own key" flow if self-hosted
11. The result appears instantly in their project, with the model name and
    generation time visible

### Habit formation (first week)

12. They create a project, organize generations into it
13. They discover the prompt library and save their first prompt
14. They try the command palette (Cmd+K) and realize they can navigate
    the entire app without touching the mouse
15. They invite a teammate (Teams plan) or hit a Free tier limit and
    consider Pro

### Upgrade (within 30 days)

16. They hit the project limit (Free: 3 projects) or want media
    generation (Pro)
17. The upgrade flow is inline — no redirect to a billing portal in
    another tab
18. They're on Pro and creating across all modalities

---

## 7. First Impression

The first 10 seconds determine whether a creator trusts Synora enough to
sign up. The first impression must communicate three things:

1. **This is a premium tool.** The visual quality must match Linear,
   Raycast, and Vercel. No stock imagery, no generic dashboard screenshots,
   no "AI" cliches (no robot illustrations, no brain graphics, no neon
   gradients).

2. **This does something I need.** The hero copy must state the value
   proposition in one sentence. Not "AI-powered creation platform" but
   "Create anything with AI. Own every part of it."

3. **I can start for free right now.** The CTA must be prominent, the
   word "free" must be present, and there must be no mention of credit
   cards.

The marketing site must feel like a product, not a landing page. The
glass navbar, smooth scrolling, and subtle animations signal engineering
quality. The footer must include real links (pricing, features, changelog)
— dead links destroy trust faster than missing features.

---

## 8. Brand Personality

Synora's brand voice is **confident, precise, and warm** — never
corporate, never cute, never condescending.

### We are:

- **Direct.** "Switch AI providers in settings" — not "Seamlessly
  transition between best-in-class AI models with our revolutionary
  provider abstraction layer."
- **Honest.** If a feature is coming soon, we say "coming soon" — not
  "experience the future of." We never screenshot a mock-up and label it
  as a product.
- **Respectful of expertise.** Our users are creators and professionals.
  We don't explain what AI is. We don't use tooltips to explain what a
  "workspace" is. We assume competence.
- **Specific.** "10 AI providers" — not "multiple." "$20/month" — not
  "affordable." "15-minute token expiry" — not "short-lived."

### We are not:

- **Hype-driven.** No "revolutionary," "game-changing," "next-generation,"
  "cutting-edge," or "powered by AI" (everything is powered by AI — saying
  it is noise).
- **Playful at the expense of clarity.** A clever button label that takes
  2 seconds to parse is worse than a boring one that takes 0.5 seconds.
- **Verbose.** Every word must earn its place. If a section of UI text
  can be cut in half and say the same thing, cut it in half.

---

## 9. UX Philosophy

### Principle 1: Reduce time to creation

Every screen must be optimized for getting to the next creative action.
Registration to first generation must be under 5 minutes. Opening the
app to generating content must be under 30 seconds. If a workflow takes
more than 3 clicks, it's wrong.

### Principle 2: Progressive disclosure

Show the simplest possible interface by default. Power features (model
selection, temperature, system prompts, advanced settings) are available
but not in the way. The Free tier user and the power user should both
feel that the interface was designed for them.

### Principle 3: Spatial consistency

The sidebar is always on the left. Navigation is always in the same
place. The command palette is always Cmd+K. The user should never have
to wonder "where am I?" or "how do I get back?" Every page has a
breadcrumb context. Back always works.

### Principle 4: No dead ends

Every empty state has a clear action. Every error state has a recovery
path. Every loading state shows progress (or at least a skeleton that
communicates structure). The user is never left staring at a blank
screen.

### Principle 5: Keyboard-first, mouse-friendly

Every action reachable by mouse must also be reachable by keyboard.
Power users should be able to navigate the entire application without
touching the mouse. But the mouse experience must be equally polished —
keyboard-first does not mean mouse-hostile.

### Principle 6: Respect the creator's attention

No marketing banners inside the product. No upgrade nags on every page.
No analytics popups. No cookie consent modals beyond what the law
requires. The product UI is the creator's workspace — treat it with the
same respect you'd treat their desk.

---

## 10. Design Philosophy

### Premium by default

Synora must look and feel like a product that costs money, even on the
Free tier. The quality bar is Linear, Vercel, Raycast, and the Anthropic
Console — not generic SaaS templates.

This means:
- Generous whitespace. Content breathes.
- Consistent spacing scale (4px base, multiples of 4).
- Subtle borders, not heavy dividers. `border-border` at `hsl(...)` with
  low opacity, not solid black lines.
- Depth through shadow and layering, not through color blocks.
- Micro-interactions on every interactive element (hover, focus, active).
- No raw HTML form elements. Every input, button, select, and checkbox
  comes from the design system.

### Token-driven

Every color, radius, shadow, and font size comes from CSS custom
properties (design tokens). No hardcoded hex values anywhere in
application code. This makes theming a data-attribute swap, not a
rebuild.

### Dark-first

Dark mode is the default theme. It's not an afterthought or an
"alternative" — it's the primary design surface. Light mode is supported
and must look equally good, but dark mode is what we design first, test
first, and screenshot first.

Rationale: our users are creators who work in visual tools. They
overwhelmingly prefer dark interfaces (evidence: every design tool,
code editor, and creative app defaults to dark). Leading with dark also
forces better contrast discipline — if it's readable on dark, it's
readable on light.

### Component-driven

Every UI element is composed from the design system
(`@synora/design-system`). Pages do not create one-off styled elements.
If a page needs a component that doesn't exist, the component is added
to the design system with tests, not hand-rolled in the page.

---

## 11. Animation Philosophy

Animation in Synora serves clarity, not decoration. Every animation must
answer: "What does this help the user understand?"

### Rules

1. **Enter animations communicate origin.** A dialog sliding up from the
   bottom tells the user it's a layer on top of their current context. A
   sidebar sliding in from the left tells the user it's a persistent
   navigation surface.

2. **Exit animations are faster than enter animations.** Closing is a
   decision the user has already made — don't make them wait for the
   animation to confirm it. Enter: 200-300ms. Exit: 150-200ms.

3. **Loading animations communicate progress.** Skeletons over spinners.
   Shimmer over static gray. Staggered fade-in over simultaneous pop-in.

4. **Micro-interactions confirm actions.** A button's pressed state, a
   toggle's snap, a card's hover lift — these confirm that the interface
   heard the user. They must be fast (under 150ms) and subtle (scale
   1.0→1.02, not 1.0→1.1).

5. **No animation on repeat actions.** The first time a user sees a page,
   content can fade in. On subsequent navigations, it should appear
   instantly. Use `prefers-reduced-motion` and `motion-safe:` Tailwind
   variant.

6. **Page transitions are instant.** No full-page fade transitions
   between routes. Content changes; the shell stays. This is a web app,
   not a slideshow.

### Approved easing curves

- `ease-out` (cubic-bezier 0.0, 0.0, 0.2, 1.0) for enters
- `ease-in` (cubic-bezier 0.4, 0.0, 1.0, 1.0) for exits
- `ease-in-out` for transforms that loop (loading spinners)
- Linear only for progress bars

### Approved animation tokens

Defined in `tailwind-preset.cjs`: `fade-in`, `fade-up`, `shimmer`,
`gradient-x`. New animations are added to the preset, never inline.

---

## 12. Color Philosophy

### Semantic, not decorative

Colors communicate meaning, not brand identity. The palette is
minimal and functional:

| Token | Purpose | Example |
|---|---|---|
| `background` | Page/surface background | Dark: near-black. Light: white. |
| `foreground` | Primary text | High contrast against background |
| `primary` | Interactive elements, CTAs | Accent hue (currently a purple-blue) |
| `primary-foreground` | Text on primary-colored surfaces | Always readable |
| `muted` | Subdued surfaces | Slightly lighter/darker than background |
| `muted-foreground` | Secondary text, labels | Readable but visually subordinate |
| `border` | Dividers, input borders | Subtle, low-opacity |
| `destructive` | Delete, error, danger | Red family |
| `success` | Positive status, completion | Green family |
| `warning` | Caution, attention | Amber/yellow family |
| `accent` | Highlighted surfaces (hover, active) | Slight shift from background |
| `ring` | Focus indicator | Must pass WCAG 2.1 AA contrast |

### Contrast requirements

- All text must meet WCAG 2.1 AA contrast (4.5:1 for normal text, 3:1
  for large text) in both themes.
- Interactive elements must have a visible focus indicator that meets
  3:1 contrast against adjacent colors.
- Status colors (destructive, success, warning) must be distinguishable
  without relying solely on color — always pair with an icon or label.

### No brand colors in the product UI

The marketing site uses the full brand palette. Inside the product (post-
login), color is purely functional. The product UI does not "look like
Synora" through color — it looks like Synora through typography, spacing,
and interaction quality.

---

## 13. Typography

### Font stack

- **Primary (sans):** Geist Sans — geometric, technical, excellent at
  small sizes. Used for all UI text, headings, and body copy.
- **Monospace:** Geist Mono — matches Geist Sans's proportions. Used for
  code blocks, model names, token counts, and technical values.

Both fonts are bundled via npm (`geist` package) and loaded locally — no
build-time or runtime network requests for fonts. This is a non-negotiable
architecture decision: Docker builds and CI must never depend on Google
Fonts CDN availability.

### Scale

- Use Tailwind's default type scale (`text-xs` through `text-7xl`)
- Headings: `font-bold` or `font-semibold`. Never `font-black` (too
  heavy for screens).
- Body: `font-normal` (400 weight). Never `font-light` (too thin for
  dark backgrounds).
- Line height: Tailwind defaults (`leading-normal`, `leading-relaxed`).
  Tighten for headings (`leading-tight`), loosen for body blocks.

### Rules

- One font size per visual level. Don't use `text-sm` and `text-xs` on
  the same line unless one is explicitly subordinate (e.g., a label and
  its helper text).
- Monospace is only for code, model identifiers, and numeric values that
  need tabular alignment. Never for headings or body text.
- Truncation over wrapping for single-line values (file names, model
  names, workspace names). Show the full value on hover via tooltip.

---

## 14. Navigation

### Sidebar (left, collapsible)

The sidebar is the primary navigation surface. It contains:

1. **Workspace switcher** — top of sidebar, shows current workspace name
   and avatar. Click to open workspace picker dropdown.
2. **Primary navigation** — icon + label links: Dashboard, Projects,
   Documents, AI Playground, Generation History, Assets (when media
   ships), Prompt Library.
3. **Workspace section** — Members, Settings (visible to admins/owners).
4. **Collapse toggle** — bottom of sidebar. Collapsed mode shows icons
   only with tooltips on hover. State persists across sessions.

Width: 256px expanded, 64px collapsed. Transition: 200ms ease-out.

### Topbar (fixed)

The topbar spans the content area (right of sidebar). It contains:

1. **Breadcrumbs** — show the current location (Workspace > Project >
   Document). Clickable for navigation.
2. **Search / Command Palette trigger** — right side, shows "Cmd+K"
   shortcut hint.
3. **Notifications bell** — opens notification panel.
4. **User avatar** — opens user menu dropdown (Profile, Settings, Theme,
   Log out).

Height: 56px. Background: subtle glass/blur effect, consistent with
marketing navbar.

### Mobile navigation

On screens below 768px:
- Sidebar becomes a slide-over drawer, triggered by a hamburger icon in
  the topbar.
- Topbar stays fixed and gains the hamburger trigger.
- Bottom tab bar is NOT used — drawers are more scalable as navigation
  grows and avoid the "too many tabs" problem.

---

## 15. Dashboard Experience

The dashboard is the first thing a user sees after login. It must
accomplish three things:

1. **Orient.** Show the user where they are (which workspace), what's
   recent, and what they can do.
2. **Accelerate.** Provide fast paths to the most common actions: new
   generation, open recent project, create a project.
3. **Inform.** Surface relevant information: recent generations, usage
   stats (Pro/Team), team activity (Team).

### Layout

- **Welcome header** — "Good morning, {name}" with workspace context.
  Subtle, not a full-screen hero.
- **Quick actions row** — 3-4 cards: "New text generation," "New project,"
  "Open playground." Each is a single click to action.
- **Recent activity** — list or grid of recent projects, documents, and
  generations. Each card shows title, type icon, timestamp, and a
  thumbnail/preview where applicable.
- **Usage summary** (Pro/Team) — compact card showing generation count,
  storage used, and plan limits. Not a chart — a clear text summary with
  a progress bar.
- **Team activity** (Team) — feed of recent team member actions. Shows
  avatar, action, and timestamp. Not a notification center — a passive
  awareness surface.

### Empty state (new user)

The dashboard for a new user with no projects or generations shows:
- Welcome message with their name
- A single prominent card: "Create your first project" with a
  description of what projects are for and a CTA button
- A secondary card: "Try AI generation" with a pre-filled example prompt
  and a "Generate" button that works without creating a project first
- No sidebar links are grayed out — all are clickable, and each empty
  section has its own meaningful empty state

---

## 16. Workspace Experience

Workspaces are the organizational primitive. Every project, document,
and generated asset belongs to a workspace. Users can belong to
multiple workspaces with different roles.

### Workspace creation

- **Trigger:** onboarding wizard (first workspace), sidebar "Create
  workspace" button (additional workspaces), or settings page.
- **Flow:** name → auto-generated slug (editable) → optional description
  → create. One screen, not a multi-step wizard (additional workspaces
  are a power-user action).
- **Creator becomes OWNER** automatically. No confirmation needed.

### Workspace switching

- **Trigger:** workspace switcher in sidebar (top position, always
  visible).
- **Dropdown:** shows all workspaces the user belongs to, with name,
  avatar, and role. "Create workspace" option at the bottom.
- **Switching is instant.** The sidebar, dashboard, and all content
  update to the selected workspace. URL changes to include workspace
  context.

### Workspace settings (owner/admin only)

- General: name, slug, description, avatar
- Members: invite by email, change roles, remove members
- Billing: plan details, upgrade/downgrade (M7)
- API keys: create/revoke workspace API keys (M5)
- Danger zone: transfer ownership, delete workspace

### Roles

| Role | Can create | Can view all | Can manage members | Can manage settings | Can delete workspace |
|---|---|---|---|---|---|
| Owner | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes (except billing) | No |
| Editor | Yes | Yes | No | No | No |
| Member | Yes | Own only | No | No | No |
| Viewer | No | Yes | No | No | No |

---

## 17. AI Chat Experience

The AI chat interface is where users have conversational interactions
with AI models. It is NOT the primary generation interface (that's the
playground) — it's the freeform, open-ended surface for exploration,
brainstorming, and iterative refinement.

### Layout

- **Thread list** (left panel or drawer): shows conversation history,
  searchable, sortable by date.
- **Chat area** (center): messages displayed in a clean, readable format.
  User messages right-aligned, AI responses left-aligned. Markdown
  rendered. Code blocks syntax-highlighted with copy button.
- **Model selector** (top of chat): dropdown showing current model and
  provider. Switchable mid-conversation.
- **Input area** (bottom, fixed): auto-expanding textarea. Send on
  Enter, newline on Shift+Enter. Attachment button for context files
  (future).

### Behavior

- Streaming responses: tokens appear as they arrive, not after the full
  response is complete. Cursor blinks at the insertion point.
- Stop button: visible during streaming, stops generation immediately.
- Retry: user can re-generate the last AI response with one click.
- Edit: user can edit a previous message and re-generate from that point.
- The model and provider used for each response is visible (small label
  below the response). This is transparency, not decoration.

### What it is NOT

- It is not a "copilot" that watches everything you do. It is an
  explicit, user-initiated conversation.
- It is not a replacement for the playground. The playground is
  structured (prompt → result). Chat is freeform.
- It does not have "personas" or "characters." It's a professional tool.

---

## 18. AI Agent Experience

AI agents are autonomous multi-step workflows that accomplish complex
tasks on behalf of the user. This is a future capability (Release 3+)
and must be designed now even though it is not implemented.

### Vision

An agent is a named, reusable workflow that:
1. Accepts a high-level goal ("Research competitors and write a summary")
2. Breaks it into steps
3. Executes each step using the AI generation capabilities
4. Reports progress and results back to the user

### UX principles

- **Transparency above autonomy.** The user must see what the agent is
  doing at every step. No black boxes. Show the plan, show progress,
  show intermediate results.
- **Human-in-the-loop by default.** Agents request confirmation before
  taking actions with side effects (sending emails, publishing content,
  spending tokens beyond a threshold).
- **Interruptible.** The user can pause, modify, or cancel an agent at
  any step.
- **Auditable.** Every step is logged: what was decided, what was
  generated, what tools were used, how many tokens were consumed.

### Architecture alignment

Agents sit above `generateText()` and below routes in the backend
architecture. They inherit provider-agnosticism by construction — an
agent doesn't know or care which model answers its requests.

---

## 19. AI Image Experience

Image generation is a prompt-to-image workflow with durable storage and
project organization.

### Flow

1. User navigates to image generation (sidebar, command palette, or
   project context)
2. Enters a prompt. Optional: select style, aspect ratio, model
3. Clicks "Generate"
4. Sees a loading skeleton in the target aspect ratio (not a spinner —
   a skeleton communicates what's coming)
5. Image appears. Options: download, add to project, generate variations,
   regenerate with modified prompt
6. Image is automatically saved to the workspace asset library

### Key decisions

- **Async by design.** Image generation takes 5-60 seconds. The API
  returns 202 with a job ID. The client polls or receives a push
  notification when complete. The user can navigate away and come back.
- **Results are permanent.** Generated images are stored in durable
  object storage with workspace-scoped access. They don't disappear.
- **Metadata is preserved.** Every image stores its prompt, model,
  provider, generation parameters, timestamp, and the user who generated
  it.
- **Batch generation.** Users can request multiple variations (2, 4, 8)
  from a single prompt. Results appear in a grid.

### Empty state

"No images yet" with a prominent "Generate your first image" card
showing an example prompt and a preview of what the output looks like.

---

## 20. AI Video Experience

Video generation follows the same pattern as image generation with
longer processing times and richer preview.

### Flow

1. User enters a prompt or selects a script
2. Optional: duration, aspect ratio, style, model
3. Submits — sees a progress card with estimated time remaining
4. Video appears in-place with a player. Options: download, add to
   project, regenerate.
5. Video saved to workspace asset library

### Key decisions

- Processing times are 30 seconds to several minutes. The UI must
  communicate progress without requiring the user to wait on-page.
- A notification (in-app, push if enabled) fires when the video is ready.
- Video thumbnails are auto-generated from the first frame.
- The video player is embedded (no external redirects to watch a video).

---

## 21. AI Audio Experience

Audio generation covers voiceovers, narration, sound effects, and music.

### Flow

1. User enters text (for speech) or a descriptive prompt (for music/SFX)
2. Optional: voice selection, duration, model
3. Submits — sees a waveform loading skeleton
4. Audio appears with an inline player. Options: download, add to project,
   regenerate.
5. Audio saved to workspace asset library

### Key decisions

- Inline playback is mandatory. Users must be able to listen without
  downloading.
- Waveform visualization for audio assets (not a generic music icon).
- Text-to-speech previews are fast (under 10 seconds for short clips) and
  can be synchronous; long-form narration is async.

---

## 22. AI Code Experience

Code generation is a specialized mode of the AI engine tuned for
developer workflows.

### Playground mode

- **Input:** prompt textarea + language selector + optional system prompt
- **Output:** syntax-highlighted code block with copy button, language
  detection, and line numbers
- **Model selector:** same as text, but defaults to a code-optimized
  model if available

### Integration with documents

- Code generations can be saved as documents with `PLAIN_TEXT` format
- Future: inline code editor with AI-assisted completion

### Key decisions

- Code output is never wrapped in prose. The `code-generation` capability
  applies code-specific defaults so output is runnable.
- Output must be copyable with one click (copy button on the code block,
  not Cmd+C which requires selection).
- Language detection is automatic but overridable.
- The code playground should feel closer to a REPL than to a chat.

---

## 23. Collaboration Experience

Collaboration is how teams work together on AI-generated content.

### Shared visibility

- All workspace members can see projects, documents, and generated
  assets (subject to role permissions).
- Recent activity feed shows who generated what, when.
- Asset library shows all generated content across the workspace.

### Real-time (future)

- Multiple users viewing the same document see each other's cursors
  (Release 3+, requires WebSocket infrastructure).
- Comments on generated content: "Can you regenerate this with a more
  formal tone?" (Release 3+).

### Sharing

- Share a generated asset (image, text, code) via a public link with
  optional expiry.
- Embed generated content in external sites via iframe (future).
- Export projects as ZIP with all assets and metadata.

### Permissions

Workspace roles govern access. There is no per-document permission model
today — access is workspace-scoped. Per-document permissions are a
Release 3+ concern.

---

## 24. Billing Experience

Billing must be invisible when it works and helpful when it doesn't.

### Principles

- **No billing page until there's something to pay.** Free tier users
  see usage limits but never a billing page.
- **Upgrade is contextual.** When a user hits a limit (3 projects on
  Free), the upgrade prompt appears where the limit was hit, not in a
  settings page they have to find.
- **Downgrade is frictionless.** No "talk to sales to cancel." No
  17-step retention flow. Cancel is two clicks: Settings → Billing →
  Cancel plan. Confirmation dialog. Done.
- **Invoices are accessible.** Past invoices viewable and downloadable
  from the billing page. No "check your email."

### Plan display

- Current plan with feature list and usage summary
- Upgrade/downgrade options with clear price comparison
- Annual vs monthly toggle with savings displayed
- Payment method management (add/update/remove card)

### Usage visibility

- Token/generation count per billing period
- Storage used (when media ships)
- Seat count (Team plan)
- Simple progress bars against plan limits — not complex charts

---

## 25. Admin Experience

The admin dashboard is for platform operators and workspace owners with
Admin/Moderator roles.

### Platform admin (ADMIN role)

- User management: list, search, suspend, delete users
- Workspace overview: list all workspaces, usage stats
- System health: API latency, error rates, generation queue depth
- Audit log viewer: filterable log of all security-relevant events
- Feature flags (future): enable/disable features per workspace

### Workspace admin (OWNER/ADMIN workspace role)

- Member management: invite, change roles, remove
- Usage dashboard: workspace-level generation stats
- API key management: create, rotate, revoke
- Billing management: plan, payment method, invoices

### Principles

- Admin UIs are functional, not beautiful. Density over decoration.
- Tables over cards for list views — admins need to scan data fast.
- Every admin action is logged in the audit trail.
- Destructive actions (suspend user, delete workspace) require typed
  confirmation ("type workspace name to delete").

---

## 26. Mobile Experience

Synora is a responsive web application — not a native mobile app (native
is a future release). The mobile web experience must be excellent, not
merely functional.

### Breakpoints

- Mobile: 0-639px (`sm:` breakpoint)
- Tablet: 640-1023px (`md:` breakpoint)
- Desktop: 1024px+ (`lg:` breakpoint)

### Mobile-specific behavior

- Sidebar → slide-over drawer (hamburger trigger)
- Topbar → compact (workspace name truncated, avatar smaller)
- Cards → single column, full width
- Dialogs → full-screen on mobile (not centered floating)
- Command palette → full-screen overlay
- Tables → horizontal scroll within a container (`overflow-x: auto`),
  or card-based layout for small datasets
- Text generation → full-screen input with output below

### What must work perfectly on mobile

- Registration and login
- Dashboard browsing
- Text generation (simple prompts)
- Reading and copying generated content
- Switching workspaces
- Notifications

### What can be desktop-optimized

- Complex settings pages (multi-column layouts)
- Admin dashboards (data-dense tables)
- Side-by-side comparisons
- Code editing with line numbers

---

## 27. Tablet Experience

Tablets get the best of both worlds: mobile touch interaction with
desktop-class layout space.

### Behavior

- Sidebar is collapsible (not a drawer) — starts collapsed, expandable
- Two-column layouts where desktop uses three
- Touch targets are 44x44px minimum (Apple HIG standard)
- Hover states replaced with active/pressed states
- Command palette works with on-screen keyboard

---

## 28. Desktop Experience

Desktop is the primary design target. This is where creators do deep
work.

### Expectations

- Full sidebar always visible (collapsible by choice)
- Multi-column layouts for settings and admin
- Keyboard shortcuts for every action
- Command palette as the fastest way to navigate
- Hover states on every interactive element
- Right-click context menus on projects, documents, assets (future)
- Drag-and-drop for file uploads and project organization (future)
- Window resizing gracefully reflows all layouts

---

## 29. Accessibility

Accessibility is a requirement, not a feature. Every page and component
must be usable by people with disabilities.

### Standards

- **WCAG 2.1 AA** compliance minimum. AAA where achievable without
  compromising the design.
- All interactive elements must be keyboard-reachable and operable.
- All images must have alt text (generated images: use the prompt).
- All form inputs must have associated labels.
- Color is never the sole indicator of status — always pair with icon,
  text, or pattern.

### Implementation

- Radix primitives (used in the design system) provide accessible
  defaults: focus traps in dialogs, aria attributes on menus, keyboard
  navigation on tabs.
- `prefers-reduced-motion` is respected via the `motion-safe:` Tailwind
  variant.
- Focus indicators use the `ring` token and must be visible in both
  themes.
- Screen reader announcements for dynamic content changes (toast
  notifications, loading completions).
- Skip-to-main-content link on every page.

### Testing

- Axe accessibility audit on every page (M9 Playwright suite)
- Manual screen reader testing (VoiceOver, NVDA) for critical flows:
  registration, login, generation, navigation
- Keyboard-only navigation testing for all core workflows

---

## 30. Performance Targets

### Page load

| Metric | Target |
|---|---|
| First Contentful Paint (FCP) | < 1.5s |
| Largest Contentful Paint (LCP) | < 2.5s |
| Cumulative Layout Shift (CLS) | < 0.1 |
| First Input Delay (FID) | < 100ms |
| Time to Interactive (TTI) | < 3.5s |

### API response

| Endpoint type | Target |
|---|---|
| Auth (login/register) | < 500ms |
| CRUD read (list/get) | < 200ms |
| CRUD write (create/update) | < 500ms |
| AI text generation (streaming) | First token < 2s |
| AI image generation (async) | Job accepted < 500ms |

### Client-side

| Metric | Target |
|---|---|
| Route transition | < 100ms (perceived) |
| Command palette open | < 50ms |
| Search results | < 200ms |
| Skeleton → content swap | No layout shift |

### Bundle size

- Initial JS bundle: < 150KB gzipped (excluding vendor chunks)
- Per-route code split: lazy load routes not in the initial viewport
- Design system: tree-shakeable — unused components must not be bundled

---

## 31. Error States

Every error must be handled. No uncaught exceptions visible to users.

### Principles

- **Tell them what happened** — in plain language. Not "Error 500" but
  "Something went wrong on our end."
- **Tell them what to do** — "Try again," "Go back to dashboard," "Check
  your internet connection."
- **Don't blame them** — never "Invalid input." Instead: "Please enter a
  valid email address."
- **Preserve their work** — if a generation fails, the prompt must still
  be in the input. If a form submission fails, the form must still be
  filled.

### Error types and their UX

| Type | Example | Display |
|---|---|---|
| Validation error | Empty required field | Inline message below the field, red border |
| Auth error | Wrong password | Form-level message, no field indication (email enumeration protection) |
| Network error | Server unreachable | Toast notification with retry action |
| Rate limit | Too many requests | Toast with countdown ("Try again in 30 seconds") |
| Generation error | AI provider failure | Inline error in the generation result area with retry button |
| Not found | Invalid URL | Full-page 404 with search suggestion and home link |
| Server error | Unexpected failure | Full-page error with "Try again" and "Go to dashboard" |
| Permission error | Insufficient role | Contextual message explaining what role is needed |

---

## 32. Empty States

Empty states are onboarding opportunities, not dead ends.

### Principles

- Every empty state has a **title**, a **description**, and a **CTA
  button**.
- The title states what would be here if it weren't empty: "No projects
  yet" — not "Nothing to see here."
- The description explains the value: "Projects organize your AI
  generations, documents, and assets in one place."
- The CTA creates the first item: "Create your first project" — not
  just "Create project" (the word "first" acknowledges they're new).
- An illustration or icon is optional and must be tasteful — no cartoon
  characters, no confetti, no "sad face" imagery.

### Required empty states

Every list view must have a designed empty state:
- Projects list
- Documents list
- Generated images / videos / audio
- Prompt library
- Generation history
- Team members (workspace just created)
- Notifications
- Search results ("No results for '{query}'" with spelling suggestions)

---

## 33. Loading States

Loading states communicate that work is happening. They prevent the
user from wondering if the interface is broken.

### Skeleton loading

The default loading pattern is skeleton screens — gray shapes that match
the layout of the content that will appear. This communicates structure
before content.

- Cards: skeleton card with placeholder lines
- Lists: skeleton rows with shimmer animation
- Text: skeleton lines at paragraph width
- Images: skeleton rectangle at the target aspect ratio

### When to use skeletons vs spinners

| Scenario | Pattern |
|---|---|
| Page content loading | Skeleton (matches layout) |
| Action in progress (button click) | Button loading state (spinner inside button, button disabled) |
| Background refresh | No visible indicator (TanStack Query refetch) |
| Long operation (generation) | Inline progress or skeleton with message |
| Navigation | Instant (client-side routing); skeleton for server data |

### Never

- A full-page spinner with no other content
- A loading bar that doesn't represent actual progress
- "Loading..." text without a visual indicator
- A blank white/black screen

---

## 34. Offline Behavior

Synora is an online-first application. Most features require a server
connection. However, the offline experience must not be hostile.

### When offline

- Show a clear, persistent banner: "You're offline. Changes will sync
  when you reconnect." (not a modal that blocks the UI)
- Read-only access to cached data (TanStack Query cache) where available
- Generation requests queue locally and retry on reconnect (future)
- The app never crashes or shows a blank page due to network failure

### Service worker

Not implemented today. When added (M9 scope), it should cache the app
shell and static assets for instant loading, not act as a full offline
database.

---

## 35. Notifications

Notifications inform the user about events that happened outside their
current focus.

### Types

| Type | Example | Channel |
|---|---|---|
| Generation complete | "Your image is ready" | In-app, push (if enabled) |
| Team activity | "Maya invited you to workspace 'Acme'" | In-app, email |
| System | "Your plan renews in 3 days" | In-app |
| Security | "New login from Chrome on macOS" | In-app, email |

### In-app notifications

- Bell icon in the topbar with unread count badge
- Dropdown panel showing recent notifications, grouped by date
- Mark as read (individual, all)
- Click a notification to navigate to the relevant content

### Push notifications

- Opt-in only (never enabled by default)
- Settings page to control which notification types trigger push
- Used sparingly: only for events that genuinely benefit from
  interruption (generation complete, security alerts)

### Email notifications

- Opt-in per type in user preferences
- Unsubscribe link in every email
- Transactional emails (password reset, invitation) are always sent
  regardless of preference

---

## 36. Settings

Settings are organized by scope: user-level and workspace-level.

### User settings

- **Profile:** name, avatar, bio (UserProfile model)
- **Account:** email, password change, delete account
- **Appearance:** theme (dark/light/auto), language
- **Notifications:** per-type toggle for in-app, email, push
- **Sessions:** list active sessions, revoke any session
- **Security:** MFA enrollment (M5), password change
- **API keys:** personal API keys (separate from workspace keys)

### Workspace settings (owner/admin)

- **General:** name, slug, description, avatar
- **Members:** invite, change roles, remove
- **Billing:** plan, payment method, invoices (M7)
- **API keys:** workspace-scoped keys
- **Security:** provider restrictions, SSO configuration (R3)

### Layout

- Left nav for settings sections (not tabs — too many sections for tabs)
- Content area with form sections
- Save button at bottom of each section (not auto-save for settings — users
  expect explicit save for configuration changes)
- Destructive actions in a "Danger zone" section at the bottom, visually
  separated with a destructive-colored border

---

## 37. Search

Search is a first-class feature, not an afterthought.

### Global search (Cmd+K or search bar)

- Searches across: projects, documents, generated content, prompts,
  workspace members
- Results grouped by type with type icons
- Fuzzy matching: "projct" finds "project"
- Instant results as you type (debounced 200ms)
- Keyboard navigation: arrow keys to select, Enter to open, Esc to close

### Scoped search

- Within a project: search documents and generations in that project
- Within asset library: filter by type, date, model used
- Within members: search by name or email

### Search results empty state

"No results for '{query}'" with:
- Spelling suggestions if a near-match exists
- "Search all workspaces" option if currently scoped to one
- "Create a new {type}" action if the search term could be a new item name

---

## 38. Keyboard Shortcuts

Every power user lives on the keyboard. Synora must be fully operable
without a mouse.

### Global shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` / `Ctrl+K` | Open command palette |
| `Cmd+/` / `Ctrl+/` | Show keyboard shortcut reference |
| `Cmd+B` / `Ctrl+B` | Toggle sidebar |
| `Cmd+N` / `Ctrl+N` | New generation (context-dependent) |
| `Cmd+P` / `Ctrl+P` | Search projects |
| `Esc` | Close current dialog / palette / drawer |

### Navigation shortcuts

| Shortcut | Action |
|---|---|
| `G then D` | Go to dashboard |
| `G then P` | Go to projects |
| `G then S` | Go to settings |
| `G then A` | Go to AI playground |

### Generation shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Enter` | Submit generation prompt |
| `Cmd+Shift+C` | Copy last generation result |
| `Cmd+Shift+R` | Regenerate last result |

### Implementation

- Shortcuts must not conflict with browser defaults or OS shortcuts
- All shortcuts must be discoverable via `Cmd+/` or the command palette
- Shortcuts must be disabled when a text input is focused (except
  Cmd+K, Esc, and Cmd+Enter)
- Modifier key display must adapt to OS: "Cmd" on macOS, "Ctrl" on
  Windows/Linux

---

## 39. Command Palette

The command palette is the fastest way to do anything in Synora. It is
inspired by VS Code's Cmd+P, Raycast, and Linear's Cmd+K.

### Behavior

- **Trigger:** Cmd+K (global, always available)
- **Appearance:** centered modal overlay with search input, no backdrop
  click-to-close (Esc only — prevents accidental dismissal)
- **Search:** fuzzy matching across all actions and navigation targets
- **Results:** grouped by category (Navigation, Actions, Recent)
- **Keyboard:** arrow keys to navigate, Enter to execute, Esc to close

### Action categories

| Category | Examples |
|---|---|
| Navigation | Go to Dashboard, Go to Projects, Go to Settings |
| Create | New Project, New Document, New Generation |
| Actions | Switch Workspace, Toggle Theme, Toggle Sidebar |
| Recent | Recently viewed projects, documents, generations |
| Search | Search projects, Search documents, Search members |

### Visual design

- Background: glass/blur over the current page
- Input: large, prominent, placeholder "Type a command or search..."
- Results: clean list with icon, label, and shortcut hint (right-aligned)
- Selected item: highlighted with accent background
- Category headers: muted, uppercase, small text

### Accessibility

- Focus is trapped inside the palette when open
- Focus returns to the trigger element when closed
- All items are in a listbox with proper ARIA roles
- Screen readers announce the selected item and result count

---

## 40. Future Marketplace

The marketplace is a Release 3+ feature for sharing and discovering
community-created assets.

### Vision

- **Prompt marketplace:** share and discover prompts for text, code,
  image, video, and audio generation. Prompts can be free or paid.
- **Template marketplace:** pre-built project templates (blog post
  pipeline, product launch kit, video series template).
- **Integration marketplace:** third-party integrations (Slack, Notion,
  Figma, Google Docs) that extend Synora's capabilities.

### Principles

- Quality over quantity. Curated, not a dumping ground.
- Creator attribution. Every shared asset credits its creator.
- Revenue sharing. Paid assets split revenue with creators.
- Safety. All shared content is reviewed for policy compliance.

---

## 41. Future Mobile App

A native mobile app is planned for Release 4+. It is NOT a wrapper around
the web app.

### Purpose

- Quick capture: voice-to-text generation on the go
- Review and approve: check generated content, approve team requests
- Notifications: push notifications for generation completion and team
  activity

### What it is NOT

- A full replacement for the desktop web experience
- A content creation environment (complex generation workflows stay on
  desktop/tablet)

### Technology decision

React Native or native (Swift/Kotlin) — deferred. The web app's API
client and type definitions are designed to be reusable regardless of
the mobile framework choice.

---

## 42. Future Desktop App

A native desktop app (Electron or Tauri) is considered for Release 4+.

### Purpose

- System-level keyboard shortcuts (global Cmd+Space to open Synora)
- Menu bar quick access for generation
- Offline draft mode with sync
- File system integration (drag files into Synora)
- Native notifications

### Decision

Deferred. The web app with PWA capabilities (service worker caching,
install prompt) may be sufficient. A native app is justified only if
there are interactions that the web platform cannot support.

---

## 43. Future Enterprise Version

Enterprise Synora is a Release 3 deliverable.

### Features

- **SSO/SAML/OIDC:** integrate with corporate identity providers
- **SCIM provisioning:** automatic user provisioning from corporate
  directory
- **Audit log export:** CSV/JSON export of all security events for
  compliance
- **Data residency:** choose where data is stored (EU, US, APAC)
- **Custom data retention:** configurable retention periods per workspace
- **Provider restrictions:** admin can whitelist/blacklist AI providers
  (for compliance — some enterprises can't send data to certain cloud
  providers)
- **IP allowlisting:** restrict access to corporate IP ranges
- **Custom branding:** workspace-level logo and color customization
- **Priority support:** SLA-backed support with dedicated account manager
- **Usage reporting:** detailed reports for procurement and finance

### Pricing

Custom pricing, annual contract. Not displayed on the public pricing
page. "Contact sales" CTA with a form.

---

## 44. Future Self-Hosted Version

Self-hosted Synora is a Release 3 deliverable.

### Target users

Organizations that cannot send data to external cloud providers due to
regulatory, security, or sovereignty requirements.

### Architecture

- Single `docker compose up` deploys the entire stack: frontend, backend,
  database, Redis, object storage (MinIO)
- All AI providers work, including Ollama for fully air-gapped
  deployments (no external AI API calls)
- Updates delivered as Docker image tags; `docker compose pull && docker
  compose up -d` to update
- License key validation (online check with grace period for air-gapped
  deployments)

### What self-hosted does NOT include

- Managed infrastructure (customer provides their own Docker host)
- Automatic backups (customer configures their own backup strategy)
- Multi-region deployment (single-node by default; scaling docs provided)

---

## 45. Success Metrics

### North star metric

**Weekly active creators** — users who generated at least one piece of
content (any modality) in the past 7 days.

### Acquisition metrics

| Metric | Target (first 6 months) |
|---|---|
| Marketing site → registration conversion | > 5% |
| Registration → first generation (same session) | > 60% |
| Registration → onboarding completion | > 80% |

### Activation metrics

| Metric | Target |
|---|---|
| Time to first generation | < 5 minutes |
| Users who generate in first session | > 70% |
| Users who create a project in first week | > 40% |

### Retention metrics

| Metric | Target |
|---|---|
| D1 retention (return next day) | > 30% |
| D7 retention (return within a week) | > 20% |
| D30 retention (return within a month) | > 15% |
| Monthly active users / registered users | > 25% |

### Revenue metrics

| Metric | Target |
|---|---|
| Free → Pro conversion (within 30 days) | > 5% |
| Pro → Team upsell | > 10% of Pro users |
| Monthly churn (Pro) | < 5% |
| Net Revenue Retention (Team) | > 110% |

### Product quality metrics

| Metric | Target |
|---|---|
| P95 API latency (CRUD) | < 200ms |
| P95 AI first token latency | < 2s |
| Error rate (5xx) | < 0.1% |
| Uptime | > 99.9% |
| Lighthouse performance score | > 90 |

---

## 46. Launch Checklist

Before public launch, all of the following must be true:

### Product

- [ ] Registration → onboarding → workspace → dashboard flow works
- [ ] Login → dashboard flow works
- [ ] Forgot/reset password works end-to-end
- [ ] Text generation works with at least 2 AI providers
- [ ] Code generation works with at least 2 AI providers
- [ ] Projects CRUD works
- [ ] Documents CRUD works
- [ ] Command palette navigates to all primary sections
- [ ] Keyboard shortcuts work for all documented shortcuts
- [ ] Sidebar collapses and expands
- [ ] Workspace switching works
- [ ] Theme switching (dark/light) works on all pages
- [ ] All empty states are designed and implemented
- [ ] All error states return helpful messages
- [ ] All loading states use skeletons (no blank pages)

### Quality

- [ ] All pages pass WCAG 2.1 AA contrast checks
- [ ] All pages render correctly at 320px width (minimum mobile)
- [ ] All pages render correctly at 2560px width (ultrawide desktop)
- [ ] All core flows work with keyboard only
- [ ] No console errors in production build
- [ ] Lighthouse performance > 90 on all pages
- [ ] E2E suite covers registration, login, generation, navigation

### Security

- [ ] Passwords hashed with Argon2id
- [ ] Refresh tokens hashed at rest, single-use, rotating
- [ ] Password reset tokens hashed at rest, single-use, ≤1h expiry
- [ ] No email enumeration on any auth endpoint
- [ ] Account lockout after failed attempts
- [ ] MFA available (optional, not required)
- [ ] CSRF protection on cookie-auth mutations
- [ ] Rate limiting on all API endpoints
- [ ] All secrets via SecretsManager (none in code or logs)
- [ ] CI security gates passing (audit, secret scan)

### Infrastructure

- [ ] CI pipeline green (test, security, docker)
- [ ] CD pipeline tested with rollback
- [ ] Monitoring and alerting configured
- [ ] Database backups verified with restore drill
- [ ] SSL/TLS configured on all endpoints
- [ ] Domain and DNS configured

### Legal

- [ ] Privacy policy published
- [ ] Terms of service published
- [ ] Cookie consent (if applicable)
- [ ] GDPR data export mechanism (if EU users)

---

## 47. Definition of Production

Synora is "in production" when a paying customer can:

1. Register an account and complete onboarding
2. Create a workspace and invite team members
3. Generate text, code, and at least one media type using AI
4. Organize generations into projects
5. Save and reuse prompts
6. Switch AI providers through settings without data loss
7. Manage their subscription and payment method
8. Access their workspace from desktop and mobile browsers
9. Trust that their data is secure, their sessions are protected, and
   their work won't disappear

The backend is production-ready today for a subset of this (items 1, 4,
6 partially). The full definition is met when Release 2 is complete.

---

## 48. Product Principles

These principles govern every product decision. When two good options
exist, the one that better serves these principles wins.

1. **Ship quality, not quantity.** One polished feature is worth more
   than three half-finished ones. Never ship a feature that needs a
   follow-up fix to be usable.

2. **Earn trust through transparency.** Show the user which model
   generated their content, how many tokens it cost, and where their
   data lives. Never hide behind "AI magic."

3. **Default to simplicity.** If a feature can work with zero
   configuration, it must. Settings are for preferences, not
   prerequisites. A new user should never see a settings page before
   they've created something.

4. **Design for the returning user.** First impressions matter, but the
   100th session matters more. Optimize workflows for the person who
   opens Synora every day, not the one who opens it once.

5. **Respect the user's time.** No unskippable tutorials. No
   confirmation dialogs for undoable actions. No loading states that
   could be eliminated with optimistic updates. Every extra click is a
   tax on the creator's attention.

6. **Provider-agnostic is a product feature, not a technical detail.**
   Users must feel the benefit of provider-agnosticism: they can try a
   new model with one click, compare results, and switch permanently
   without migrating anything.

7. **Collaboration is not an add-on.** It's the architecture. Workspaces,
   roles, and shared visibility are built into every feature from day
   one, not bolted on after the solo experience is finished.

8. **Accessibility is a constraint, not a checkbox.** We don't "add
   accessibility" — we design within accessibility constraints from the
   start.

9. **Performance is a feature.** A fast, responsive interface
   communicates quality. A slow one communicates carelessness. Performance
   targets are as non-negotiable as feature requirements.

10. **The product is the brand.** Inside the authenticated experience,
    the product's quality IS the brand. No marketing banners, no upgrade
    nags, no "follow us on Twitter" prompts. The workspace is the
    creator's space.

---

## 49. Things That Must Never Change

These are immutable product and design constraints. Violating any of
these requires explicit founder approval and a documented reason.

1. **Dark mode is the default theme.** Light mode is supported. Dark mode
   is first. This will never reverse.

2. **Provider-agnosticism is user-facing.** The user must always be able
   to see and change which AI provider is being used. This is never
   hidden "for simplicity."

3. **No vendor lock-in.** The user's projects, prompts, documents, and
   generated assets must be exportable in standard formats. Synora must
   never hold a user's data hostage to prevent cancellation.

4. **Command palette (Cmd+K) is always available.** Every authenticated
   page must support the command palette. It is the primary power-user
   navigation pattern and must never be disabled, gated, or removed.

5. **Keyboard shortcuts are first-class.** Every mouse action must have
   a keyboard equivalent. New features must ship with keyboard support.

6. **Free tier exists.** There will always be a free tier that lets
   users try the core generation capabilities without a credit card. The
   limits may change; the tier's existence must not.

7. **Design tokens are the only color system.** No hardcoded hex/rgb
   values in application code. Colors come from CSS custom properties.
   This is what makes theming possible and theme consistency enforceable.

8. **The design system is the only component source.** Pages do not
   create one-off styled elements. If a component doesn't exist in
   `@synora/design-system`, it is added there (with tests), not
   hand-rolled.

9. **No marketing in the product.** No upgrade banners on every page.
   No "you're on the free plan" persistent warnings. Upgrade prompts
   appear only at the point of limit contact, and they are helpful
   ("upgrade to create more projects"), not nagging.

10. **Generated content belongs to the user.** We never claim ownership
    of, train on, or share user-generated content. This is stated in
    the terms of service and enforced in the architecture.

11. **Error messages are human-readable.** No error codes without
    explanation. No "An error occurred." Every error tells the user what
    happened and what to do about it.

12. **Loading states are structural.** Skeletons, not spinners. The
    user must always know what shape the content will take before it
    arrives.

13. **Offline never crashes.** The app may be limited when offline, but
    it must never show a blank screen, throw an unhandled exception, or
    lose unsaved work due to a network interruption.

14. **Geist is the typeface.** Bundled via npm, loaded locally. No
    runtime font CDN requests. No font changes without a design system
    revision.

15. **The API envelope is stable.** `{ success, data, error, meta }` —
    this contract must not change in a way that breaks existing clients.
    Additions are fine; removals and reshapes are breaking changes.

---

*This document is Synora's permanent product bible. It governs every
feature, every screen, and every interaction. When in doubt about a
product decision, the answer is in this document. When this document
doesn't cover a case, the answer is the one most consistent with the
principles above. Append updates; never remove.*
