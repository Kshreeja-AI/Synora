# Synora — Current Capability Matrix

**Generated**: 2026-08-04
**Branch**: `claude/synora-ai-platform-h5q0k2`
**Verified at commit**: `d3656e1` + the workspace-activity increment
**Evidence basis**: 2,519 backend tests across 234 files and 601 frontend tests
across 90 files, passing against real PostgreSQL 16 and Redis; typecheck 8/8
packages; lint 0 errors; the CI migration-drift check run locally reports
"This is an empty migration", so the migration history still reproduces
`schema.prisma` exactly. One backend test —
`mfa/monitoring.service` "calculates metrics for time window" — fails in
the whole-suite run and passes in isolation (17/17). It is a known
cross-file counter bleed in the test setup, not a product defect, and it is
recorded here rather than reported as a clean sweep. Route mounts read
from `apps/backend/src/app.ts`. Pages enumerated from `apps/web/src/app`. Models
counted from `packages/database/prisma/schema.prisma` (111 models).

---

## How to read this document

Every capability below carries exactly one classification. The classifications are
deliberately unforgiving, because the failure mode this document exists to prevent
is **believing the platform can do something it cannot**.

| Class | Meaning | The test it must pass |
|---|---|---|
| **A** | Production-ready locally | A user can complete the whole task end-to-end today, on a laptop, with no paid credentials. Backend, API, UI and tests all exist and agree. |
| **B** | Implemented but incomplete | The path works, but a named part of it is missing or degraded. The gap is stated, not glossed. |
| **C** | Backend foundation only | Real, tested server-side logic exists. There is no HTTP route or no UI, so **no user can reach it**. |
| **D** | UI foundation only | Screens exist. The server-side behaviour behind them does not, or does not fully. |
| **E** | Credential/API dependent | The code is complete and tested. It cannot *activate* without an external key, service, or account. Marked "IMPLEMENTATION COMPLETE — ACTIVATION BLOCKED BY EXTERNAL DEPENDENCY". |
| **F** | Not implemented | No meaningful code exists. A database table, a TypeScript interface, or a placeholder screen **does not count** and is recorded as F. |
| **G** | Needs real-world validation | It works in tests. It has never met real users, real load, or real adversarial input, so its behaviour under those conditions is **unmeasured** — which is not the same as "fine". |

Three rules govern every entry:

1. **Absence is not a measurement.** Where something has not been measured, this
   document says *unmeasured*. It never says *zero*, *fine*, or *passing*.
2. **A schema is not a feature.** `Tool`, `Dataset`, and `ABExperiment` tables exist
   in Postgres. That fact alone earns nothing better than **F** for the capability
   they were meant to support, unless working code sits on top.
3. **Local determinism is never described as intelligence.** Several subsystems run
   on deterministic local executors so they can be built and tested without paid
   APIs. Those are labelled `local-deterministic` in code and **LOCAL** in this
   document. They are scaffolding for real models, not a substitute for them.

---

## Summary by class

| Class | Count | What it means for the founder |
|---|---:|---|
| A — production-ready locally | 16 | Usable today. |
| B — implemented but incomplete | 18 | Usable, with a stated hole. |
| C — backend foundation only | 1 | Built and tested, but unreachable by a user. |
| D — UI foundation only | 1 | Visible, but hollow behind. |
| E — activation blocked | 7 | Finished. Waiting on a key or an account, not on engineering. |
| F — not implemented | 8 | Does not exist. Named honestly rather than implied. |
| G — needs real-world validation | 5 | Works in tests; never met reality. |

Note that **G overlaps with A and B** rather than replacing them — a capability can
be production-ready locally *and* unvalidated against real users. Where that is the
case, both are recorded.

---

## Verified user journeys

Eight complete tasks, performed end to end over real HTTP against real
PostgreSQL, in `routes/__tests__/journeys.test.ts`. These exist separately
from per-route tests because a route test proves one endpoint behaves; it
cannot prove the *sequence* a person performs works, and the interesting
failures live in the seams between calls.

| Journey | What it proves |
|---|---|
| Blank workspace → template → dry run → real run → history → ledger | The whole first-use path, including that the run is billed to the same ledger everything else uses. |
| Dry run catches a broken workflow | A dangling `{{step}}` reference is reported before anything executes, and no run is created by looking. |
| Wire an outside system, then turn it off | A webhook with no session starts a real run as the trigger's creator; disabling makes the same URL answer 404. |
| Upload a file, watch a workflow start | An event trigger created over HTTP, then a real multipart upload through the real endpoint, produces a real run — and does not when the trigger is paused, when a filter excludes the file, or when the upload was to another workspace. |
| Install a plugin, use its template, uninstall | A contributed template becomes a real agent — and uninstalling removes the template but **not** the agent someone already made. |
| Review a plugin's tools, install, disable, uninstall | The destination host is on screen before an install button exists; the contributed tool then appears in the ordinary tools list; disabling switches it off rather than hiding it; uninstalling takes it away entirely — the opposite of the template rule, and for a stated reason. |
| Arrange a canvas, connect, delete | A block's lines go with it rather than dangling. |
| An agent pauses, a human declines | Fail-closed approval parks the run; declining ends it as `cancelled` (a human saying no is not a failure) with the reason on the record. |
| A workspace out of credits | Refused before spending; the free dry run still works, which is the point of gating at the start rather than everywhere. |
| Cross-workspace isolation | 404 not 403 at every surface, and the other workspace's lists are simply empty. |

**Found by writing these**: `start` and `approve` wrap their result as
`{ run, … }` because they carry a runtime notice; `reject` and `cancel`
return the run directly. Both sides of the wire agree — the web client
types them the same way — so this is a non-uniformity to know about when
integrating, not a live defect, and it is recorded rather than silently
changed.

**Not covered**: there is no browser-level E2E suite (no Playwright), so
these prove the API sequence rather than the rendered UI. Frontend
behaviour is covered by component and page tests instead.

---

## Family A — AI Workspace (conversations, messages, streaming)

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Conversation CRUD, folders, tags | **A** | `conversations.ts`, `conversationFolders.ts` routes mounted; `/conversations` and `/conversations/[id]` pages; folder tree wired to the real folder API. |
| Message send / edit / pin / attachments | **A** | `messages.ts` mounted; `MessageBubble` carries attachment, edit and pin affordances against real endpoints. |
| Message branching (alternative paths) | **A** | `branches.ts` + `MessageBranch` model; frontend rewritten onto the real tree API rather than a local mock. |
| Token streaming (SSE) | **B** | `streaming.ts` and `streaming.service.ts` are mounted and tested. **Limit**: end-to-end token latency has never been measured against a real provider — it is *unmeasured*, not "sub-100ms". |
| Conversation sharing via invite token | **A** | `sharing.ts` + `sharing-public.ts`; the public path is deliberately separated so the unauthenticated route cannot inherit authenticated helpers. `/share/[token]` page exists. |
| Export / import of conversations | **A** | `export-import.ts` streams real downloads through a privacy filter. |
| Real model responses | **E** | The provider abstraction covers 10 providers and is fully tested. **ACTIVATION BLOCKED BY EXTERNAL DEPENDENCY**: no provider credential is configured, so every response today comes from the local deterministic runtime. |

## Family B — Agent Platform

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Agent definitions (versioned, workspace-scoped) | **B** | `agents/agent-registry.ts` + `routes/agents.ts`, reachable at `/api/workspaces/:id/agents`. Editing creates version+1 with `previousVersionId`; old versions stay resolvable because runs reference them. Create and archive are reachable from `/agents`. **Limit**: editing (creating the next version) is API-only — no screen calls it. |
| Runs surviving a real (slow) provider | **F** | **Latent defect, invisible today.** A run executes *synchronously inside the HTTP request* (`await startRun(...)`), but a run's default wall-clock budget is **5 minutes** while the default HTTP request timeout is **30 seconds** — a run is permitted to take ten times longer than the request carrying it. The timeout handler sends a 408 and does **not** abort the work, so the run keeps executing, spends real budget, is metered and recorded in history — while the caller receives an error and never learns the run id, because the id existed only in the discarded response. This cannot happen today because the local deterministic runtime returns instantly, and **no test can catch it** because the timeout middleware is disabled entirely when `NODE_ENV=test`. It becomes real the moment a model provider is connected. The fix is asynchronous runs (start returns immediately with a `running` state; execution continues; the client polls or streams), which changes the `POST /runs` contract and is therefore a founder decision, not a silent refactor. **This is also why live run progress cannot be built first** — there is nothing to observe while the run is the request. |
| Agent run engine (plan → steps → approval → terminal state) | **B** | `agents/run-engine.ts`, 28 engine tests + 14 route tests. Enforces step budgets, tool-call budgets, deadlines, forward-only dependencies, and refuses a whole run that names a forbidden tool. Start, approve, reject and cancel are reachable over HTTP and from the `/agents` screen. **Limit**: a run's progress is not streamed — the page shows the state the request returned, so a long run must be reopened to see movement. |
| Agent durability across restart | **B** | `agents/agent-stores.ts` + `hydrateAgents`/`hydrateRuns`, 11 tests. A run whose definition did not restore is refused and counted, never silently loaded. Interrupted runs restore as `failed`; parked runs stay `awaiting_approval`. Attached at boot via `AGENT_STORE_DIR` and awaited before traffic. **Limit**: with the variable unset the stores are in-memory, which the server logs plainly rather than implying durability. |
| Agent runtime honesty label (LOCAL vs REAL) | **A** | `agents/runtime.ts`, 4 tests. Every run response carries the mode, a plain-language notice, and the plan's `origin`; a configured provider that fails at call time does not silently degrade to the local planner. |
| Agent tool execution inheriting caller permissions | **B** | `agents/tool-runner-adapter.ts` routes through `toolService.executeTool` with the requester's identity, and the runtime binds a fresh runner per request so no run inherits another user's authority. **Limit**: exercised in tests against the tool layer, never against a real registered tool end-to-end. |
| Agent planning from natural language | **E** | `agents/model-planner.ts` parses and strictly validates model-produced plans, refusing rather than coercing malformed output. **ACTIVATION BLOCKED**: requires a model endpoint; `OLLAMA_BASE_URL` is unset, so the model planner is unwired. |
| Deterministic local planner | **A (LOCAL)** | `agents/local-runtime.ts`. Stamped `origin: 'local-deterministic'` in the plan record so no consumer can mistake it for model output. This is orchestration scaffolding, **not intelligence**. |
| Agent UI / testing console / run history view | **A** | `/agents` page plus `CreateAgentDialog`, `RunDetail` and `RuntimeNotice`, 8 tests. Define an agent, give it a task, watch every step, approve or reject what it pauses on, stop it mid-run, and read the full log. The LOCAL/REAL label is rendered on every run, and the fail-closed defaults are shown as they actually are ("no tools", "asks before changes") rather than softened. |
| Agent editing UI (create new version from the screen) | **A** | `EditAgentDialog`, 2 tests. States before you press save that it creates version N+1 and keeps version N — because a user who thinks they edited in place will be confused later by a run history pointing at "old" configurations. The page switches to the new version's id on save. |
| Agent memory integration | **B** | `agents/memory.ts`, 16 tests. Opt-in per direction and fail-closed: an agent that does not declare `recall` reads nothing, one that does not declare `record` writes nothing. Recall runs as the requesting user, so an agent cannot surface a memory that person could not read. Written memories carry the plan's origin **in their text**, so a deterministic run can never be recalled later as though a model produced it. Only successful runs are recorded. Memory access is set from the agent create and edit screens, and shown in the agent summary only when granted. **Limit**: recall quality is UNMEASURED — with no embedding provider, retrieval falls back to keyword search. |

| Agent & workflow templates (built-in, plugin-contributed, workspace-authored) | **A** | `agents/templates.ts`, `agents/workspace-templates.ts` + `routes/templates.ts` + `TemplateGallery`, 8 catalogue tests + 15 route tests + 8 component/page tests. **Three sources in one list**: shipped with the platform, contributed by a plugin, and saved from something that already works in this workspace ("Save as template" on `/agents`). A workspace template MAY carry real tool ids — it never leaves the workspace where they mean something — but they are **re-checked when it is used**: what survives is granted, what was deleted since is **reported as `droppedTools`**, never granted dead and never dropped in silence. It records no link back to the agent it came from, because a snapshot is not a live view. Seven starting configurations across writing, research, analysis, operations and code, each written for this platform and each stated by the **user outcome** it serves. Instantiating produces an ordinary agent or workflow through the normal registry — same validation, same immutable versioning, same fail-closed defaults — and a route test proves an instantiated workflow actually runs. **A template can never name a tool id**: ids are per-workspace rows, so a template naming one would create a ready-looking definition pointing at a tool that may not exist there. What ships instead is generate-only, with tools listed as plain-language suggestions the UI presents as things to connect, never as already connected. Reachable from the `/agents` and `/workflows` empty states. **Limit**: none of the three sources can be edited in place — a template is a snapshot, and changing one means saving a new one. |

## Family C — Workflow Automation

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Workflow engine (authored steps, executed exactly) | **B** | `workflows/` + `routes/workflows.ts` + `/workflows` page, 20 engine tests + 10 route tests + 8 page tests. A workflow is a human-authored sequence, versioned immutably like agents, run through the *same* engine — so approval gates, tool permissions, retry and tool-call budgets, deadlines and cancellation are inherited rather than reimplemented. Plans are stamped `origin: 'authored'`, distinct from both `model` and `local-deterministic`. A workflow can be started four ways: by a person, by a schedule, by an outside system through a webhook, and by something happening inside Synora (see Event-triggered automation below). **Limit**: it runs synchronously inside the HTTP request — see class F, the run-timeout mismatch. |
| Workflow authoring-time validation | **A** | A sequence that could never run is refused with a 400 when saved, naming the offending step — rather than accepted and failed on first use. Re-validated on edit (narrowing tool permissions can invalidate saved steps) and again on load from disk. |
| Workflow durability | **B** | Definitions persist via the same `KeyedStore` and hydrate at boot; the run store's orphan check knows about workflows as well as agents, so workflow runs are not destroyed on restart. **Limit**: shares the `AGENT_STORE_DIR` gate — unset means in-memory, which the server logs. |
| Workflow UI / builder | **A** | `/workflows` page plus `StepBuilder`, 10 tests. Steps can be edited, which creates version N+1 and says so before the save button. Add, reorder and remove steps; ids renumber to stay sequential so the run record reads cleanly. Run inspection reuses `RunDetail` unchanged, because a workflow run *is* an engine run. The page states that the run note does not change what executes — the opposite of the agent page, and the difference a user must not get wrong. |
| Workflow dry runs | **A** | `workflows/dry-run.ts`, 14 unit tests + 3 route tests. Executes nothing — no tool is called, no model is asked, no run record exists — and reports only what is knowable in advance: an authoring-time re-validation, per-step tool existence/active/supported-type/schema checks against the real tool layer, `{{stepId}}` references with no earlier producer, tool-level approval (which fails a step rather than pausing it, since the engine never waits on a human timescale), the requester's own `tool:execute` permission, projected tool-call usage against the workflow's budget, and which steps would pause under the approval policy — using the *same* `stepNeedsApproval`/`validatePlan` predicates the engine itself obeys, so the preview cannot silently drift from execution. An exhausted budget is reported as a blocker rather than refusing the (free) dry run itself. Every report also states its own blind spots (a generate step's output, a remote endpoint's actual response) rather than hiding them. Reachable from `/workflows` via a "Dry run" button next to Run. |
| Scheduled automation | **B** | `workflows/schedule.ts` + `scheduler-runner.ts` + routes, 16 scheduler tests + 5 route tests. Interval and daily-at-UTC-time schedules, strictly validated (anything else refused, not guessed). Durable; a schedule that came due during an outage is moved forward and its missed occurrences **counted, never replayed** — a backlog fired in a burst is how a scheduler turns an outage into an incident. A scheduled run executes as the person who created the schedule, never with ambient authority — pinned by a test on the actual firing path. The `/workflows` page adds, pauses and removes schedules, and renders missed occurrences as a warning, because a schedule silently not running looks identical to one running fine. A daily schedule runs at its chosen local time in a named IANA zone and **keeps that local time across DST** — the next fire is computed by walking calendar days in the zone, not by adding 24 hours, so a 23- or 25-hour local day does not drift it. An unknown zone is refused by name rather than falling back to UTC, because a typo that silently became UTC would fire at the wrong hour forever with nothing to see. Zone-less schedules keep meaning UTC exactly as before. Both DST directions are pinned by tests against real 2026 transitions. **Limit**: resolution is the 30s tick, so "daily at 09:00" means at or shortly after — stated on the page. |
| Event-triggered automation (webhooks) | **A** | `workflows/trigger.ts` + `routes/workflowHooks.ts` + `TriggerPanel`, 13 unit tests + 8 route tests + 7 component tests. A POST to `/api/hooks/workflows/:secret` starts a real run from outside Synora — no session, because the URL secret **is** the authorization, the same pattern as the existing `/api/shared/:shareToken` route. Only the SHA-256 hash of the secret is stored, as with API keys, because a trigger can spend real budget against real tools. The run executes **as the trigger's creator**, never with ambient authority — the identical rule the scheduler applies to a clock-started run. A disabled or deleted trigger answers exactly like one that never existed, so pausing does not leak state to whoever holds an old secret. Budget-gated and metered like every other run. |
| Event-triggered automation (internal events) | **A** | `workflows/event-trigger.ts` + `event-dispatch.ts` + `triggered-run.ts` + `TriggerPanel`, 20 unit tests + 6 route tests + 8 component tests. A workflow starts because something happened **inside** Synora: today `asset.uploaded` and `project.created`, each emitted from the real call site where the thing genuinely happens. **The catalogue is closed and validated** — a trigger for an event nobody emits is refused by name at creation and discarded at hydration, because one that was accepted would sit "enabled" forever while never firing, which is indistinguishable from a broken workflow. A route test proves the whole path: uploading a real file through the real endpoint produces a real run. **Emitting never fails the action that caused it** — dispatch is off the request path and every failure is logged, since somebody uploading a file did not ask to run an automation. Optional filters (project, mime-type prefix) require *every* condition. Authority is the trigger's creator, never the actor whose action emitted the event: uploading to a shared workspace is not lending your permissions to whatever another member wired up. **A per-trigger burst limit** (20/minute, counted and shown) bounds the blast radius of a careless wiring — dragging in 400 files must not start 400 billed runs. Both trigger kinds share one run-starter, so they cannot drift apart on budget, authority or billing. **Limits, stated**: no `workflow.completed` event — it makes loops possible, and bounding that needs causation tracking through the run engine that does not exist, so shipping it would mean calling "rate-limited" the same as "cannot happen"; and events occurring while the process is down are missed rather than replayed, because there is no durable event log. |

## Family D — Canvas

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Canvas / spatial workspace | **B** | `canvas/` + `routes/canvas.ts` + `/canvas` page, 32 store tests + 11 route tests + 25 page tests. Text, note and link blocks positioned on a bounded surface; create, rename, archive; add, edit, move and remove blocks; durable across restart. Link blocks store **ids only**, resolved on read, so a canvas cannot become a stale copy of what it points at. Blocks are deliberately **mutable** — unlike agents and workflows, nothing references a canvas as a record of the past. **Limit**: multi-select covers movement only — several blocks cannot yet be deleted or connected in one action. |
| Canvas block movement (drag and keyboard) | **A** | Drag by a handle — not the block body, so selecting a word in a text block does not fling it across the surface — with the pointer delta divided by the current zoom and the result snapped to the 20px grid on release. **One server call per drag, on release**, not one per pixel: intermediate writes could fail or land out of order and settle the block where the slowest response said rather than where the person let go. The whole gesture is **one** undo entry, labelled exactly as a nudge is. Under three pixels of travel writes nothing, so a mis-click cannot fill the history. The arrow-key nudge buttons **stay permanently** — a drag is unreachable without a pointer, and an accessible path that lasts only until the pleasant one ships was never one. **Several blocks move together**: ticking a checkbox selects, and dragging or nudging any selected block carries the whole selection with **one shared offset snapped from the grabbed block**, so a deliberate arrangement is not deformed by pulling each block onto its own grid point. Grabbing an *unselected* block still moves only that one — having a selection must not make every other block unmovable, nor drag along a selection set up for something else. The whole group move is **one** undo entry restoring each block to where it actually was (not a shared offset undone, which would misplace the survivors if one write had been refused). Selection is by an explicit labelled checkbox rather than by clicking the block, because a block body is an editable text field and a modifier-click convention is invisible until someone tells you. |
| Canvas viewport (zoom, pan, reset) | **A** | Zoom 40–200% with the level shown, four-direction pan, and one reset for both. Lines and blocks share a single transformed layer, so a connection cannot drift away from the blocks it joins. Buttons with labels rather than wheel/space-drag gestures — keyboard-reachable by default, and discoverable rather than hidden. |
| Canvas undo | **A** | A bounded stack of inverse operations covering add, delete, move, connect and disconnect, with the button naming what it will reverse rather than saying only "Undo". **Undoing a delete restores the block AND the lines that touched it**, re-pointed at the new id — the connections are captured before the request, because the server deletes them with the block and they are unrecoverable after. The new id is not a compromise: nothing outside a canvas references a block id, so the restored state is functionally the one that existed. **Limit, stated on the page**: undo is structural, not textual — typing has the browser's own undo inside the text box, and an entry per keystroke would bury the changes people want back. |
| Canvas connections between blocks | **A** | Directed lines with optional labels, drawn as SVG behind the blocks and listed with a delete control. Cycles are **allowed** — the workflow rule against them exists because steps execute in an order, and a canvas has no execution order, so enforcing it here would copy a constraint past its reason. What *is* enforced: no self-connection, no duplicate in the same direction (the reverse is a separate statement), both endpoints must exist on **this** canvas, and a bounded count. Deleting a block deletes every line touching it, and hydration re-checks the same invariant, so a line from nothing to nothing cannot survive a restart either. |
| Canvas link resolution (showing what a link block points at) | **A** | `canvas/link-resolver.ts` + `GET /canvases/:id/links`, 5 route tests + 3 page tests. A link block resolves to the target's **real current name** plus a useful second line (a run's state, a workflow's step count, a conversation's last-message date). The title is **read now, never stored**: copying it when the link was made would turn a canvas into a museum of names things used to have, with nothing to indicate it is lying. **Every lookup is workspace-scoped** — a block holds a bare id, and nothing stops someone typing one belonging to another workspace, so without scoping a link block would be a way to read other people's conversation titles one id at a time. An unresolvable target reports `missing` **with no reason**: deleted, archived, never existed and belongs-to-someone-else all read alike, the same 404-not-403 discipline the routes use. Resolution is a **separate call** from the canvas, so a canvas with no links does not pay for the feature and a canvas whose targets are gone still opens. |

## Family E — Knowledge & File Intelligence

| Capability | Class | Evidence and honest limits |
|---|---|---|
| File upload + processing pipeline | **A** | `files.ts`, `FileProcessingJob` model, end-to-end download path. |
| Workspace-level file browser | **A** | `/knowledge/files`, 6 tests. `workspaces/:id/assets` has been storable and listable since M5; the only surface that ever showed it was the project detail page, so a file not attached to a project was reachable by the server and invisible to a person. Files already filed under a project are marked "in a project" rather than presented as loose. This is a navigation fix, not a new capability — nothing new is stored. |
| Virus scanning | **E** | Real ClamAV provider abstraction with a **three-state** result (clean / infected / **unscanned**) and fail-closed policy. **ACTIVATION BLOCKED**: no ClamAV daemon configured. The third state exists precisely so an unscanned file is never reported as clean. |
| Memory system (store, rank, dedupe, summarise, GDPR erase) | **A** | Nine memory services, `memories.ts` mounted, `/knowledge/memories` page. |
| Semantic search over memory | **E** | pgvector store and embedding provider adapters are implemented and tested. **ACTIVATION BLOCKED**: no embedding credential. Semantic search is *gated off* rather than faked; the system falls back to real Postgres full-text search and says so. |
| Full-text search | **A** | `search.ts`, `search.service.ts`, `/search` page, `SearchIndex`/`SearchQuery` models. |
| Prompt & conversation templates | **A** | `promptTemplates.ts`, `conversationTemplates.ts`, `/knowledge/prompts`, `/knowledge/templates`. |

## Family F — Research Workspace

| Capability | Class | Evidence |
|---|---|---|
| Research workspace (multi-source gathering, citation, synthesis) | **F** | Does not exist as a distinct capability. Search and memory exist separately; nothing composes them into a research surface. |
| Project as a place work lives (goal, gathered work, activity, resume) | **B** | `projectWorkspace.service.ts` + `GET /projects/:id/workspace` + `ProjectWorkspacePanel`, 6 route tests + 9 component tests. **The gap this closed**: a Project could hold files, folders and generated media and *nothing else* — the conversations where the thinking happened lived somewhere else entirely, so opening a project told you what had been produced but never how, why, or what was unfinished. People kept that in their heads and re-explained it to the AI on every return. A conversation can now be **filed into a project** (`PATCH conversation { projectId }`; explicit `null` takes it out), and one read returns the project's whole picture: a **goal** (what "done" looks like, in their words — offered, never required), counts by kind, a single **chronology** across conversations/files/documents/media, and `resumeConversationId` — the "continue where you left off" answer, named once so every surface agrees what continuing means. **The timeline is assembled, never stored**: every item already carries a timestamp, so it is a sort rather than a second source of truth that could drift from the things it describes. **It passes no judgement**: "last activity 3 days ago" is a fact the person interprets; "this project is stalled" would be the platform deciding something about their work it has no standing to decide, and would be wrong exactly during a deliberate pause. Filing is enforced same-workspace with a **404, not a 403**, so the accept/reject answer cannot be used to discover which project ids exist elsewhere. Deleting a project **SetNull**s its conversations rather than cascading — losing the grouping must never destroy the work. Filing is reachable from the conversation page itself — a select that **states where the conversation currently sits and changes it in one control**, which is also what makes "take it out again" discoverable rather than hidden behind a different affordance. It sends an **explicit null** to unfile, never an omitted field, or choosing "No project" would appear to do nothing; and it disappears entirely when the workspace has no projects, because an empty dropdown invites a click that leads nowhere. **Canvases are gathered too**: a canvas is where the spatial half of thinking happens, so a project holding the conversations but not the arrangement would still be missing part of the work. Canvases live in a file-backed store rather than the database, so they are read separately and merged into the same chronology — which is precisely why that chronology is assembled rather than stored. Filing a canvas is checked in the ROUTE, not the canvas store, which deliberately knows nothing about projects; renaming a canvas leaves its project alone, because an omitted field means "leave it" and otherwise every rename would evict it. **Limit**: agents, workflows and runs still cannot be filed into a project. |
| Turn a conversation into a project | **A** | `promoteConversationToProject` + `POST /conversations/:id/project` + the same control, 3 route tests + 3 component tests. **Work does not start as a project** — it starts as a question, and somewhere in the middle a person realises the thing is bigger than the thread they are doing it in. Recording that took six steps: stop, leave, create a project, come back, file the conversation. It is now one, and the cost of those six steps was paid exactly when someone's attention was most valuable. **One interactive transaction**, because creating the project and filing the conversation are halves of one intention — a half-completed promotion would leave an empty project nobody asked for beside a conversation still outside it, which is worse than failing cleanly. The name **defaults to the conversation's title** rather than opening a dialog: the conversation already has a name the person chose, and a dialog would ask a question whose answer is known. Promoting is refused for a conversation already in a project (a second press would strand the first), and it **respects `project:create`** — a VIEWER who cannot create a project directly cannot create one this way either. When a workspace has no projects at all, this is the *only* offer shown, because an empty dropdown is not a useful thing to hand someone. |

## Family G — Content Creation (media)

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Image generation | **E** | Real provider abstraction, OpenAI adapter, stores actual bytes, returns an honest 503 when no provider is configured rather than a placeholder image. **ACTIVATION BLOCKED**: no credential. |
| Video generation | **E** | Async job abstraction, provider registry, polling API. **ACTIVATION BLOCKED**: no credential. |
| Audio / text-to-speech | **E** | `audio.ts`, `audioGeneration.service.ts`. **ACTIVATION BLOCKED**: no credential. |
| Media Studio UI | **A** | `/studio` page with image, video and audio tabs; tab state lives in the URL so a studio is linkable. The UI correctly surfaces the 503 rather than pretending. |
| Document editing | **B** | `documents.ts` and the `Document` model exist and are tested. **Limit**: there is no rich document editing surface in the web app. |

## Family H — Personal AI Automation

| Capability | Class | Evidence |
|---|---|---|
| Personal assistant / proactive automation | **F** | Does not exist. |

## Family I — Multi-Agent Orchestration

| Capability | Class | Evidence |
|---|---|---|
| Multiple agents cooperating on one goal | **F** | Does not exist. Single-agent run execution exists (Family B, class C) and is the prerequisite. |
| Goal-to-execution decomposition | **F** | Does not exist. |
| Long-running project execution | **F** | Does not exist. Run deadlines currently cap a run at 5 minutes by default. |

## Family J — Plugins & Integrations

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Tool definitions + execution + audit trail | **A** | `tools.ts` mounted, `tool-engine.service.ts`, `ToolDefinition`/`ToolExecution`/`ToolAuditLog` models, `/dashboard/tools` page with a real executor and execution history. |
| Tool secrets (encrypted, audited) | **A** | `toolSecrets.ts`, `toolSecret.service.ts`, `ToolSecretAuditLog`. |
| Third-party integration catalogue | **F** | No catalogue, no OAuth connection flow, no per-integration adapters. |
| Plugin system — declarative packages (manifest / permissions / lifecycle) | **A** | `plugins/` + `routes/plugins.ts` + `/plugins` page, 22 registry tests + 16 route tests + 11 page tests. A plugin is a manifest describing what it contributes and what it needs. Validation refuses what it does not fully understand — an unrecognised permission is rejected by name rather than quietly dropped, because a silently narrowed grant produces a plugin that half-works for reasons nobody can see. The grant is exactly what was declared, frozen at install; a disabled plugin holds none of it, checked at every use rather than assumed from the record. Contributed templates are validated at INSTALL time with the engine's own `validatePlan`, so a template that could never run is refused before anyone tries it, and they appear in and disappear from the workspace's template list the moment the plugin is enabled or disabled. Uninstall removes the stored record too, so a plugin cannot return after a restart carrying permissions nobody re-granted. |
| Plugin tool contributions (HTTP/Webhook tools a plugin adds) | **A** | `plugins/tool-contributions.ts` + `POST /plugins/preview` + the review step on `/plugins`. A contributed tool becomes a **real `ToolDefinition` row**, so it runs through the same engine, SSRF policy, rate limits, approval flow and execution records as a hand-written one — not a parallel list that renders but cannot run (an execution record points at a tool row by foreign key, so a virtual tool could never actually execute). **This is not code execution**: the plugin supplies a description of a request and Synora's own engine makes it; nothing from the plugin is loaded or called. Only HTTP and Webhook are accepted, because they are the only types the engine executes — a Database or Python contribution is refused rather than installed unrunnable. **A contributed tool may not name a workspace secret**, though a tool you write yourself may: `{{secret:…}}` anywhere in the config is refused, because a manifest declaring `Authorization: {{secret:…}}` against the publisher's own host would exfiltrate the credential on first execution while the install screen said only "contributes 1 tool". Approval is forced on and **the publisher gets no say** — a workspace admin can lower it afterwards, locally and audited. **Consent is asked, not announced**: the manifest is previewed first and the destination hosts named before an install button exists, and editing the text invalidates the review. **Uninstalling removes the tools** (deactivates — executions point at the row and history must survive), unlike templates which are left with whoever built from them: a template is inert, a tool reaches a third-party host every run, so withdrawal has to actually withdraw. Disabling does the same, or the switch would be decorative where it matters most. Provenance is the `ToolDefinition.pluginId` **column**, not a naming convention, so a rename cannot strip a tool of its origin and leave it behind after uninstall. A name already taken is **reported as skipped**, never overwritten. |
| Plugin code execution (running third-party code) | **F** | **Deliberately refused, not merely absent.** A manifest declaring an entry point is rejected with an explanation, and `code:execute`/`network:outbound` are declared-but-ungrantable so asking for one gets a specific answer. Running untrusted code safely needs a real isolate — separate process, VM or WASM with resource limits and a syscall policy — and calling an in-process function call a "sandbox" would claim a protection that does not exist. That is a **launch blocker for any third-party plugin ecosystem**, and it is engineering work, not a credential. |

## Family K — Marketplace

| Capability | Class | Evidence |
|---|---|---|
| Marketplace (publish, discover, install) | **F** | Zero matches across the repository. |

## Family L — Team & Enterprise

| Capability | Class | Evidence |
|---|---|---|
| Workspaces, members, roles | **A** | `workspaces.ts`, `permissions.ts` enforcing server-side, `/dashboard/settings/workspace`. |
| Invitations | **A** | `invitations.ts`, mail template, `/invite/[token]` page. |
| Audit logging | **A** | `audit.service.ts`, `AuditLog`/`ActivityLog` models, `/admin/audit-logs` page. |
| Admin console (users, workspaces, engineering) | **A** | `admin.ts`, four admin pages. |
| API keys / developer portal | **A** | `apiKeys.ts`, `/developer` page. The raw secret is shown exactly once and discarded from local state on modal close. |
| SSO / SCIM / directory sync | **F** | Does not exist. |
| Public SDK | **F** | Does not exist. API keys exist; no published client library does. |

## Family M — Billing & Usage

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Plans, subscriptions, invoices, refunds, payment methods | **B** | Five services and four routes, all tested, `/dashboard/billing` and `/dashboard/settings/billing` pages. **Limit**: no real payment processor is connected, so no money has ever moved through this code. |
| Credits + usage ledger | **A** | `credit.service.ts`, `usage.ts`, real aggregation, `/dashboard/usage` page. |
| Agent/workflow run metering | **A** | `agents/metering.ts`, 15 tests, wired into every terminal transition (start, approve, reject, scheduler). Usage is always counted even when deduction cannot happen — the record then says `deducted: false` and why. Deterministic generate-steps cost zero (no tokens were bought; charging would fabricate a cost); tool calls are charged regardless of plan origin. |
| Pre-run budget enforcement | **A** | `assertRunBudget` in `agents/metering.ts`, checked at both run-start routes and in the scheduler. A workspace with no credits account runs freely (every local workspace); a workspace that has opted into billing is refused at zero balance **before** anything executes, with an end-to-end route test proving no run is created. A run already in flight is never killed by the budget. |
| Webhook handling with replay protection | **A** | `billingWebhook.ts`, `ProcessedWebhookEvent` model, dedup race condition fixed. |
| Live payment processing | **E** | **ACTIVATION BLOCKED**: requires a production payment account — a founder/business decision, not an engineering one. |

## Family N — Observability & Evaluation (the EOS)

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Evidence collectors (health, boot, latency, memory, queue depth, API, cost, error rate) | **A** | Roughly 40 modules under `src/eos/`, each tested. |
| Launch gates with measured thresholds | **B** | `launch-gates.ts` with a durable gate store. **Limit**: **3 of 10 gates are currently unmeasured**, because they depend on a model judge that has no endpoint. Unmeasured is reported as unmeasured — never as passing. |
| Benchmark import with holdout protection | **A** | `benchmark-importer.ts`: content-hash reproducibility, deterministic holdout split, and a fix for a registry/dataset deadlock that was found by probing rather than assumed. |
| Regression + adversarial suites kept separate | **A** | `regression-suite.ts`; benchmark, regression, adversarial and synthetic suites are distinct so a benchmark cannot be overfitted by reusing its own data. |
| Model-based quality judging | **E** | `model-judge.ts` parses scores strictly, refusing prose and out-of-range values instead of coercing them. **ACTIVATION BLOCKED**: `OLLAMA_BASE_URL` unset. This is the direct cause of the 3 unmeasured gates above. |
| Egress redaction on derived paths | **A** | `redaction.ts` handles percent-encoded evasion, including a deliberately malformed `%` that defeats whole-string decoding. `egress-registry.ts` documents why *directed* paths (downloads, share links, emails) are deliberately **not** redacted — redaction is the wrong control there. |
| Observability UX (a screen a human reads) | **D** | `/admin/engineering` exists. **Limit**: it surfaces a fraction of what the EOS actually measures. |

## Family O — Security

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Auth: JWT + rotating refresh tokens, device metadata, session list, logout-all | **A** | `auth.ts`, `token.service.ts`, `/dashboard/settings/sessions`. |
| Password reset + email verification | **A** | Both services transactional. |
| Account lockout | **A** | `lockout.service.ts`. |
| CSRF protection | **A** | Middleware + tested frontend hook. |
| MFA | **C** | `services/mfa/`, six MFA models, `mfa.ts` route exists. **Limit**: there is no enrolment UI, so no user can turn it on. |
| Privacy consent + GDPR erase | **A** | `privacyConsent.ts`, `memoryGdpr.service.ts`. |
| Client IP handling | **B** | `requestLogger.ts` redacts URL and user-agent but writes client IP **as received**. This is a deliberate, test-pinned policy choice, not an oversight. Pseudonymising it is classified **CONDITIONAL** under the Engineering Constitution and therefore **awaits founder sign-off**. |
| Penetration testing / external security review | **G** | Never performed. Behaviour under adversarial real-world traffic is **unmeasured**. |

## Family P — Offline & Local-First

| Capability | Class | Evidence |
|---|---|---|
| Offline mode | **F** | Does not exist. |
| Client-side sync / conflict resolution | **F** | Does not exist. |
| Mobile app | **F** | Does not exist. |
| Desktop app | **F** | Does not exist. |

---

## Class G — what works in tests but has never met reality

These are recorded separately because they are the entries most likely to be
mistaken for "done". Each of them passes its tests. None of them has evidence about
its behaviour outside the test suite.

1. **Streaming latency under real network conditions** — measured never; the SSE
   path has only been exercised locally against deterministic output.
2. **Database behaviour under concurrent load** — connection pool tuning exists, but
   no load test has been run. Query performance at scale is unmeasured.
3. **Security posture against real attackers** — no external review, no penetration
   test.
4. **Cost behaviour under real usage** — the cost monitor is implemented; no real
   spend has ever passed through it.
5. **An intermittent test flake** — roughly one failure per four full-suite runs, in
   a different file each time, passing on re-run. **Undiagnosed.** It is recorded
   here rather than dismissed, because an unexplained flake is a defect whose cost
   is not yet known.

---

## What this matrix changes about the plan

The declared priority order begins: agent persistence, agent HTTP routes, agent UI,
agent testing interface, agent execution history, agent memory. The matrix confirms
that ordering is right for a reason worth stating plainly:

**The agent platform was the single largest gap between "engineering foundation" and
"user product," and it is now closed end to end.** Three substantial, fully tested
subsystems (registry, run engine, durability) sat at class **C** — real, correct, and
unreachable by any human being, because no HTTP route exposed them. Routes came
first, then the screens. A person can now define an agent, run it, watch every step,
and approve or refuse what it pauses on, without touching an API client.

What remains genuinely missing on this family is agent memory (F), multi-agent
orchestration (F), and cost metering into the billing ledger. And the intelligence
itself is still class **E**: with no provider configured, every plan comes from the
deterministic local planner, which the UI labels LOCAL on every single run.

The remaining class **C** entry is MFA, which has a route but no enrolment screen —
the same shape of gap the agent platform just closed, one subsystem behind.

Everything in class **E** is finished engineering waiting on a credential or an
account. No amount of further code moves those forward — they move when the founder
decides to connect a provider, a payment processor, or a scanner.

Everything in class **F** is honest absence. Canvas, workflows, marketplace, plugins,
mobile, desktop, offline and multi-agent orchestration do not exist, and this
document will not imply otherwise until code does.

---

## Maintenance rule

This document is updated in the same commit as any change that moves a capability
between classes. A capability may only move **up** a class when evidence exists —
tests, a mounted route, a reachable screen — and the evidence is named in the row.
Nothing is promoted because it is nearly done.
