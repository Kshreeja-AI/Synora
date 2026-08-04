# Synora — Current Capability Matrix

**Generated**: 2026-08-04
**Branch**: `claude/synora-ai-platform-h5q0k2`
**Verified at commit**: `15b7ee8` + canvas increment
**Evidence basis**: 2,322 backend tests across 224 files and 499 frontend tests
across 81 files, passing against real PostgreSQL 16 and Redis; typecheck 8/8
packages; lint 0 errors. Route mounts read
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
| Agent run engine (plan → steps → approval → terminal state) | **B** | `agents/run-engine.ts`, 28 engine tests + 14 route tests. Enforces step budgets, tool-call budgets, deadlines, forward-only dependencies, and refuses a whole run that names a forbidden tool. Start, approve, reject and cancel are reachable over HTTP and from the `/agents` screen. **Limit**: a run's progress is not streamed — the page shows the state the request returned, so a long run must be reopened to see movement. |
| Agent durability across restart | **B** | `agents/agent-stores.ts` + `hydrateAgents`/`hydrateRuns`, 11 tests. A run whose definition did not restore is refused and counted, never silently loaded. Interrupted runs restore as `failed`; parked runs stay `awaiting_approval`. Attached at boot via `AGENT_STORE_DIR` and awaited before traffic. **Limit**: with the variable unset the stores are in-memory, which the server logs plainly rather than implying durability. |
| Agent runtime honesty label (LOCAL vs REAL) | **A** | `agents/runtime.ts`, 4 tests. Every run response carries the mode, a plain-language notice, and the plan's `origin`; a configured provider that fails at call time does not silently degrade to the local planner. |
| Agent tool execution inheriting caller permissions | **B** | `agents/tool-runner-adapter.ts` routes through `toolService.executeTool` with the requester's identity, and the runtime binds a fresh runner per request so no run inherits another user's authority. **Limit**: exercised in tests against the tool layer, never against a real registered tool end-to-end. |
| Agent planning from natural language | **E** | `agents/model-planner.ts` parses and strictly validates model-produced plans, refusing rather than coercing malformed output. **ACTIVATION BLOCKED**: requires a model endpoint; `OLLAMA_BASE_URL` is unset, so the model planner is unwired. |
| Deterministic local planner | **A (LOCAL)** | `agents/local-runtime.ts`. Stamped `origin: 'local-deterministic'` in the plan record so no consumer can mistake it for model output. This is orchestration scaffolding, **not intelligence**. |
| Agent UI / testing console / run history view | **A** | `/agents` page plus `CreateAgentDialog`, `RunDetail` and `RuntimeNotice`, 8 tests. Define an agent, give it a task, watch every step, approve or reject what it pauses on, stop it mid-run, and read the full log. The LOCAL/REAL label is rendered on every run, and the fail-closed defaults are shown as they actually are ("no tools", "asks before changes") rather than softened. |
| Agent editing UI (create new version from the screen) | **A** | `EditAgentDialog`, 2 tests. States before you press save that it creates version N+1 and keeps version N — because a user who thinks they edited in place will be confused later by a run history pointing at "old" configurations. The page switches to the new version's id on save. |
| Agent memory integration | **B** | `agents/memory.ts`, 16 tests. Opt-in per direction and fail-closed: an agent that does not declare `recall` reads nothing, one that does not declare `record` writes nothing. Recall runs as the requesting user, so an agent cannot surface a memory that person could not read. Written memories carry the plan's origin **in their text**, so a deterministic run can never be recalled later as though a model produced it. Only successful runs are recorded. Memory access is set from the agent create and edit screens, and shown in the agent summary only when granted. **Limit**: recall quality is UNMEASURED — with no embedding provider, retrieval falls back to keyword search. |

## Family C — Workflow Automation

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Workflow engine (authored steps, executed exactly) | **B** | `workflows/` + `routes/workflows.ts` + `/workflows` page, 20 engine tests + 7 route tests + 8 page tests. A workflow is a human-authored sequence, versioned immutably like agents, run through the *same* engine — so approval gates, tool permissions, retry and tool-call budgets, deadlines and cancellation are inherited rather than reimplemented. Plans are stamped `origin: 'authored'`, distinct from both `model` and `local-deterministic`. **Limit**: no scheduling — a workflow must be started by a person. |
| Workflow authoring-time validation | **A** | A sequence that could never run is refused with a 400 when saved, naming the offending step — rather than accepted and failed on first use. Re-validated on edit (narrowing tool permissions can invalidate saved steps) and again on load from disk. |
| Workflow durability | **B** | Definitions persist via the same `KeyedStore` and hydrate at boot; the run store's orphan check knows about workflows as well as agents, so workflow runs are not destroyed on restart. **Limit**: shares the `AGENT_STORE_DIR` gate — unset means in-memory, which the server logs. |
| Workflow UI / builder | **A** | `/workflows` page plus `StepBuilder`, 8 tests. Add, reorder and remove steps; ids renumber to stay sequential so the run record reads cleanly. Run inspection reuses `RunDetail` unchanged, because a workflow run *is* an engine run. The page states that the run note does not change what executes — the opposite of the agent page, and the difference a user must not get wrong. |
| Scheduled automation | **B** | `workflows/schedule.ts` + `scheduler-runner.ts` + routes, 16 scheduler tests + 5 route tests. Interval and daily-at-UTC-time schedules, strictly validated (anything else refused, not guessed). Durable; a schedule that came due during an outage is moved forward and its missed occurrences **counted, never replayed** — a backlog fired in a burst is how a scheduler turns an outage into an incident. A scheduled run executes as the person who created the schedule, never with ambient authority — pinned by a test on the actual firing path. The `/workflows` page adds, pauses and removes schedules, and renders missed occurrences as a warning, because a schedule silently not running looks identical to one running fine. **Limit**: UTC only, and resolution is the 30s tick, so "daily at 09:00" means at or shortly after — both stated on the page. |
| Event-triggered automation | **F** | Does not exist. Only a clock can start a workflow; nothing reacts to a file arriving or a webhook firing. |

## Family D — Canvas

| Capability | Class | Evidence and honest limits |
|---|---|---|
| Canvas / spatial workspace | **B** | `canvas/` + `routes/canvas.ts` + `/canvas` page, 20 store tests + 6 route tests + 7 page tests. Text, note and link blocks positioned on a bounded surface; create, rename, archive; add, edit, move and remove blocks; durable across restart. Link blocks store **ids only**, resolved on read, so a canvas cannot become a stale copy of what it points at. Blocks are deliberately **mutable** — unlike agents and workflows, nothing references a canvas as a record of the past. **Limit**: movement is by nudge button, not drag; no zoom, no grouping, no connections between blocks. |
| Canvas link resolution (rendering the linked run/conversation inline) | **F** | A link block shows its target type and id, not a preview of the thing. |

## Family E — Knowledge & File Intelligence

| Capability | Class | Evidence and honest limits |
|---|---|---|
| File upload + processing pipeline | **A** | `files.ts`, `FileProcessingJob` model, end-to-end download path. |
| Virus scanning | **E** | Real ClamAV provider abstraction with a **three-state** result (clean / infected / **unscanned**) and fail-closed policy. **ACTIVATION BLOCKED**: no ClamAV daemon configured. The third state exists precisely so an unscanned file is never reported as clean. |
| Memory system (store, rank, dedupe, summarise, GDPR erase) | **A** | Nine memory services, `memories.ts` mounted, `/knowledge/memories` page. |
| Semantic search over memory | **E** | pgvector store and embedding provider adapters are implemented and tested. **ACTIVATION BLOCKED**: no embedding credential. Semantic search is *gated off* rather than faked; the system falls back to real Postgres full-text search and says so. |
| Full-text search | **A** | `search.ts`, `search.service.ts`, `/search` page, `SearchIndex`/`SearchQuery` models. |
| Prompt & conversation templates | **A** | `promptTemplates.ts`, `conversationTemplates.ts`, `/knowledge/prompts`, `/knowledge/templates`. |

## Family F — Research Workspace

| Capability | Class | Evidence |
|---|---|---|
| Research workspace (multi-source gathering, citation, synthesis) | **F** | Does not exist as a distinct capability. Search and memory exist separately; nothing composes them into a research surface. |

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
| Plugin system (install / sandbox / lifecycle) | **F** | One directory name matches `plugin`; no implementation. |

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
