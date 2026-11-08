# Synora — Master Blueprint

**The architectural source of truth.** What Synora is, how it is built, and
where it is going. Two previously separate blueprints — a direction document
at the repository root and an as-built architecture document under `docs/` —
were merged here on 2026-08-10. They shared no sections; both were load-bearing.

For running and deploying Synora see `SYNORA_OPERATIONS.md`.
For the engineering concepts behind these choices see `SYNORA_LEARNING.md`.

---

# Part I — What Synora is

## 1. What Synora is

Synora is a **human-centered AI world**: an environment in which people
think, create, decide, build, operate and accomplish work with AI — not a
chatbot with features attached, and not an automation platform that
removes people from their own work.

Three commitments distinguish it, and every capability is measured
against them:

1. **Never fake intelligence.** Every AI-shaped output is labeled by its
   real provenance (`model` / `local-deterministic` / `authored` /
   SIMULATED), everywhere, always. Unmeasured is reported as unmeasured.
   A gap is named, never glossed.
2. **Maximum capability, maximum human control.** Automation executes;
   authority stays human. Actions that need human authority stop and ask
   — once, clearly, with enough context to decide — and everything else
   proceeds without nagging.
3. **Work lives somewhere and survives time.** Conversations, runs,
   files, decisions and their reasons accumulate into places (projects,
   workspaces) a person can leave for a quarter and re-enter without
   starting from zero.

## 2. The launch vision, stated as human outcomes

Synora is launch-ready when a person can accomplish each of the
following end-to-end, and each has a verified status in the capability
matrix. Implementation primitives (chat, agents, workflows, canvas) are
listed only as the means.

| # | Human outcome | Primary means | Matrix families |
|---|---|---|---|
| O1 | "I want to think something through with AI, and keep the thread." | Conversations: streaming, branching, folders, templates, attachments, export | A, E |
| O2 | "I want a place where a piece of work LIVES — everything about it, resumable months later." | Projects: gathered work, goal, timeline, since-last-visit digest, decision notes, resume | E (project rows) |
| O3 | "I want to delegate a task and stay in charge of it." | Agents: budgets/limits, approval gates, memory opt-in, run records, permalinks | B, I |
| O4 | "I want repetitive work to run itself — exactly, on schedule, reversibly." | Workflows: authored steps, schedules (DST-correct), webhooks, event triggers | C, H |
| O5 | "I want to arrange my thinking spatially." | Canvas: blocks, connections, multi-select, undo | D |
| O6 | "I want to create media and documents from intent." | Image/video/audio generation, documents, save-as-doc | G |
| O7 | "I want to work with other people in one place, safely." | Workspaces, roles, invitations, sharing, audit, activity | L, O |
| O8 | "I want to know what needs me, what's running, and what broke — at a glance." | Home decision surface (WaitingForYou / ActiveWork / NeedsAttention / RecentActivity) | B, N |
| O9 | "I want to trust the platform with my account and money." | Auth + MFA, sessions/devices, billing, credits, usage ledger | M, O |
| O10 | "I want the platform itself to know whether it's healthy and honest." | EOS: launch gates, proposals with founder approval, cost/latency/privacy monitors | N |

**Definition of done for an outcome**: class **A** (or **B** with the
stated hole explicitly accepted by the founder) in every matrix row the
outcome depends on, plus at least one verified end-to-end journey test
covering the whole loop: action → UI → logic → persistence → UI state →
error/recovery.

## 3. What launch does NOT require (deliberate non-goals for v1)

- **Cloning any competitor's product shape.** Synora studies the human
  need, never the rival's implementation.
- **Judging the user's work.** "Last activity 3 weeks ago" is shown;
  "this project is stalled" never is.
- **AI-inferred records presented as human ones.** A decision note is
  written by the person; an AI draft, if ever added, is labeled a draft.
- **Cross-application ambient computing.** One coherent world first.

## 4. The external-dependency seam (what stays honest until launch)

Everything below is **architecture-complete and blocked only on
credentials/infrastructure** — the launch playbook is: connect, validate,
flip. Nothing in this table is ever reported as live before that.

| Seam | Built abstraction | Missing piece | Matrix class |
|---|---|---|---|
| Model intelligence | 10-provider AI abstraction, LOCAL/SIMULATED/REAL labeling | API keys | E |
| Embeddings / semantic recall | Provider adapters + pgvector store | Embedding credentials | E |
| Payments | Stripe-shaped billing services, webhook dedup | Processor account | E |
| Media generation | Provider registry + async job polling | Provider keys | E |
| Virus scanning | ClamAV abstraction, fail-closed three-state | Scanner deployment | E |
| Mail | Mailer abstraction (console transport locally) | SMTP/API credentials | E |
| Production infra | Docker, config staging, secrets manager, K8s dir | Cloud accounts, DNS, deploy | — |
| Model-judged gates | 3 of 10 launch gates | Judge endpoint | reported unmeasured |


---

# Part II — As built today

## 1. Product definition

Synora is an **AI workspace**: a multi-tenant, provider-neutral platform
where teams hold conversations with AI models, organise that work into
projects and folders, attach and search their own material, extend the
system with tools, and see exactly what it costs.

Three commitments distinguish it and constrain every design decision below:

1. **Provider neutrality is structural, not a setting.** No business logic
   names a vendor. Sixteen adapters sit behind one interface; the system
   runs on local models with no vendor account at all.
2. **Honesty over appearance.** An unmeasured thing is reported as
   unmeasured, never as zero and never as passing. Unavailable capabilities
   return honest errors rather than fabricated output.
3. **Evidence over assertion.** Launch readiness is measured by an internal
   platform (§9) that probes real code paths, not by estimates.

---

## 2. System topology — Implemented

```
Browser — Next.js 15 App Router, React 19
   │  HTTPS · JWT access token · SSE for token streaming · Socket.IO for presence
   ▼
Express (TypeScript, ESM) — apps/backend
   ├── middleware   auth · CSRF · CSP · rate limits (auth + resource) ·
   │                workspace access · permissions · admin role ·
   │                correlation-id · request timeout · input/query validation
   ├── routes       43 modules (§4)
   ├── services     60+ modules
   ├── ai/          provider registry · resolver · 16 adapters · pricing · streaming
   ├── tools/       universal tool engine (§5)
   ├── eos/         Engineering Operating System — 38 modules (§9)
   ├── workers/     10 BullMQ workers
   ├── secrets/     SecretsManager + audited reads
   └── config/      typed, stage-aware, Zod-validated
   ▼
PostgreSQL 16 (Prisma, 121 models) · Redis 7 (cache + BullMQ)
   ▼
Adapters, all swappable: AI providers · mail · object storage · embeddings ·
vector store (pgvector) · virus scan (ClamAV) · payments (Stripe)
```

**Monorepo:** pnpm workspaces + Turbo. `apps/backend`, `apps/web`,
`packages/database`, `packages/shared`, `packages/design-system`.

**Architectural invariants** — violations are defects:
- Routes → Services → Data. Routes hold no business logic.
- All API responses use the `createApiResponse` / `createApiError` envelope
  from `@synora/shared`.
- Permissions are enforced in the backend, never only in the UI.
- An inaccessible resource returns **404, not 403** — existence is not
  disclosed to unauthorised callers.
- Every vendor sits behind an adapter; a missing credential yields an
  honest 503, never fabricated output.

---

## 3. Data architecture — Implemented

121 Prisma models. Grouped by domain:

| Domain | Representative models |
|---|---|
| Identity & access | User, Account, UserProfile, UserPreferences, Session, RefreshToken, PasswordResetToken, EmailVerificationToken, ApiKey |
| MFA | MFAMethod, MFAAttempt, MFAChallengeToken, MFARecoveryCode, MFASetupToken, MFAAuditLog |
| Tenancy | Workspace, WorkspaceMember, WorkspaceInvitation, Project, Folder, Asset, AuditLog, ActivityLog, Notification |
| Conversation | Conversation, Message, MessageBranch, MessageAttachment, ConversationFile, ConversationFolder, ConversationTag, ConversationVersion, ConversationCollaborator, ConversationActivity, SharedConversation, StreamingJob |
| Knowledge | PromptTemplate, ConversationTemplate, Document, AIMemory |
| Memory | Memory, MemoryMetadata, MemoryRelation, MemoryAuditLog, MemoryQuota, MemoryCache, MemoryExport |
| Tools | Tool, ToolCall, ToolDefinition, ToolDependency, ToolExecution, ToolInvocation, ToolAuditLog, ToolMetrics, ToolWebhook, ToolQuota, ToolSecret, ToolSecretAuditLog |
| Search | SearchIndex, SearchQuery, SavedSearch, SearchSuggestion, SearchRanking, SearchAnalytics |
| Feedback & learning | MessageFeedback, ConversationFeedback, WorkspaceFeedback, Correction, PreferredResponse, HallucinationReport, CitationFeedback, ToolFeedback, VisionFeedback, VoiceFeedback, FeedbackAnalytics |
| Evaluation | Dataset, DatasetVersion, DatasetSample, DatasetLabel, DatasetSplit, EvaluationRun, EvaluationResult, BenchmarkRun, BenchmarkMetric, RewardSignal, HumanPreference, ABExperiment, ABAssignment, ABResult |
| Models | ModelRegistry, ModelVersion, TrainingCandidate, TrainingExport |
| Billing | Plan, Subscription, Invoice, Refund, PaymentMethod, WorkspaceCredits, CreditLedgerEntry, UsageRecord, ProcessedWebhookEvent, ConversationUsage |
| Privacy | PrivacyConsent, TrainingConsent |
| Media | GeneratedImage, GeneratedVideo, GeneratedAudio |

**Decision (2026-11-08): the interim Supabase database keeps Synora in schema
`synora`, not `public`.** The Supabase project's `public` schema already held
four empty tables that no migration in this repository created, and Prisma will
not run `migrate deploy` against a non-empty schema (P3005). Dropping tables
nobody had authorised dropping was rejected; pointing Prisma at its own schema
(`DATABASE_URL=...?schema=synora`) needs no destructive step, leaves the
existing tables alone, and keeps Synora's tables outside Supabase's
auto-exposed REST schema. The cost: the `ensure_rls` event trigger covers
`public` only, so row-level security is not auto-enabled on these tables; the
backend connects as `postgres`, which bypasses RLS, so nothing relies on it.
Reversible, but not free: moving to `public` later means an explicit decision
about the four tables. Operational detail is in `SYNORA_OPERATIONS.md` §7.

**Decision (2026-11-08): the public assistant uses a free-tier fallback chain,
not the general provider resolver.** An anonymous endpoint cannot be allowed to
reach a billed provider. `ai/freeTierChain.ts` tries Groq, Cloudflare Workers
AI and OpenRouter `:free` models in configured order through the existing
OpenAI-compatible adapter and circuit breaker; its calls are recorded at 0
cents while tokens still count against the daily token cap. Providers whose
free plan may train on prompts are excluded until an opt-out is confirmed.
Business logic never names a vendor; the chain is selected by configuration.

**Migration integrity is enforced in CI:** a job asserts that applying the
migration history reproduces `schema.prisma` exactly. A production deploy
applies migrations, so the migration history — not the schema file — defines
the production database; when they diverge, production silently differs from
every developer machine. An empty diff is the only passing result.

**Honest note on model count.** 121 models is a large surface, and not
every model has a fully exercised feature above it. The feedback,
evaluation, and model-registry clusters are more complete in schema than in
product surface — see §11.

---

## 4. Backend API — 43 route modules

All Implemented unless noted. Credential dependencies marked.

**Identity:** `auth` (register, login, refresh rotation, logout-all,
sessions), `users`, `mfa` *(Partial — services and routes exist; not
verified end-to-end)*, `apiKeys`, `privacyConsent`.

**Tenancy:** `workspaces`, `invitations` *(record layer Implemented; email
delivery needs a mail provider)*, `projects`, `folders`, `assets`,
`documents`, `notifications`.

**Conversation:** `conversations`, `messages`, `branches`,
`conversationFolders`, `conversationTemplates`, `promptTemplates`,
`streaming` (SSE), `realtime` (Socket.IO presence/typing), `sharing`,
`sharing-public`, `files`, `export-import`, `feedback`.

**Intelligence:** `ai`, `capabilities`, `memories` *(semantic paths need an
embedding provider)*, `search` (Postgres FTS), `evaluation`,
`modelRegistry`, `datasetExport`.

**Media** *(all need provider credentials)*: `images`, `videos`, `audio`.

**Tools:** `tools`, `toolSecrets`.

**Commerce** *(needs Stripe credentials)*: `billing`, `billingPlans`,
`billingWebhook`, `adminBilling`, `usage`.

**Administration:** `admin`.

---

## 5. Subsystems

### 5.1 AI provider layer — Implemented, provider-neutral

Registry + resolver + 16 adapters: `anthropic`, `openai`, `gemini`,
`azureOpenai`, `bedrock`, `deepseek`, `openrouter`, `together`, `xai`,
`openaiCompatible`, `ollama`, `openaiImage`, `openaiTextToSpeech`,
`replicateVideo`.

**Ollama is the only adapter needing no credentials** and is therefore the
zero-cost path to measuring AI quality (§9). It deliberately refuses a
default base URL: "Ollama is running somewhere" is not a safe assumption,
and a silent `localhost:11434` default could select a developer's daemon in
an environment nobody intended.

Also Implemented: model registry, per-model pricing with explicit
`pricingBasis` (token vs per-image — inference would mislabel media),
streaming, capability resolution.

### 5.2 Conversation & messaging — Implemented
Conversations, immutable messages, branching (alternative generations),
folders, templates, tags, attachments, version history, SSE token
streaming, Socket.IO presence and typing (join authorization enforced at
handshake), public sharing with scoped tokens, export/import.

### 5.3 Memory — Partially implemented
Eleven services: retrieval, ranking, deduplication, summarization,
lifecycle, GDPR erasure, analytics, quota, cache, embedding, relations.
Non-semantic paths work today. **Semantic retrieval requires an embedding
provider and is gated**; it returns an honest 503 rather than fabricating
embeddings — an earlier version did fabricate them and was removed.

### 5.4 Search — Partially implemented
Postgres full-text search: Implemented. Vector/semantic search: complete
behind the embedding gate (pgvector store + adapters). Saved searches,
suggestions, ranking, analytics: schema present, surface partial.

### 5.5 Universal tool engine — Partially implemented
Implemented: registration, execution with retry and circuit breaker,
per-execution audit trail, quotas, encrypted tool secrets, and **HTTP /
Webhook transport**.

The HTTP transport is hardened against SSRF because tool configs are
user-supplied: it validates every address a hostname resolves to via the
DNS `lookup` hook (so a DNS answer cannot swap in a private address between
check and connect), refuses private-range IP literals, follows no redirects
(a redirect would bypass the original hostname's validation), and caps
response size.

**Not implemented:** the other transports. `ToolType` declares `GraphQL`,
`Database`, `Search`, `File`, `Browser`, `Python`, `MCP`, and `Custom` —
these are **enum values with no transport behind them**. `MCP = 'MCP'` in
`tools/types.ts` is the entire MCP presence in this repository.

### 5.6 Billing — Implemented, credential-gated
Plans, subscriptions, credits and ledger, invoices, refunds, payment
methods, usage records, webhook handling with signature validation and
replay/dedup protection. Needs Stripe credentials.

### 5.7 Security — Implemented
Argon2 password hashing; JWT access + rotating refresh tokens with session
IDs and device metadata; account lockout; CSRF tokens; CSP; auth and
resource rate limiting; backend-enforced permissions; audit logging;
encrypted tool secrets; SSRF-hardened egress; input and query validation;
404-not-403 for unauthorised resources; blocking dependency audit and
full-history secret scanning in CI.

### 5.8 Background processing — Implemented
Ten BullMQ workers: response generation, file processing, memory, memory
maintenance, feedback processing, evaluation runs, dataset export, video
generation, plus queue and manager infrastructure. Producers fail fast
rather than hanging when Redis is absent.

### 5.9 Agent engine — Partially implemented (`apps/backend/src/agents/`)

Commissioned by the Local Product Completion directive (2026-08-04),
which moved AI Agents out of Future vision. What exists, with tests:

**Implemented:** versioned immutable agent definitions (editing creates
version+1 linked to its predecessor, so runs always resolve the exact
configuration they executed under); workspace-scoped registry with
404-style lookups; the run engine with an explicit lifecycle
(`pending → planning → awaiting_approval? → running → completed | failed
| cancelled | timed_out` — every run reaches exactly one terminal state);
plan validation that treats every planner as untrusted (forbidden tool →
whole run refused; unknown step kinds, duplicate ids, and forward-only
dependencies enforced, making cycles unrepresentable); fail-closed
permissions (no declared tools means no tools; undeclared mutability
means mutating); approval gates as a state, with named approvers recorded
and no execute-first path; per-step retry budgets; tool-call, step-count,
and wall-clock limits; cancellation at step boundaries; an append-only
run log. A deterministic local runtime exists for orchestration testing —
every plan it produces is stamped `origin: 'local-deterministic'` and its
output is prefixed, so it can never be passed off as model intelligence.

**Also implemented (second increment):** the model-backed planner
(`model-planner.ts`) — same injected-generate seam and same strict-parse
honesty as the evaluation judge: a fenced or bare JSON array is accepted,
prose and buried JSON are refused, `UNPLANNABLE:` is an explicit refusal
path, and whatever the model emits is re-validated by the engine before
a step runs. And the workspace tool-runner adapter
(`tool-runner-adapter.ts`) — agents call tools through the full
`toolService.executeTool` path as the requesting user, so membership,
`tool:execute` permission, rate limits, schema validation, and audit all
apply to agents exactly as to humans; tool-level approval fails the step
fast with the execution id rather than hanging a run on a human
timescale.

**Also implemented (third increment):** durability. Definitions and runs
now write through to a keyed store (`agent-stores.ts`) and are restored
at startup, with in-memory kept as the synchronous working set. Three
properties are deliberate. Definitions are re-validated on the way in, so
a record written by an earlier version that no longer satisfies today's
rules is discarded rather than trusted because it is on disk — guessing
at what a malformed definition meant would hand an executor a
configuration nobody wrote. A run whose agent definition did not restore
is refused and counted, never silently loaded: such a run cannot be
resumed, explained, or approved, so restoring it would look like recovery
and behave like corruption (this is the benchmark-registry deadlock
generalised into a guard). And a run found mid-flight restores as
`failed` with the reason recorded, because the process that owned its
loop no longer exists — while a run parked at `awaiting_approval` is left
untouched, since nothing was executing and the human is still the thing
being waited on. A missing store file is an empty store; a corrupt one
raises rather than reading empty.

This store is also the third-instance extraction that `gate-store.ts`
called for: gate measurements and regression baselines were two tolerable
copies of the keyed-record shape, and agent definitions and runs are
instances three and four, so the generic `KeyedStore<T>` now exists
rather than a third copy. Migrating the two older stores onto it is
named follow-up work.

**Also implemented (fourth increment):** the HTTP surface. `routes/agents.ts`
is mounted under `/api/workspaces/:workspaceId/agents` and covers
definitions (list, create, get, edit-as-new-version, lineage history,
archive) and runs (start, list, get, approve, reject, cancel). Workspace
scoping is enforced twice — by `requireWorkspaceAccess` and again in every
registry/engine lookup — and cross-workspace resources answer 404, never
403. Definitions and runs are written through to the store before the
response is sent, so a 201 means durable rather than merely present.

Two design points are worth naming. First, `agents/runtime.ts` is the only
file in the agent path that imports the AI layer, exactly as
`judge-wiring.ts` is for the judge; it resolves the planner per request
(never cached, because the tool runner is bound to the requesting user and
a cached runner would let one user's run inherit another's permissions),
and it returns the MODE alongside the dependencies. Every run response
therefore carries a `runtime` block stating `local` or `model`, a
plain-language notice, and the plan's `origin` — there is no response shape
that returns a run without saying what produced it, so a UI cannot render
deterministic scaffolding as if it were intelligence. Second, a configured
provider that fails at call time does NOT fall back to the local planner:
that would convert a visible outage into invisible fake intelligence, so
the failure propagates and the run fails honestly.

Durable stores are attached at boot by `agents/boot.ts`, gated on
`AGENT_STORE_DIR`, and hydration is AWAITED before the server accepts
traffic — an unhydrated registry would answer 404 for agents that exist,
which is a confident wrong answer. With the variable unset the stores stay
in-memory and the server logs that agents will not survive a restart,
rather than leaving durability to be assumed.

**Also implemented (fifth increment):** the product surface. `/agents`
lets a person define an agent, give it a task, watch every step it took,
approve or refuse the steps it pauses on, stop a run mid-flight, and read
the append-only log verbatim. `RuntimeNotice` renders the LOCAL/REAL
label on every run using the server's own wording, so the client cannot
soften it; the create form shows the server's fail-closed defaults
exactly (no tools, pause before anything that mutates) rather than
friendlier ones, because a form that disagreed with the engine would
teach the wrong mental model. The run view states outright that rejecting
a step ends the run rather than skipping it, and that a plan naming a
forbidden tool is refused whole rather than partially executed — both are
behaviours that surprise people, so they are said rather than discovered.

**Also implemented: memory** (`agents/memory.ts`). An agent may recall
workspace memories before a run and record its outcome after one, both
opt-in and fail-closed — undeclared means neither. Recall executes under
the requesting user's identity, so an agent can never surface a memory the
person who started it could not read.

The load-bearing decision is provenance. A run's output becomes a memory,
and a later run recalls that memory as context — so an unlabelled
deterministic result would be read back as though it were knowledge, and
the memory store would fill with fabricated experience. Every recorded
memory therefore states in its own TEXT whether it came from a model, a
deterministic script ("NOT by AI — this is scaffolding output, not
knowledge"), or a human-authored workflow. The stamp is in the content
rather than only a tag, because a consumer that reads only the text must
still learn where it came from. Memories are filed EPISODIC — a record of
something that happened, not a fact about the world — and only successful
runs are recorded, so a broken run cannot poison future recall.

Memory access and agent editing are both on the screen now. The edit
dialog states BEFORE the save button that it creates version N+1 and keeps
version N — a user who believes they edited in place would be confused
later by a run history pointing at "old" configurations — and the page
switches to the new version's id on save, because the id it held is now a
superseded version.

**Also implemented: run metering** (`agents/metering.ts`). Every terminal
run — started, approved to completion, rejected, or fired by the
scheduler — lands in the same usage ledger everything else bills through.
Two accounting rules carry it: usage is always counted even when credit
deduction cannot happen (the record then says `deducted: false` and why,
because a history that loses records whenever billing hiccups lies by
omission); and deterministic generate-steps cost zero, since no tokens
were bought and charging would fabricate a cost, while tool calls are
charged regardless of origin because a tool does real work either way.
Metering never fails a run.

**Also implemented: a pre-run budget gate** (`assertRunBudget`). The
policy is stated rather than left to be inferred: a workspace WITHOUT a
credits account runs freely — that is every local workspace, and it
matches the metering rule above (count, don't deduct). A workspace WITH a
credits account has opted into billing, and opting in means the budget
binds: at zero balance new runs are refused BEFORE anything executes,
rather than discovered at deduction time once the work is already done.
The gate sits at run start on both the agent and workflow routes and in
the scheduler — a clock is not a discount — and the scheduler checks
*after* advancing its cursor, so a refused occurrence is skipped like any
other failure instead of queueing up to fire the moment credits arrive. It
is a start-time check only: a run already in flight is never killed by the
budget, because killing mid-run wastes the very spend it is protecting,
and the terminal deduction records the overshoot honestly.

**Missing, named:** recall quality is UNMEASURED
(with no embedding provider, retrieval falls back to keyword search);
live progress for a long run (the page shows the state the
request returned, so a run must be reopened to see movement); usage/cost
metering into the billing ledger; agent memory integration; multi-agent
orchestration; and no live model has ever produced a plan — the planner's
parsing is fully tested, its intelligence is UNMEASURED — EXTERNAL
PROVIDER REQUIRED (or a local OLLAMA_BASE_URL).

**Also implemented: templates** (`agents/templates.ts`). Seven starting
configurations spanning writing, research, analysis, operations and code,
each written for this platform and each described by the **user outcome**
it serves rather than by a feature list — "I wrote something and I want it
tightened, not rewritten" tells someone whether to pick it in a way a
capability list does not.

Instantiating one goes through the ordinary registry and produces an
ordinary agent or workflow: same validation, same immutable versioning,
same fail-closed defaults, and nothing on the created definition records
that a template was involved, because that relationship would imply an
ongoing link the system does not maintain.

**A template can never name a tool id.** Tool ids are per-workspace
database rows, so a template naming one would create a definition pointing
at a tool that may not exist in the workspace it was used in — ready-
looking and broken on first run, exactly the trap authoring-time
validation exists to prevent. Templates therefore create generate-only
definitions, and list the tools they would benefit from as plain
capability names. The gallery presents those as things to connect, never
as things already connected.

They live at `agent-templates` on the wire rather than `templates`
because conversation templates already own that path on the same mount —
a second router claiming it would be silently shadowed, the same failure
that once hid `/agents/runs` behind `/agents/:agentId`.

**Also implemented: workspace-authored templates**
(`agents/workspace-templates.ts`). Saving an agent or workflow you have
already tuned turns it into a starting point for the next one, listed
alongside the built-in catalogue and any plugin contributions — a user
choosing where to start does not care which source a template came from.

These MAY name real tool ids, and the built-in and plugin ones may not.
That is not an inconsistency: the rule elsewhere exists because a
template shipped to another workspace would point at ids that mean
nothing there, and a workspace template never leaves the workspace that
wrote it. But a tool can still be DELETED after the template is saved, so
tools are re-checked at instantiate time: what survives is granted, and
what did not comes back as `droppedTools`. Narrowing that is reported is
not the silent narrowing refused in the plugin permission model — the
caller is told exactly what changed.

No link back to the source agent is stored. A template is a snapshot
taken at one moment; a stored source id would imply a live relationship
that is never maintained and would be wrong the first time the source was
edited.

**Missing, named:** editing a saved template in place — changing one means
saving a new one.

**A defect worth naming before it happens.** A run executes synchronously
inside the HTTP request that started it: `await startRun(...)` returns only
when the run reaches a terminal state or parks for approval. Meanwhile a
run's default wall-clock budget is five minutes and the default HTTP
request timeout is thirty seconds — the run is allowed to take ten times
longer than the request carrying it.

Nothing goes wrong today, because with no model provider configured the
deterministic local runtime returns instantly. It goes wrong the moment a
real provider is connected: the request times out at thirty seconds with a
408, the timeout handler does **not** abort the work, and the run carries
on — executing steps, calling tools, spending budget, being metered, and
landing in history — while the caller has an error and no run id, because
the id existed only in the response that was discarded.

No test catches this: the timeout middleware returns early when
`NODE_ENV=test`, so every test runs with no timeout at all.

The fix is asynchronous runs — start returns immediately with a `running`
state, execution continues, and the client polls or streams. That changes
the `POST /runs` contract, so it is recorded here as a decision rather than
made silently. It is also the reason live run progress cannot be built
before it: while the run *is* the request, there is nothing to observe.

### 5.10 Workflow engine — Partially implemented (`apps/backend/src/workflows/`)

A workflow is a sequence a **human wrote down**, executed exactly as
written. That is the whole distinction from an agent: an agent is given a
goal and improvises a plan; a workflow is given the plan. Nothing decides
what the steps should be, because a person already did. When customers say
"automation" they usually mean this one.

**What is deliberately shared, and why.** Everything about *running* steps
— permission checks, approval gates, retry budgets, tool-call budgets, the
wall clock, cancellation and the append-only record — is the agent run
engine, unchanged. A second execution loop would mean two implementations
of properties that were hard to get right, and the day they diverged, one
would be wrong in a way nobody notices until an agent and a workflow behave
differently on the same tool. Worse, a divergence would let someone route
around a control by choosing the other feature. So the engine gained one
small seam — `ExecutableDefinition` plus an injectable `resolveDefinition`
— and a workflow supplies its own steps and its own resolver. The engine
never learns that workflows exist.

**Implemented:** authored step sequences validated with the engine's own
`validatePlan` (not a parallel copy, which would drift); immutable
versioning identical to agents, so a run resolves the exact version it
executed; workspace-scoped lookups answering 404 rather than 403; archive
rather than delete; durability through the same `KeyedStore`, hydrated at
boot; and HTTP routes under `/api/workspaces/:workspaceId/workflows`.

**Three details worth recording.** First, validation happens at AUTHORING
time as well as run time — an agent's plan cannot be checked until a
planner produces it, but a workflow's steps exist the moment someone saves
them, and letting a user save a sequence that can never run would build a
trap that looks ready and fails when it matters. It is re-validated on
edit, because narrowing `allowedTools` can invalidate steps that were fine
a moment earlier. Second, plans are stamped `origin: 'authored'`, a third
value distinct from `model` and `local-deterministic`, so no surface can
imply that a human-written sequence was reasoning — and equally, cannot
imply it was deterministic scaffolding. Third, the run store holds agent
runs and workflow runs alike, so both the boot-time orphan check and the
shared approve/reject/cancel endpoints resolve definitions from either
registry; an agent-only check would have silently destroyed every workflow
run on restart, turning a guard against corruption into a cause of data
loss.

**Also implemented:** the authoring surface. `/workflows` builds a step
sequence — add, reorder, remove, with ids renumbering to stay sequential so
a run record reading "waiting on step s2" refers to something the author
has seen. Run inspection reuses `RunDetail` unchanged, because a workflow
run *is* an engine run; a separate viewer would be a second thing to keep
correct for no gain. Two wordings are deliberate: the run note is labelled
as recorded-for-reference and explicitly *not* something that steers the
run (the opposite of the agent page, and the difference a user must not
get wrong), and a tool step's read-only checkbox is phrased as a claim the
author is making rather than a convenience toggle, because getting it wrong
in the permissive direction is how an automation quietly changes data
nobody approved.

**Also implemented: scheduling** (`schedule.ts`, `scheduler-runner.ts`).
Interval and daily-at-UTC-time, both strictly validated — a cron parser
that handles most expressions and silently misreads the rest is worse than
none, because the failure is invisible until the wrong thing runs at the
wrong time, so anything outside the two supported shapes is refused rather
than guessed at.

Two decisions carry the weight here. First, occurrences that came due while
nothing was running are **skipped and counted, never replayed**: an hourly
workflow after a two-day outage would otherwise fire 48 times in a burst
against real tools and real budget, which is how a scheduler turns an
outage into an incident — but silently skipping would leave the owner
believing it ran. The count is recorded on the schedule and logged when
discovered, the same rule as a run interrupted by a restart. Second, a
scheduled run executes **as the person who created the schedule**, never
with ambient or elevated authority; otherwise a schedule would be a way to
run tools you are not permitted to run, a privilege escalation dressed as
a convenience. Schedules are also advanced before anything is started, so a
workflow that throws every time cannot wedge the scheduler into retrying
one occurrence forever.

The scheduling surface lives on `/workflows`: add, pause and remove
schedules, with missed occurrences rendered as a warning rather than a
tooltip — a schedule that silently did not run looks identical to one
running fine, and the difference is exactly what the owner needs. The
panel also states the two things a user would otherwise have to guess:
that the clock is checked every 30 seconds (so a time is "at or shortly
after"), and that a scheduled run uses their own permissions.

**Also implemented: dry runs** (`dry-run.ts`). The founder directive was
explicit that a visual or preview surface must not fake execution, so a
dry run here executes literally nothing — no tool is called, no model is
asked, no run record is created — and reports only what can be known in
advance. It runs the same authoring-time `validatePlan`; walks each tool
step through the real tool layer to check existence, active status,
whether the platform can execute that type at all, and whether the step's
input satisfies the tool's schema; flags a tool marked `requiresApproval`
as a step FAILURE rather than a pause, matching what the tool-runner
adapter actually does (an agent run never waits on a human timescale); and
predicts which steps would pause under the workflow's own approval policy
using the engine's own `stepNeedsApproval`, not a second copy of that
rule that could quietly drift from it. An exhausted budget is reported as
a blocker rather than refusing the dry run itself, because the dry run
costs nothing and withholding it is exactly wrong for someone in that
position. Every report also states what it cannot know — a generate
step's output, a remote endpoint's real response — rather than letting
silence imply a guarantee. Reachable from `/workflows` as a "Dry run"
button beside Run.

**Also implemented: webhook triggers** (`trigger.ts`,
`routes/workflowHooks.ts`). A POST to `/api/hooks/workflows/:secret`
starts a real run from outside Synora — the event-triggered half of
automation, beside the clock-driven half above.

Three decisions carry it. First, **the URL is the credential**: there is
no session, no cookie and no CSRF check on that path, because the caller
is never a browser holding Synora's own session, it is another system
holding a secret. That is the same shape as the `/api/shared/:shareToken`
route already in production, so it introduces a pattern the codebase
already reasons about rather than a bespoke signature scheme. Second,
**the secret is stored hashed**, as an API key is and unlike a read-only
share token — a trigger can start real work against real tools and real
budget, so it belongs in the higher risk class. Third, the run executes
**as the trigger's creator**, exactly as a scheduled run does; a webhook
must not become a way to run tools nobody is permitted to run. A disabled
or deleted trigger answers identically to one that never existed, so
pausing an automation does not leak its existence to whoever still holds
the old URL. Budget gate and metering apply unchanged — an external
caller is not a discount.

The surface is `TriggerPanel` on `/workflows`. It shows the full URL
exactly once, at creation, and says so; every later view shows only a
non-secret prefix, because no endpoint will ever return the secret again.

**Also implemented: internal event triggers** (`event-trigger.ts`,
`event-dispatch.ts`). A workflow starts because something happened INSIDE
Synora, without anything outside having to call in. Today that means
`asset.uploaded` and `project.created`.

**The event catalogue is closed, and every name in it has a real emit
site.** This is the load-bearing rule. A catalogue listing events nobody
emits would be the worst dishonesty available here: someone wires an
automation to `document.changed`, sees a trigger sitting there marked
enabled, and waits forever for a run that was never possible — which looks
exactly like a broken workflow. So an unknown event is refused **by name**
at creation, discarded at hydration, and the UI offers only what the
server says it emits. Adding an event means adding the emit alongside it.

**Emitting never fails the action that caused it.** Someone uploading a
file asked to upload a file. If an automation another member wired up is
broken, out of budget, or pointing at an archived workflow, that is not
the uploader's problem and must not become their error message — so
dispatch happens off the request path and every failure is logged rather
than raised.

**Authority is the trigger's creator, never the actor.** Uploading to a
shared workspace is not agreeing to lend your permissions to whatever
somebody else automated. Both trigger kinds now go through one
`startTriggeredWorkflowRun`, so the webhook path and the event path cannot
drift apart on budget, authority or billing — a second copy of that
sequence would eventually disagree, and the disagreement would be about
money and permissions.

**A per-trigger burst limit** (20 a minute, counted and shown in the UI)
is the blast radius of a mistake rather than a tuning knob: a workflow
wired to `asset.uploaded` in a workspace where somebody drags in four
hundred files would otherwise start four hundred billed runs before anyone
noticed. Suppression is counted separately from firing, because "nothing
happened" and "something happened and was declined" are different things
to debug.

**Deliberately absent: `workflow.completed`.** It is the obvious next
event and the one that makes loops possible — a workflow whose completion
starts a workflow whose completion starts the first. Bounding that safely
needs causation tracking through the run engine, knowing that THIS run was
started by THAT event several hops back, and that does not exist. The
burst limit would keep such a loop from running away, but "bounded by a
rate limit" is not "cannot happen", and shipping the event while calling
it safe would be claiming the second. Also absent: any replay of events
that occurred while the process was down, because there is no durable
event log — that would be a different subsystem, not a flag on this one.

**Also implemented: time zones for daily schedules.** A daily schedule
names an IANA zone and runs at that local time — 09:00 in New York, not
09:00 UTC, which was five hours wrong for anyone who did not live in
Greenwich.

The interesting part is DST. The next fire is computed by walking
**calendar days in the zone**, not by adding 24 hours: on a transition the
local day is 23 or 25 hours long, and a flat day would drift the wall
clock the user actually chose. The offset itself comes from the runtime's
own zone database, measured by rendering the instant in that zone and
comparing — two passes, because the offset depends on the answer, and a
single guess can land on the far side of a boundary. Both directions are
pinned by tests against real 2026 transitions, asserting the 23-hour and
25-hour gaps explicitly.

An unknown zone is **refused by name** rather than quietly treated as
UTC: `Europe/Atlantis` looks exactly like a real zone, and a silent
fallback would fire at the wrong hour every day forever with nothing
anywhere to see. A zone on an interval schedule is refused too — an
interval has no time of day, and accepting a meaningless field implies it
does something. Schedules created before this existed carry no zone and
keep meaning UTC, unchanged.

**Missing, named:** internal event triggers (nothing yet reacts to a file
arriving or a document changing — only an external HTTP call or a clock).
The scheduler is also tested only against an injected clock — it has never
been observed running over real elapsed time.

### 5.11 Canvas — Partially implemented (`apps/backend/src/canvas/`, `/canvas`)

A spatial surface holding text, note and link blocks, positioned on a
bounded plane.

**Why canvas blocks are MUTABLE when agent and workflow definitions are
not.** This looks inconsistent and is deliberate. Definitions are immutable
because historical run records point at them — "what was this configured to
do when it did that?" must have an answer, so the referenced thing cannot
change. A canvas is the opposite kind of object: a working surface, edited
continuously, that nothing references as a record of the past. Versioning
every text edit would produce thousands of dead versions answering a
question nobody asks. The rule is "anything a historical record points at
cannot change underneath it", not "nothing may ever be edited"; applying
immutability everywhere would be cargo-culting the rule past its reason.

**Bounded, like everything else here.** Blocks per canvas, content length,
and coordinates are all capped. The coordinate cap earns its own note: a
block placed at 10^9 is not "far away", it is lost, and refusing the
placement is kinder than accepting it and letting someone wonder where
their note went. Partial updates are validated as the block WOULD BE rather
than as the change alone, so supplying one coordinate cannot move a block
somewhere it could never have been placed.

**Link blocks store ids, never snapshots**, resolved on read — so a canvas
cannot drift out of date with the thing it points at, or become a second
stale copy of it.

**Hydration differs from the definition registries on purpose.** A stored
canvas keeps its valid blocks and drops only the invalid ones, where a
malformed agent definition is discarded whole. The reason is the
consequence: a bad definition would hand an executor a configuration nobody
wrote, whereas losing one bad note is better than losing the afternoon's
work arranged around it.

**Also implemented: connections between blocks.** Directed lines with
optional labels, drawn as SVG behind the blocks and also listed in text
with a delete control, so a connection is reachable without pointing at a
line.

**Cycles are allowed here and forbidden in a workflow's `dependsOn`**,
which is the same kind of distinction as the mutability one above. The
workflow rule exists because steps execute in an order and a cycle would
mean a step waiting on itself. A canvas has no execution order; "A relates
to B, which relates back to A" is a thing people genuinely mean when
arranging thought. Enforcing the workflow constraint here would be
copying it past its reason, exactly as versioning canvas blocks would.

What *is* enforced is that every line has two real endpoints: no
self-connection, no duplicate in the same direction (the reverse is a
separate statement, not a duplicate), both endpoints on **this** canvas,
and a bounded count. Deleting a block deletes every connection touching
it, and hydration re-applies the same check — a line whose block did not
survive the load is dropped and counted, because the no-dangling-edges
invariant has to hold across a restart and not only across a live delete.

**Also implemented: a viewport and undo.** Zoom (40–200%, level shown),
four-direction pan, and one reset for both — as labelled buttons rather
than wheel and space-drag gestures: keyboard-reachable by default, and
discoverable rather than hidden until someone happens to try. Lines and
blocks share a single transformed layer, so a connection cannot drift
away from the blocks it joins.

**Also implemented: dragging, alongside the nudge buttons rather than
instead of them.** A block is dragged by a handle, not by its body, because
text blocks are edited in place and a body-drag would fling the block
across the surface when someone tried to select a word. The pointer delta
is divided by the current zoom — the pointer moves in screen pixels while
the block lives in canvas pixels — and the result snaps to the 20px grid
on release.

**One server call per drag, issued on release.** The position under the
pointer is local state until the pointer comes up. Writing every
intermediate pixel would be hundreds of requests for one gesture, each of
which could fail or arrive out of order, and the block would settle
wherever the slowest response said rather than where the person let go.
For the same reason a whole drag is **one** undo entry, labelled
identically to a nudge — which input moved the block is not something the
undo button should make anyone think about. A gesture that travels under
three pixels writes nothing at all, so a mis-click cannot fill the history
with moves to nowhere.

**The nudge buttons stay permanently.** A drag is a pointer gesture and a
pointer gesture is unreachable by keyboard; deleting the arrow buttons once
dragging existed would have taken the canvas away from anyone navigating by
tab and arrow keys. An accessible path that survives only until the
pleasant one ships was never an accessible path.

**Also implemented: moving several blocks at once.** Ticking a block's
checkbox selects it; dragging or nudging any selected block carries the
whole selection.

**Selection is by an explicit labelled checkbox, not by clicking the
block.** The body of a text block is an editable field — making a click
select would mean clicking into your own text selected something instead
— and a modifier-click convention is invisible until somebody tells you it
exists. A checkbox is also the only version a keyboard can reach.

**One shared offset, snapped from the grabbed block.** Snapping each block
to its own nearest grid point would quietly deform an arrangement somebody
made deliberately: two blocks lined up would come out of line. So the
grabbed block decides the offset and every block in the gesture moves by
exactly that much.

**Grabbing an unselected block moves only that block**, and leaves the
selection alone. The alternative — a selection that captures every
subsequent gesture — would make having some blocks selected turn every
other block on the canvas unmovable, and would silently drag a selection
someone had set up for a different purpose.

**A group move is one undo entry**, because moving four blocks together is
one thing the person did and undoing it four times would be four presses
to reverse one action. The entry stores where each block *actually was*
rather than the shared offset: the moves are separate requests, so if one
had been refused, undoing by offset would put the survivors somewhere new
rather than back.

Undo is a bounded stack of inverse operations over add, delete, move,
connect and disconnect, and the button names what it will reverse instead
of saying only "Undo". Undoing a delete restores the block **and the
lines that touched it**, captured before the request because the server
removes them with the block and they are unrecoverable afterwards. The
restored block carries a new id, and that is genuinely fine rather than a
compromise: nothing outside a canvas refers to a block id, so the
restored state is functionally the one that existed. Text edits are
deliberately excluded — typing already has the browser's undo inside the
textarea, and an entry per keystroke would bury the structural changes
people actually want back. The page says so rather than leaving someone
to discover it.

**Also implemented: link blocks show what they point at.** A link resolves
to the target's real current name and a useful second line — a run's
state, a workflow's step count, a conversation's last-message date.

The title is **read now and never stored**. Copying it when the link was
made would turn a canvas into a museum of names things used to have:
rename a workflow and the canvas would still show last month's name with
nothing to indicate it is lying. Resolving costs a lookup and is always
right.

**Every lookup is workspace-scoped, and that is the point of the file
rather than a detail of it.** A block stores a bare id, and nothing stops
someone typing an id belonging to another workspace — without scoping, a
link block would be a way to read other people's conversation titles one
id at a time. An unresolvable target reports `missing` with **no reason**:
deleted, archived, never existed, and belongs-to-someone-else all read
alike, the same 404-not-403 discipline the routes use, and for the same
reason — distinguishing them tells an outsider which ids are real.

Resolution is a separate call from reading the canvas, so a canvas with no
links does not pay for the feature and a canvas whose targets have been
deleted still opens.

**Missing, named:** multi-select covers movement only — several blocks
cannot yet be deleted or connected in one action, and there is no
rubber-band selection by dragging across the surface.

### 5.12 Plugins — Partially implemented (`apps/backend/src/plugins/`, `/plugins`)

A plugin is a **declarative package**: a manifest describing what it
contributes and what permissions it needs. Installing one adds its
contributions to a workspace. That is the entire model, and the limit is
the point.

**It does not run third-party code, and the refusal is explicit.** A
manifest declaring an entry point is rejected with a message saying why;
`code:execute` and `network:outbound` exist as declared-but-ungrantable
permissions so that asking for one produces a specific answer rather than
a confusing "unknown permission". Executing untrusted code safely needs a
real isolate — a separate process, a VM, or WASM with an explicit host
interface — plus resource limits and a syscall policy. None of that
exists. A "sandbox" that is really a function call in the same process is
not a sandbox; it is arbitrary code execution with reassuring naming, and
shipping it would be worse than having no plugin system, because the word
implies a protection that is not there. This is recorded as a **launch
blocker** for any third-party ecosystem, and it is engineering work
rather than a credential.

**The permission model fails closed and never widens.** Validation
refuses an unrecognised permission by name instead of dropping it —
silently narrowing what someone asked for yields a plugin that half-works
for reasons nobody can debug. The grant is exactly what the manifest
declared, captured at install; wanting more is a new install decision,
because a grant that can widen afterwards is not consent. A disabled
plugin keeps its record but holds none of its permissions, checked at
every use, or the switch would be decorative.

**Contributions are validated like authored ones.** A contributed
workflow template goes through the engine's own `validatePlan` at install
time, so a template that could never run is refused before anyone tries
it — the same authoring-time rule that stops a workflow being saved
unrunnable. Contributed templates are read live rather than cached, so
enabling or disabling a plugin changes what the workspace offers
immediately.

**Hydration discards rather than repairs**, unlike a canvas that keeps
its good blocks. A plugin record is a permission grant: loading a
partially-understood one would mean acting on a grant nobody made. Uninstall
deletes the stored record too — which is why `KeyedStore` gained a
required `delete`; a store that cannot delete makes every removal
temporary, and an uninstalled plugin returning after a restart with its
permissions intact is a resurrection nobody would think to look for.

**Tool contributions are real, and are held to a stricter standard than
authored tools.** A plugin may contribute HTTP and Webhook tool
definitions, which become ordinary `ToolDefinition` rows and run through
the same engine, SSRF policy, rate limits, approval flow and execution
records as anything written by hand. Keeping them virtual and merging at
read time — the way contributed TEMPLATES work — was not available
honestly: an execution record points at a tool row by foreign key, so a
virtual tool could be listed and never run, which is the
ready-looking-and-broken trap refused everywhere else.

This is still not code execution, and the distinction is worth stating
precisely: the plugin supplies **data describing a request**, and Synora's
own engine makes the request. Nothing from the plugin is loaded or called.
"The plugin can cause a network call" and "the plugin runs" remain
different claims, and only the first is true. Only HTTP and Webhook are
accepted because they are the only types the engine executes; a Database
or Python contribution is refused rather than installed unrunnable.

**A contributed tool may not name a workspace secret, though a tool you
write yourself may.** A `{{secret:NAME}}` anywhere in a contributed
config is refused. When you write that placeholder yourself you are
choosing to send your own credential to a destination you typed; a
manifest is written by someone else, and one declaring `Authorization:
{{secret:OPENAI_API_KEY}}` against its own host would exfiltrate that key
on the first execution while the install screen said only "contributes 1
tool". Consent that specific needs a per-secret decision this version does
not have, so the answer is no. Approval-before-execution is likewise
forced on and **the publisher gets no say** — letting them set it false
would let them waive the review of their own tool; a workspace admin can
lower it afterwards, locally and audited.

**Consent is asked, not announced.** `POST /plugins/preview` reports what
a manifest would do — permissions, templates, tools, and the **hosts**
those tools will contact — without installing anything, and the UI shows
it before an install button exists. Editing the manifest text invalidates
the review, so nobody can agree to one manifest and install another.

**Uninstalling removes contributed tools; it does not remove contributed
templates.** The asymmetry is the design, not an inconsistency. A template
someone built an agent from is inert — they copied it, the copy is theirs,
and taking it back would delete their work. A tool is not inert: it
reaches a host the publisher chose, every time it runs, so uninstalling
(the withdrawal of consent) has to actually withdraw it. Disabling does
the same. Removal is a deactivation rather than a delete because
executions point at the row and "what did this tool do while it was
installed" is exactly the question asked afterwards. Provenance lives in
the `ToolDefinition.pluginId` **column** rather than a naming convention,
because uninstall must remove exactly the plugin's tools and a rename that
broke a string convention would leave a third-party reach in place after
the grant was withdrawn. A name already taken by another tool is
**reported as skipped**, never overwritten.

**Missing, named:** an execution isolate (above); plugin signing or
provenance verification (a manifest is trusted as handed over, so nothing
proves the publisher is who it claims); tool contributions of the types
the engine cannot yet execute; and a marketplace, which is deliberately
downstream of this — a storefront for a runtime that does not exist would
be a façade.

---

## 6. Frontend — see `SYNORA_UI_SYSTEM.md`

Surfaces Implemented: marketing (landing, pricing, features, changelog),
auth (login, register, forgot/reset, verify), dashboard shell,
conversations/chat, knowledge, search, admin + engineering dashboard,
share and invite public pages, agents, workflows, canvas. Studio (media)
is Implemented but credential-gated. Developer portal is Partial.

`/knowledge/files` (added 2026-08-04) is a navigation fix rather than a
new capability: workspace assets have been storable and listable since
M5, and the project detail page was the only surface that ever showed
them, so a file not attached to a project was reachable by the server and
invisible to a person. The new page lists what already existed and marks
project-attached files as such rather than presenting them as loose.

---

## 7. Configuration, secrets, environments — Implemented

Typed, stage-aware configuration validated with Zod; no scattered
`process.env` reads. SecretsManager with pluggable sources and audited
reads; env source Implemented, HSM source is a documented stub. Enterprise
and government mode hooks present.

**Every integration activates by supplying credentials alone.** No business
logic requires rewriting to go live — this is a structural property of the
adapter layer, and the single most important thing to preserve.

---

## 8. Delivery and operations — Implemented

CI (`.github/workflows/ci.yml`): test (with Postgres and Redis services,
migrations, drift check, lint, typecheck, coverage, build), e2e
(Playwright), docker (production image build + liveness smoke test),
security (blocking `pnpm audit --prod --audit-level=high`, blocking
full-history gitleaks scan, non-blocking Snyk).

One pipeline per change: push triggers cover long-lived branches only,
PR triggers cover feature branches, and superseded PR runs are cancelled.
See `docs/operations/COST_AUDIT.md` for the measurement behind that.

---

## 9. Engineering Operating System (EOS) — Implemented

An internal, event-driven platform of 38 modules that measures Synora
rather than describing it. Independent collectors publish to a bounded
event bus; no module depends on another's internals.

**Observation:** boot, health, API, memory, worker, and queue-depth
collectors; error-rate, latency, cost, latency-drift, and
provider-degradation monitors; runtime check (reads live listener counts,
because a component that is configured but never started is invisible to
tests that start what they test).

**Evaluation:** datasets, graders, runner, case capture from real traffic
(consent-gated, redacted), regression suite with persisted baselines,
benchmark importer (content-hashed, holdout-preserving), AI judge *(not
wired — needs a model to judge with)*.

**Privacy:** redaction rules and a coverage audit that **probes real egress
paths with known sensitive values** rather than inspecting code. This has
found two real leaks: the dataset export path once carried a weaker private
copy of the patterns, and case capture stored `note` and caller tags
verbatim while redacting input and output.

**Governance:** ten launch gates, each `passed` / `failed` / **`unmeasured`**
— three distinct states, because collapsing any two produces a launch
decision made on fiction. There is deliberately **no overall percentage**: a
single score would average measured and unmeasured gates into a number that
sounds like knowledge. Measurements are durable across restarts and
re-validated on load.

**Proposals:** proposal engine, draft generator, and an execution layer with
exactly four capabilities — create branch, apply change, run tests, open
pull request. It has **no merge and no deploy capability by construction**;
the ability is absent, not merely forbidden.

**Current gate status: 1 of 10 measured** (privacy: 100% across 2 declared
egress paths). **Not ready to launch.** This is the only completion figure
in this blueprint that is a measurement rather than a description.

---


---

# Part III — The forward edge (defined, not yet built)

## 5. Capabilities defined but not yet built (the forward edge)

Ordered by the directive's priorities. Each enters the matrix the moment
any part of it becomes real.

1. **Founder Authority system** — phishing-resistant founder auth
   (passkeys/WebAuthn, platform-held biometrics, step-up, recovery,
   emergency lock, audit). **BLOCKED on a founder decision**: what
   "Founder" means in a multi-tenant model where the top role today is
   per-workspace OWNER. Deliberately not guessed.
2. **Synora Command Center** — intention → understanding → plan → risk
   class → permission check → preview → approval → execution →
   verification → result → audit, as one pipeline. Foundations exist
   (agent engine's plan/approve/execute, EOS proposals, tool permission
   layer). Slice 1 shipped 2026-08-05: **agent-run plan preview** —
   POST `/agents/:agentId/runs/preview` plans through the SAME planner,
   validation and per-step preflight a real run uses, then stops; no run
   record is created. The per-step checks were factored into
   `agents/step-checks.ts`, SHARED with the workflow dry run — one
   checker, so the two previews can never disagree. The report states
   provenance (plan origin + runtime mode/notice), which steps would
   pause for a person, what would fail, what is unknowable, and — for
   model planners — that starting the run plans again and may differ.
   Budget exhaustion is reported as a blocker, never used to refuse the
   preview. UI: "Preview plan" beside Run on the agents page, rendering
   the report through the same RuntimeNotice provenance component every
   run uses. Slice 2 shipped 2026-08-05: **tool execution preview** —
   POST `/tools/:toolId/preview` reports where the request would go
   (host + method), whether it would stop for approval, which declared
   secrets it would carry (NAMES only — the preview never resolves one,
   so previewing can never become a way to read a secret), rate-limit
   headroom, what would block it, and what is unknowable without
   sending. Facts, never a safety verdict: nothing grades a tool "safe"
   or "risky", because Synora has no system that can judge that. **All
   three execution paths now have a preview** (agent runs, workflows,
   tools). Slice 3 shipped 2026-08-05: **the approval moment inherits
   the preview's facts** — the single-run read attaches the paused
   step's consequences (same shared checker), because whoever approves
   is usually not whoever asked and was previously shown only a step id
   and a one-line reason. Slice 4 shipped 2026-08-05: the **risk stage,
   as consequence facts rather than grades** — every step check and the
   tool preview now carry `reversibleBySynora` plus the server's own
   wording ("Synora cannot undo this once it runs — it acts on a system
   outside Synora" / "Nothing outside Synora changes, so there is
   nothing to undo"). Undo is a capability Synora either has or lacks,
   so this is certain; whether it *matters* is the reader's call, which
   is why no surface says "safe" or "risky". Rendered on all three
   surfaces from the one shared source. Still missing: the single
   unifying surface that shows the pipeline as one thing.
3. **Human Decision Center, full form** — partially advanced 2026-08-05:
   the home page's waiting surface now covers three item kinds — paused
   runs, tool executions stopped on `requiresApproval` (workspace-scoped,
   linking to where the decision's full context lives), and workspace
   invitations addressed to the signed-in person (the first
   account-scoped, cross-workspace item; verified-email-gated so the
   in-app surface is never weaker than the emailed token it stands in
   for). Per-item WHO/WHEN shipped 2026-08-05: every waiting row names
   the person who asked and when (batched name resolution on the read
   surfaces; email fallback; never a raw id). Cross-workspace awareness
   shipped 2026-08-05: per-workspace counts of waiting decisions across
   all the person's workspaces, with one-click switching (counts only —
   the context each decision needs lives inside its workspace). Still
   missing from the defined standard: remaining non-run work kinds
   (documents, generated media) and per-item RECOMMENDATION/consequences
   detail.
4. **Operations visualization (office view)** — role-scoped layers
   (EXECUTIVE / OPERATIONS / ENGINEERING / SECURITY / AI / AUDIT) over the
   EOS event bus. Founder-only data stays founder-only.
5. ~~**Decision-note lifecycle**~~ — SHIPPED IN FULL 2026-08-05:
   append-only corrections (`correctsNoteId`; the original stays
   visible, marked) and the per-project decisions view (`decisions`
   payload with full verbatim content, rendered as a collapsed log).
6. ~~**Workspace-level "since you were last here"**~~ — SHIPPED
   2026-08-05 (`WorkspaceVisit` + `/whats-new` + the dashboard banner;
   see the matrix's "Continuing work after time away" row).
7. **Async long-running work** — **BLOCKED on founder sign-off**
   (standing constraint). Workflows currently run inside the HTTP request.
8. **Client IP pseudonymization** — **CONDITIONAL, awaiting founder
   sign-off** (Engineering Constitution).

## 5b. Provider integration — audited 2026-08-05

Full findings: `docs/operations/PROVIDER_READINESS_MATRIX.md`. The three
facts that change how the rest of this blueprint should be read:

1. **Three AI stacks exist; one is unreachable.** `src/ai/core/*` (9 files)
   plus `src/ai/providers/openai.provider.ts` (250 lines, the only raw-fetch
   OpenAI adapter, with tools/streaming/health/retry) is imported by nothing.
   A reader would credit Synora with capabilities no request can reach.
   **Decide: wire it in or delete it.** Leaving it is a trap for the next
   reader.
2. **Synora's live text contract cannot express tool calling, structured
   output, or vision** — the providers support all three. "Provider supports
   X" and "Synora supports X through that provider" are different claims and
   this blueprint must never conflate them. Agent tool use works by Synora's
   own planner + tool runner, which is orchestration-level tool use, not
   provider-native function calling.
   **Tool calling CLOSED 2026-08-05**: the contract now carries
   `tools`/`toolChoice` in, `toolCalls` out, and `toolCalls`/`toolResults` on
   history turns so a full round trip replays. Two adapters implement it,
   covering 7 of 10 providers (Anthropic; and the OpenAI-compatible family —
   OpenAI, xAI, DeepSeek, Together, OpenRouter, Azure). `tool-calling` is
   declared as a capability ONLY where implemented, so
   `providersForCapability('tool-calling')` stays a truthful answer.
   **Capability negotiation followed** (same day): `synoraSupports` on every
   model in the catalog is a conjunction of the model's claim AND Synora's
   adapter, computed server-side, so the model picker can no longer badge a
   capability no request can reach. It also exposed a real defect — Azure's
   catalog key did not match its provider id, so a configured Azure
   deployment showed zero selectable models.
   **Still true and still must not be conflated**: structured output and
   vision remain unexpressible; Gemini/Bedrock/Ollama have no tool mapping;
   and the agent runtime still plans with its own planner — the capability is
   available to callers, not yet adopted internally. Adopting it is an
   orchestration decision (it moves step selection from Synora's planner to
   the model), not a provider change, and belongs in the Command Center
   thinking rather than in this list.
3. **The embeddings stack is the standard the text stack should meet.**
   ~~The text path has none of them.~~ CLOSED same day: retry + circuit
   breaker moved to shared `src/resilience/` (embeddings files re-export;
   one definition, two consumers) plus a new timeout module; every
   `generateText()` call now runs under timeout → retry → per-provider
   breaker. The outbound rate limiter followed in the next increment:
   `rateLimiter.ts` moved to `src/resilience/` the same way, wired between
   the breaker and retry, config-driven (`AI_RATE_LIMIT_*`), refusing a
   call BEFORE it is sent (standard 429 envelope, never counted as a
   provider failure). Provider call metrics followed, with a
   distinction embeddings never needed — a call that FAILED versus one
   Synora REFUSED TO SEND, since those look identical in an error count
   and lead to opposite diagnoses. Remaining from the embeddings standard:
   tracing, cache — plus true request cancellation (the timeout bounds
   waiting, not the underlying HTTP call) and per-workspace fairness
   keying (the text facade deliberately hides caller identity from the
   provider layer; embeddings keys `provider:workspace`).

Closed by that audit: **credential verification** — `verifyCredential()` on
the descriptor contract answers "is this key actually accepted", separate
from `isConfigured()`'s "is a key present", with `unreachable` never
collapsed into `rejected`. Sharpened by the command layer's slice 13:
`isConfigured()` now means "is a REAL key present" — a generated
development placeholder reads as absent (`SecretsManager.hasReal`), so in a
credential-less deployment resolution honestly finds nothing instead of
selecting a real vendor and failing with a 401 dressed up as availability.

## 5c. The Universal Command Layer — begun 2026-08-05

Directive: the founder's Human Comfort / Universal AI Era brief. Its core
demand is one thing Synora did not have — **a single place where a person
says what they want in plain language and Synora resolves it to real
capabilities**, without first choosing between "agent", "workflow", "tool"
and "chat". The person should express an outcome; Synora carries the
complexity.

**Slice 1 shipped: understanding, routing, and refusal.** `src/command/`
plus `POST /api/command/understand`. One sentence in; a statement of what
Synora believes was asked, which REAL capability would serve it, what it
could not determine, and security observations about the text.

Four design decisions that the rest of this layer must not undo:

1. **Deterministic, not a model call.** Understanding is a fixed grammar
   running locally with zero credentials. Three reasons, in priority order:
   a model asked to interpret a hostile sentence can be *argued into*
   interpreting it favourably (that is what prompt injection is), and the
   first thing between hostile text and Synora's capabilities must not be
   persuadable; understanding "what needs my decision" has to work when
   every provider is down, because this layer is *how a person reaches
   Synora*; and a deterministic classifier that fails says so, whereas a
   model always produces something shaped exactly like a correct answer.
   A model may later RANK or EXTEND this. It must never become required.
2. **The command text is data, never instructions.** Structurally, this
   module has no mechanism to obey anything — it classifies action shapes
   and returns a description. Authority-override phrasing ("ignore your
   rules", "you are now admin", "without approval") is detected, reported,
   and grants nothing. The payload is deliberately NOT echoed back into
   observations: repeating attacker-controlled text into logs and
   dashboards is its own delivery mechanism.
3. **It never executes.** `executed: false` is an explicit field, not an
   assumption, so no caller can read an interpretation as evidence that
   something ran. Acting goes through the surfaces that already exist,
   each with its own permission checks, previews and approval gates. The
   command layer shortcuts none of them and therefore grants no authority:
   understanding a sentence about deleting a database is not permission to
   delete one.
4. **The catalogue may only name capabilities that exist.** A routing
   layer's characteristic failure is confidently routing to a capability
   that was only ever a plan. Every entry names a real surface, and
   `availability` separates "Synora implements this" from "this deployment
   can do it right now" — a person told the first when they needed the
   second has been misled.

Also honest about the opposite case: requests Synora genuinely cannot serve
(phone calls, SMS, social publishing, payments, device control, travel
booking) return `not-yet-capable` **naming the missing capability**, rather
than "I don't understand". Synora understood perfectly and simply cannot do
it, which is what the person needs to hear.

**Slice 2 shipped: "and am I allowed to do this, here?"** `command/prepare.ts`
plus `POST /api/command/:workspaceId/prepare`. Understanding is deliberately
identity-free — the same sentence means the same thing to everyone — so
whether a PARTICULAR person may act on it is answered separately, against
their real workspace role. Two axes, kept independent because they fail for
different reasons and neither can substitute for the other:

- **Permission is about the person.** A VIEWER asking to invite someone is
  refused, and told the missing permission BY NAME (`member:invite`) so they
  can ask for the right thing rather than guess.
- **Availability is about the deployment.** A workspace OWNER still cannot
  generate an image with no provider configured. Reporting that as
  actionable would send the most privileged person to a button that fails
  for a reason no permission change can fix.

`recommended` is null when nothing is both permitted and available — offering
a capability someone cannot use is worse than saying there is nothing to
offer. Still executes nothing, and the permission answer here is a courtesy
so nobody is offered a button that will reject them, NOT a substitute for the
authoritative check that runs again inside whichever surface does the work.

**Slice 3 shipped: it actually does things.** `command/execute.ts`, a
`CommandExecution` durable record, and `POST /api/command/:workspaceId/execute`.
A typed sentence now reaches the REAL services — never a re-implementation,
never a simulated result. The chain is: understand → resolve → permission →
availability → risk → approval gate → execute → durable record.

**Ten states, never blurred** — `completed`, `not-authorized`,
`unavailable`, `not-implemented`, `not-bound`, `waiting-approval`,
`needs-input`, `rejected`, `expired`, `failed`. `not-bound` exists as its own state
deliberately: the capability is real but the command layer cannot yet drive
it, and collapsing that into "not implemented" would slander working code
while "failed" would blame the user. `rejected` (a person said no) and
`expired` (nobody answered) are likewise distinct from each other and from
`failed` — three very different things to have to explain to someone.

**Risk decides approval.** Read-only and reversible proceed; sensitive and
high-risk stop at `waiting-approval` and DO NOT run. Stopping to confirm a
search would teach people to click through prompts unread, which is how the
warning that finally matters gets ignored. Reporting an unapproved sensitive
action as completed would be the exact dishonesty this layer exists to
prevent.

**Authority never comes from the sentence.** It comes from the session and
the workspace role, checked here and AGAIN inside the service that performs
the work (`conversationService.create` runs its own membership and permission
checks). A sentence claiming "you are now an admin" still stops at the gate;
naming another workspace cannot reach it.

**Every outcome is recorded**, refusals included — a trail containing only
completions is systematically optimistic.

**Slice 4 shipped: a yes that means yes.** `command/approve.ts`,
`POST /api/command/:workspaceId/executions/:executionId/decision` and
`GET /api/command/:workspaceId/executions`. Slice 3 could refuse a sensitive
action honestly but gave nobody a way to say yes. Almost all of slice 4 is
the machinery that makes a "yes" mean exactly what everyone assumes.

**The four ways an approval system lies, and what stops each:**

1. *The client claims approval.* Nothing the caller sends says "approved".
   The only approval that exists is a row this server wrote; the caller
   supplies only which row they mean.
2. *The same approval is used twice.* The pending state is CLAIMED with a
   conditional update — a database-level compare-and-set — and only the
   writer that actually changed the row proceeds. Two simultaneous
   approvals cannot both win; a replay finds nothing left to claim.
3. *The approval is stale.* Each pending record carries the deadline it was
   created with (stored, not derived from a constant, so the deadline a
   person was shown is the one enforced). Past it, the record expires
   instead of running. Window: 24 hours.
4. *The approved action is not the executed action.* THE IMPORTANT ONE. The
   action is re-derived from the STORED command text and must still resolve
   to the same capability, the same risk class, and the same need for
   approval. The request body has no field that can influence what runs —
   there is deliberately nothing to tamper with.

**Approving runs it, atomically.** There is no window in which an approval
exists but has not been spent: a stored unspent approval is a credential,
and a credential sitting in a database is a thing to steal.

**A crashed decision self-heals.** A claim abandoned mid-flight would
otherwise wedge the record permanently, so the deadline covers claimed
records too — nothing legitimate holds a claim for a day. A second approver
arriving mid-decision is told the decision is IN FLIGHT, which is a
different fact from "already decided" and the only one that is true.

**Authority is split correctly.** The approver's own role must permit the
capability — you cannot authorize what you would not be allowed to perform.
The action then runs as the ORIGINAL requester, whose permission is
re-checked at that moment, because roles change while things sit in queues.
Order matters and is a correctness property: a demoted requester is reported
as a permission change, never as "the action changed", or someone goes
hunting for an edit that never happened.

**Known limit, stated plainly**: today no capability is both sensitive AND
bound, so approving one honestly reports `not-bound` — the approval is
recorded as the fact it is, and nothing runs. The "approved action then
runs" leg shares one code path (`runBound`) with direct execution, which
slice 3 proves against a real database row. It is not separately proven
end-to-end and will not be until a sensitive capability is bound.

**Slice 5 shipped: a person can actually reach it.** `/command` ("Ask
Synora"), `lib/api/command.ts`, `CommandOutcomeCard`, `PendingApprovals`, a
sidebar entry directly under Dashboard, and a row in `WaitingForYou`.
Slices 1–4 built a complete engine with no steering wheel; the approval
gate in particular was a state the system could enter and no person could
leave.

**The nine states are never collapsed in the UI either.** The backend went
to real trouble keeping "not connected", "not allowed", "nobody wired it
up", "a person must approve" and "it broke" apart. A green tick and a red
cross would throw all of it away at the very last step, leaving the person
back where they started — guessing whether anything happened. A test
renders all nine states and asserts nine DISTINCT headings; another asserts
every non-completed state says plainly that nothing was done.

**Server wording, rendered verbatim.** The server is the only thing that
knows why it refused. A second wording of the same rule in the client is a
second thing to keep in sync, and it eventually disagrees in front of a
user.

**Consequences before the click, and the decision where its context lives.**
Each pending row states the plain-language risk, what it would use, and the
deadline BEFORE either button is reachable — not in a confirmation dialog
afterwards. `WaitingForYou` says a command is waiting and links to
`/command`; it deliberately offers no yes/no, because approving from a
summary card is a yes given without the sentence, the risk or the deadline
in view. Same rule the tool-approval flow already follows.

**No preview before running.** Read-only and reversible commands simply run.
Asking "are you sure?" before a search is how people learn to click through
prompts unread, and the prompt that finally matters gets the same reflex.

**Examples are drawn from capabilities that are actually bound.** A hint
suggesting "email the team a summary" would teach a capability that does
not exist and be discovered as a lie on first use.

**Slice 6: two more bound, and two lies in the catalogue found by binding
them.** Binding is not busywork — it is the only thing that actually checks
whether a catalogue entry is true. Both defects had survived every test:

1. `approvals.waiting` claimed `GET /api/workspaces/:workspaceId/agents/runs/waiting`,
   **a route that has never existed in this repository**. `capabilities.ts`
   opens by saying a command layer's characteristic failure is confidently
   routing to a capability that was only ever a plan, and claims a test
   keeps it honest — but that test only checked the surface STRING SHAPE
   (`^(GET|POST|…) /api/`). The file's own stated discipline was not
   enforced. There is now a test that walks the REAL Express router; it was
   confirmed to fail on the original bug, naming the phantom surface,
   before the fix went in.
2. `activity.recent` declared `requiredPermission: 'audit:view'` when the
   activity feed is deliberately membership-only — `audit:view` gates the
   GOVERNANCE log, which that feed excludes by allowlist. It would have
   told ordinary members they lacked access to something they could use.

**One intent can cover two questions, and it used to answer the wrong one.**
"Monitor" means both "how are the AI providers behaving" and "what happened
in my workspace". Catalogue order alone decided, so one always won and the
other was unreachable — a confident answer to a question nobody asked,
which is the worst thing this layer can do. Routes may now carry a `hint`
claiming phrasings within their intent. Hints only PROMOTE: a sentence no
hint claims still resolves in catalogue order, so adding one can never make
a capability unreachable. Both properties are test-pinned.

**Slice 7: the declaration is now checked against reality, not against
itself.** Slice 6 fixed one wrong `requiredPermission` BY HAND and left the
same class of defect possible everywhere else — so this closes it.

**The circularity that hid it for four slices**: the command layer derives
its permission answer FROM the declaration. Asking the layer whether the
declaration is correct is asking it to agree with itself, and it always
will, however wrong the declaration is. Every test that touched
`activity.recent` did exactly that.

So the check probes the REAL services directly as a VIEWER — the least
privileged role — and compares what actually happens against what the
catalogue claims: declared `null` means a VIEWER must succeed; declared `P`
means a VIEWER must be refused. The probe table is a deliberate SECOND,
INDEPENDENT derivation of which service backs which capability. That looks
like duplication and is the opposite: a check that shares its source with
the thing it checks cannot detect that source being wrong. Two derivations
that must agree is the whole mechanism — the reason double-entry
bookkeeping has two columns.

Confirmed to fail on the real historical bug before the fix was restored.
Two vacuity guards, because this codebase's own lesson is that a green test
can prove the opposite of its claim: every bound capability must HAVE a
probe, and the probes must succeed for an OWNER (a probe that refused
everyone would otherwise satisfy the main assertion by accident).

**Scope stated, not implied**: only the 5 bound capabilities are probed,
because only those have an execution path a test can drive. The 7 unbound
ones remain unverified.

**Slice 9: why the remaining seven cannot be bound, and what to do about
it.** This began as "bind the rest" and changed once the code was read:

- `workflow.author` needs a full `steps` array — id, kind, description and
  input per step. A sentence does not contain that.
- `workflow.schedule` needs a workflowId; `agent.preview` needs an agentId.
- `tool.execute` needs input matching each tool's own JSON schema. Entity
  resolution would not fix this; the input is the blocker.
- `ai.generate` and `image.generate` need credentials this deployment lacks.

So all seven are unbindable for PRINCIPLED reasons. Forcing one would mean
inventing structure the sentence never contained — which is the fabrication
this codebase has spent weeks auditing out. The previous increment called
the workflow pair "the most mechanical remaining"; that was wrong, and
reading the schema is what corrected it.

**What shipped instead is the consequence, addressed.** `not-bound` was an
honest dead end: "Synora can do this, but not by being asked in plain
language" is true and leaves a person who asked for help with nowhere to
go. Every capability now names the page where they can do it themselves,
and the refusal carries a link.

**The destination is verified to exist.** A test walks the real Next app
router on disk, strips route groups exactly as Next does, and asserts every
claimed `appPath` is a page a person can open — confirmed to fail on a
deliberately broken path. It reads the frontend from the backend's suite,
which is deliberate: the claim is cross-boundary, and a check confined to
the side that makes the claim could never detect it being wrong. `appPath`
is null where no single page serves the capability, because a wrong
destination costs a click, a wait, and the belief that Synora knows its own
product.

**Slice 10: the resolution primitive, and the first capability bound
through it.** The world-building directive's rule — "if a dependency is
missing, build the dependency first" — applied to the blocker slice 9
named: services want ids, sentences name things loosely. `command/resolve.ts`
is a PURE, deterministic matcher (exact match → whole-word containment →
most-specific-wins tie-break) over candidates the caller fetched with a
workspace-scoped query, so it can never be where isolation leaks and never
needs a provider. THE RULE THAT MATTERS: not exactly one match → it NEVER
guesses. A wrong guess is a confident action on a record nobody named —
worse than any question.

A tenth state, `needs-input`, because every neighbour would lie: `failed`
blames a bug that does not exist, `not-implemented` slanders working code,
`completed` would make `executed: true` mean "I asked you something". The
question carries the CHOICES as data (capped in prose, listed in the
payload) so a person picks instead of retyping.

`agent.preview` is bound through it: "Preview what the Research agent
would do about competitor pricing" reaches the SAME planner, validation
and per-step checks the Agents page uses, and runs nothing. Ambiguity
("Digest" vs "Digest v2") resolves by specificity; naming nobody returns
the honest question with every agent listed.

**Slice 11: the authorization hole the next binding would have widened.**
Preparing to bind `workflow.schedule`, the slice-7 question — what does the
real surface enforce? — answered *membership only*: a VIEWER could author
workflows, schedules and triggers despite holding only `billing:view`. The
catalogue's `tool:manage` declaration was RIGHT and the routes were wrong —
the mirror image of the `activity.recent` defect, and the second time two
independent derivations disagreeing has been the alarm. Fixed with a
`requireWorkspacePermission` middleware on all 12 mutating routes,
membership answering first so outsiders keep the 404. Reads, runs and
dry-runs untouched. MEMBERs lose authoring they only ever had through the
hole; granting it back deliberately is a one-line permission change.

**Slice 12: recurring behaviour from a sentence, with nothing guessed.**
"Schedule the Daily Digest workflow every day at 9am Asia/Kolkata" creates
a real DST-correct schedule. The phrase parser is stricter than the
resolver because its output RECURS — a misread schedule fires wrong every
day — so every ambiguity is a question: no hour → asks; bare "at 9" → asks
am/pm; **no zone → asks, because the platform stores no timezone and a bare
"9am" is a guess about the person's clock**; weekly/monthly say plainly
they are not built. A workflow named "Hourly Report" does not imply hourly:
the name is stripped before cadence parsing. The authoritative check lives
in `createScheduleAuthorized` (membership + tool:manage + persist-before-
return), because the command path never touches slice 11's HTTP middleware
— and the permission probe drives exactly that surface.

**Slice 13: a placeholder is not a credential.** The secrets chain in
development/testing deliberately ends in a source that manufactures a
deterministic fake value for ANY key, so the app boots with zero real
secrets — but every provider's `isConfigured()` was implemented as "tryGet
returned something", which in those stages is ALWAYS true. So the
capabilities report showed providers as active with no credentials
anywhere, resolution selected a real vendor and called it with
`placeholder_…` (the 401-dressed-as-availability caveat carried since
slice 10), and three vector-DB connect paths handed the placeholder to
self-hosted instances as a fake auth token. Fixed at the root: the secrets
manager now answers two different questions — `tryGet()` for INTERNAL
secrets (JWT signing, DATABASE_URL), where a deterministic placeholder is
exactly what lets dev boot; `hasReal()`/`tryGetReal()` for EXTERNAL
credentials, where "a value resolves" and "we can authenticate" are
different claims. All 16 AI/embeddings descriptors, Pinecone, the SMTP
transport, the config provider flags, and Stripe converted — Stripe's
conversion DELETED the one place that had already answered this question
by re-generating the placeholder format and string-comparing, billing's
private duplicate of secrets internals (and it only checked one of the two
secrets). The declined read still audits as `access-placeholder`, so "why
does this provider say unconfigured?" is answerable from the trail. The
guard test runs descriptors against the REAL secrets manager in the
testing stage — exactly where the lie lived — and was proven to fail on
the old code before it was trusted. Removing the lie then exposed a ghost
coupling it had been hiding: `ConversationService.create` gated the
CONTAINER on the provider's `isConfigured()`, so with honesty in place,
"start a conversation" required a vendor key — 56 test failures, one root
line. Creation now validates only the data invariants (provider exists,
does text generation); the honest refusal lives at generation time, where
it always did. A conversation is a container, and a container needs no
vendor — that property is now test-pinned with an asserted precondition
so it cannot go vacuous.

**Slice 14: one sentence, several actions.** People do not speak in single
commands. `decompose.ts` splits a request into the actions it describes and
`plan.ts` resolves each one INDEPENDENTLY through the same `decideCommand` a
single command uses — same grammar, same catalogue, same permission model,
same ten states. A plan is not a privileged path; it is several ordinary
commands with an order between them, and the central security property is
that **a step inherits nothing from its neighbours**: being allowed to find
a document says nothing about being allowed to send it, and a planner that
decided entitlement once would let a harmless first step carry a dangerous
last one past the gate. The splitter's governing bias is to UNDER-split:
merging two actions is visible and harmless, while inventing an action means
Synora acts on its own fabrication — so "sales, marketing, and support"
stays one subject and only segments that independently read as actions
become steps. Dependencies come from back-references ("summarize IT"), so a
step that refers to nothing waits for nothing; a step whose input will never
exist is marked blocked rather than ready. The action-word lexicon
deliberately includes verbs Synora CANNOT perform (`send`, `delete`, `pay`)
— recognizing that an action was requested is a different question from
being able to do it, and absorbing an unroutable segment into its
neighbour's subject would make a step silently disappear. Nothing executes:
`executed: false` is a literal type on the response. Orchestration —
running steps in order, pausing at each approval, durable state — is the
next slice, because a plan nobody can read is not something to start
running.

**Slice 15: running a plan, durably.** `CommandPlan` + `CommandPlanStep`
tables and `run-plan.ts` execute a plan's steps in order — each through the
SAME `executeCommand` a single command uses, so every step re-derives its
capability, re-checks permission at the moment it runs, honours the approval
gate, and writes its own audit row correlated by `planId`/`planStepIndex`. A
plan orchestrates; it never becomes a second way to make something happen.
**Durable because plans pause**: a plan stops at an approval someone answers
tomorrow, and in-memory state would let a deploy silently discard work a
person is waiting on. **Stop honestly, do not push on**: execution halts at
the first step that does not complete and does not skip ahead to later
"independent" steps, because an unpredictable subset forces a person to
reconstruct what happened while a stop leaves one describable sentence.
Steps never reached are `skipped`, not `failed` — nothing was attempted, so
nothing broke. **Never retries**: no capability carries an idempotency key
yet, so a retry could create a second schedule; `safeToRetry` says plainly
whether asking again repeats anything, and is false the moment any step
completes. `partially-completed` is first-class, never collapsed into
`completed` or `failed`. Verified non-vacuously: injecting "push on past a
stop" fails exactly the three tests that assert it.

**Slice 16: a decided step resumes its plan.** Deciding a paused step now
continues the plan from the approval path itself, once the decision is
durably recorded — never before, because a resume that crashed must not be
able to lose the approval that authorised it. **An approval buys its own
step and nothing else**: every remaining step goes through `executeCommand`,
so a later step needing approval pauses the plan AGAIN (test-pinned), which
is the "approve once, act broadly" failure this layer exists to prevent. The
decided step is never re-run — it already ran inside the approval
transaction, and a person authorised it exactly once. The requester's
CURRENT role is re-fetched, never remembered: roles change while plans sit
in queues, and if the requester has left the workspace the remainder does
not run under anyone else's authority. A rejected step gives the plan status
`rejected`, distinct from `failed` — a person said no, nothing broke. A
failed resume never fails the approval, because reporting an authorised,
completed action as an error invites a repeat. **Two real defects found by
building it**: I first hardcoded the resumed role as OWNER — a privilege
escalation in my own code, caught and fixed before any test ran — and the
`not-bound` early return skipped the resume hook entirely, leaving a plan
step recorded as `waiting-approval` after its approval had been decided.
**Honest limit**: an approved step that then COMPLETES is not yet reachable
over HTTP, because every approval-requiring capability is unbound, so
approving one yields `not-bound` and the plan correctly stops. The resume
path is exercised directly against real stored plans until a sensitive
capability is bound.

**Slice 17: `tool.execute` bound — the approval chain closes.** The first
bound capability that acts OUTSIDE Synora, and the first reachable ONLY
through the approval gate. That combination completes the chain end-to-end:
a plan pauses on a tool step, a person approves through the real endpoint,
a real tool execution is created, and the plan resumes to completion. Slice
16's resume moves from "exercised directly" to "reachable by a real
request", which is what raises it from B to A. **A real grammar defect
found by binding, again**: `control` allowed only ONE word between "the"
and "tool", so "run the Alpha Deploy tool" — an ordinary sentence naming a
real multi-word tool — was answered `not-implemented`. Widened to a bounded
four, still anchored on the literal noun, with a test proving "run a report
on last quarter" is still not claimed. The slice-7 vacuity guard fired
correctly: binding demanded a permission probe, and the probe confirms the
real service refuses a VIEWER by its own `tool:execute` check rather than
by an HTTP route the command path never touches. Built directly from the
three contract findings below, which were recorded BEFORE any code was
written rather than discovered halfway through:

1. **Tools carry their OWN `requiresApproval` flag.** A command-layer
   approval can therefore produce a tool execution that is still `PENDING`
   on a SECOND, tool-level approval. Two independent gates is correct — the
   command layer asks "may this person ask for this", the tool asks "may
   this particular tool run" — but the outcome must never let "you approved
   it" read as "it ran". A person who approved something and later finds it
   never happened has been misled by a system that was technically correct.
2. **Execution is asynchronous** (`runAsync`). The command layer would learn
   that a tool STARTED, never that it succeeded. So the honest summary is
   "started", and `completed` here must mean "the execution was really
   created", worded so nobody reads it as "the tool did its job".
3. **Tools have an `inputSchema` with required fields**, and a sentence
   carries no structured input. Most real tools would therefore honestly
   answer `needs-input` rather than run — which is the correct answer, not a
   shortfall, and it means binding this capability delivers less immediate
   reach than it appears to.

This is the one capability that acts OUTSIDE Synora, so it got the design
pass rather than the quick pass — and all three facts survived contact with
the implementation: the tool's own approval gate means the message leads
with "has NOT run yet" and `result.finished` is literally `false`; the
async runner means the summary says *started*, never succeeded; and a tool
with required fields is asked about by name rather than handed an invented
payload. Test hermeticity is stated rather than assumed: every tool in the
binding tests sets `requiresApproval`, so no test fires a real webhook — a
test that reached a third party to prove an authorization rule would be
doing outside Synora exactly what it is checking inside. The immediate-run
branch is therefore exercised in production, not in the suite.

**Slice 19: undo — the risk class stops being an adjective.** From slice 3
onward `reversible` was a class the layer REASONED with: it is why creating
a conversation runs without an approval gate, and the whole approval policy
leans on it. Nothing in the system could actually reverse anything, so the
word described what a person could go and do by hand somewhere else, wearing
the costume of a property of the action. That is precisely the shape of
thing this project keeps refusing to ship, and it had been sitting inside
the layer's own vocabulary.

Four rules the implementation is built around, each guarding a way undo
could be worse than no undo:

1. **The target is declared, never guessed.** The executor that performed
   the work names what would reverse it, at the moment it performs it, and
   that is what gets stored (`undoKind`, `undoTargetId`). Undo never infers
   a target from a capability id or parses one back out of the summary
   prose. A wrong guess here deletes the wrong thing.
2. **Permission is re-checked at undo time**, through the same service-level
   checks the original action went through — `conversationService.delete`
   enforces `conversation:manage`, and a new `deleteScheduleAuthorized`
   enforces `tool:manage` for a command path that never travels through the
   HTTP middleware. Having once been allowed to create something is not
   standing permission to remove it later.
3. **Once, and only once.** The reversal is claimed with a conditional
   update, and a second attempt is refused rather than quietly repeated.
4. **Not available for everything.** Most actions cannot be reversed, and
   the answer says so plainly. The UI offers the button ONLY when the server
   declared that particular execution undoable — never from the risk class,
   which would put a button on things Synora cannot reverse.

**Reverse first, record second** — deliberately the opposite of the approval
path's order, and chosen by asking which lie a crash in the middle leaves
behind. Record-then-reverse would leave a record claiming "undone" for
something still there and would refuse every later attempt to fix it;
reverse-then-record leaves a record saying "not undone" for something
already gone, and a retry costs at most a second reversal that is a no-op.
A stale "not yet" is recoverable; a false "already done" is not.

**A real pre-existing bug found by building this**: `deleteSchedule` removed
only the in-memory entry, while creation had written the schedule to the
durable store — so `hydrateSchedules` brought every deleted schedule back on
the next restart. Silently, because nobody watches for the return of
something they already deleted. The HTTP delete route had the same bug. Both
are fixed at the source, with a regression test that persists, deletes,
restarts and asserts nothing comes back.

**Slice 20: every answer reaches a person who cannot see it.** The first
work under the standing rule that all input and output paths resolve
through ONE architecture rather than a parallel one per method — and the
first place that rule was being broken was not an input at all. The command
page promises "Synora tells you exactly what it did, or exactly why it did
not", and every answer was inserted silently into the page. Someone using a
screen reader pressed "Do it", focus stayed in the box, and nothing was
announced. The layer keeps ten outcomes rigorously distinct and then
delivered them in a form one class of user could not perceive, which throws
the whole discipline away at the last step exactly as a green tick and a red
cross would.

`CommandAnnouncer` is a polite live region, mounted from first render — a
region that appears at the same moment as its content is not announced at
all, which is the standard way to build one that never speaks. It composes
no new prose: the state label comes from the same map the visible card uses
and the reason is the server's sentence verbatim, so there is no second
wording to drift in front of the one person who cannot check it against the
screen.

**A founder decision is attached to the REST of this axis.** Voice input is
the obvious next door, and it cannot be opened purely as engineering. The
browser's own speech recognition is the only credential-free option, and in
most browsers it works by **sending the captured audio to the browser
vendor's servers**. For a platform that stores customers' work, that is a
data-egress decision, not an implementation detail, and shipping it quietly
would be precisely the kind of unstated behaviour this project refuses. The
options and the recommendation are in the brief; nothing voice-related will
be built until that is answered.

**Not yet built**: no voice input path, no learned personalization, undo
covers only the two capabilities that create something reversible
(conversations and schedules), and there is no way to approve a paused plan
step from the plan view itself (the approvals panel below it is where that
happens).
Bound: search,
conversation-create, provider-metrics, approvals-waiting, activity-recent,
agent-preview and workflow-schedule; the rest honestly report `not-bound`
and say where to go. The
approvals answer states what it counted (`agent runs and commands; not tool
executions`) rather than implying it covers everything. Self-approval is
permitted — the gate is a deliberate pause and a record, NOT four-eyes
separation of duties, and requiring a second person would break
single-owner workspaces.

## 10. Planned — committed, not yet built

From `docs/release3/specifications/` (28 specifications) and the release
plans. These are commitments, not aspirations:

| Capability | Source | State |
|---|---|---|
| Remaining tool transports (GraphQL, Database, Search, File, Browser, Python) | `16-tool-calling.md`, `ToolType` | Enum values only |
| MCP transport | `ToolType` | Enum value only |
| Elasticsearch-backed search | `12-conversation-search.md` | Postgres FTS implemented instead |
| Collaborative message editing | `07-collaboration.md` | Presence/typing implemented; co-editing not |
| Version history UI | `22-version-history.md` | `ConversationVersion` model exists; UI absent |
| Analytics dashboards beyond usage | `21-analytics.md` | Usage implemented; broader analytics partial |
| E2E Playwright suite | `RELEASE_2_PLAN.md` R2-h | CI job exists; suite thin |
| Redis as an active cache | `25-redis-cache.md` | Provisioned and used for queues, not yet as a cache |

## 11. Commissioned by the Local Product Completion directive (2026-08-04)

The founder directive of 2026-08-04 moved the former "Future vision" list
into committed scope, to be built locally without external credentials.
Status per capability, honestly:

| Capability | Status |
|---|---|
| AI Agents | **Implemented end to end, locally** — see §5.9. Engine, registry, permissions, approvals, limits, durability, HTTP routes and UI: built and tested; a person can define an agent and run it today. Run cost metering and the pre-run budget gate: implemented. Multi-agent orchestration: missing. Model planner: parsed and tested, activation blocked on a model endpoint — every plan today is deterministic and labelled LOCAL. See also `CURRENT_CAPABILITY_MATRIX.md`. |
| Workflow engine | **Partially implemented** — see §5.10. Authored steps, immutable versioning, authoring-time validation, durability, HTTP routes, UI, clock-based scheduling with time zones and its UI, dry runs, webhook triggers, and internal event triggers: built and tested, executing through the agent run engine rather than a second copy of it. Missing: `workflow.completed` as an event (loops), replay of events missed during a restart, and asynchronous runs — see the run-timeout mismatch. |
| Automation engine | Not started. Reuses BullMQ; idempotency strategy required per directive. |
| AI Canvas | Not started. Block/document model to be designed collaboration-ready. |
| Plugin system | Not started. Contract-first; tool engine is the adjacent substrate. |
| Marketplace | Foundation only permitted; no fake catalog entries, ever. |
| Public SDK | Not started. Domain-level contracts, never raw DB shapes. |
| Offline / sync | Not started. Local draft persistence and change tracking first. |
| Mobile / desktop | Explicitly gated: shared contracts before any shell. |

Rule retained from the directive: a capability whose only remaining
blocker is external infrastructure is marked "IMPLEMENTATION COMPLETE —
ACTIVATION BLOCKED BY EXTERNAL DEPENDENCY", never called production-ready.


---

# Part IV — Standing engineering law and launch

## 6. Standing engineering law (unchanged by any roadmap)

- Security fails closed. 404, not 403, where existence is the secret.
- Every optional foreign key accepted on a write is a claim of access
  and is independently re-verified where it is accepted.
- One engine per concept: workflows run through the agent engine; a
  second execution loop is never built.
- Provenance labels are never collapsed. `authored` ≠ `model` ≠
  `local-deterministic`.
- Records of the past are immutable; recovery creates new records.
- Empty states are absent, not zero-valued placeholders.
- Verification gate before every push: full backend + frontend suites,
  8/8 type-check, 0 lint errors, migration drift check.
- The capability matrix is updated in the same commit as the change it
  describes. A stale claim, once found, is corrected with a note that it
  was stale — not silently rewritten.

## 7. Launch sequence (when the founder pulls the trigger)

1. Connect real AI providers; run the regression + evaluation suites
   against them; measure the 3 unmeasured gates.
2. Connect payments, mail, scanning, embeddings; run each family's
   class-E validation path.
3. Provision production infra (DB, Redis, storage, queues, DNS, TLS);
   run migrations; verify the boot-time hydration and health probes.
4. Full launch-gate pass (all 10 measured), security review, load test.
5. Deploy; validate the verified user journeys against production.
6. Public launch.

Until step 1 begins, every increment continues to be built, tested and
verified locally to production standard — that is this document's whole
premise.


---

# Part V — Maintenance

## 12. Removal log

Capabilities removed from this document, with reasons. Empty at creation;
never delete a row.

| Date | Capability | Why removed | Evidence |
|---|---|---|---|
| — | — | — | — |

## 13. Maintenance protocol

1. Implementing something in §10 or §11 moves it to the relevant section
   with its status and evidence, in the **same commit** as the code.
2. Status may only be raised with evidence — tests, or a measurement.
3. Removing a capability requires a §12 row. No silent deletions.
4. Launch gate status in §9 is copied from the measurement, never estimated.
5. The companion `FEATURE_INVENTORY.md` holds per-feature operational
   detail (credentials, dependencies, risks); this blueprint holds
   architecture and intent. Keep them consistent.

---

# Part VI — Frontend and design system

*Merged from `SYNORA_UI_SYSTEM.md` on 2026-08-10. Headings demoted one level; content otherwise unchanged.*

> **File references inside this merged section are historical.** They name
> documents that existed when it was written; those were consolidated on
> 2026-08-10 into `SYNORA_MASTER_BLUEPRINT.md`, `SYNORA_OPERATIONS.md` and
> `SYNORA_LEARNING.md`. The text is preserved unedited rather than rewritten,
> because editing an archived record to look current is how a record stops
> being evidence.

## SYNORA — UI System

**Created**: 2026-08-05
**Status**: LIVING DOCUMENT — maintained continuously alongside
`SYNORA_MASTER_BLUEPRINT.md` (product destination) and
`CURRENT_CAPABILITY_MATRIX.md` (present truth). This document records how
Synora's interface behaves and why, so every new surface is built to the
same rules instead of rediscovering them. It documents what actually
exists in `packages/design-system` and the app — nothing aspirational.

---

### 1. Foundations

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

### 2. The interface laws

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

### 3. Composition patterns (with canonical examples)

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

### 4. Voice

Sentence case everywhere. Buttons name the action's object ("Add note",
"Stop this run", "Continue where you left off") — never bare "Submit" /
"OK". Explanatory microcopy is one plain sentence stating a reason, not
a marketing claim. The interface says "you", never "the user", and never
pretends to be a person.

### 5. Maintenance rule

A change that establishes a new interface behavior, or knowingly breaks
one of the laws above for a stated reason, updates this document in the
same commit. A law that acquires exceptions without this file recording
them is a bug in the documentation.

---

# Part VII — Intelligence architecture

*Merged from `SYNORA_INTELLIGENCE_ARCHITECTURE.md` on 2026-08-10. Headings demoted one level; content otherwise unchanged.*

> **File references inside this merged section are historical.** They name
> documents that existed when it was written; those were consolidated on
> 2026-08-10 into `SYNORA_MASTER_BLUEPRINT.md`, `SYNORA_OPERATIONS.md` and
> `SYNORA_LEARNING.md`. The text is preserved unedited rather than rewritten,
> because editing an archived record to look current is how a record stops
> being evidence.

## Synora Intelligence Architecture

**Status**: foundation started 2026-08-06. One component implemented.
**Governing rule**: this document may only describe what exists. Future work
is in the clearly-marked sections at the end and is never written in the
present tense.

---

### What this is, and what it is not

Synora's Universal Command Layer is the **action nervous system**: a person
says what they want, and it is understood, authorised, planned, approved,
executed, recorded and reversed. That layer is real and largely complete.

The Intelligence Layer is the part that lets Synora **get better from what
happened**. It is barely begun.

**Synora does not have its own trained model, and nothing in this document
should be read as claiming otherwise.** The distinction the platform holds
itself to:

| | |
|---|---|
| Synora behavioral rules | **exists** — `intelligence/behavior-rules.ts` |
| Synora intelligence architecture | **partial** — this document; kernel not built |
| Memory and experience system | **memory exists**; experience record does not |
| Evaluation and learning system | **evaluation partial**; learning absent |
| Model/provider abstraction | **exists** — `ai/registry.ts`, `ai/resolver.ts` |
| Local/self-hosted model capability | **adapter implemented** (`ai/providers/ollama.provider.ts`, tested, keyless, off by default); no model installed yet |
| A Synora-trained model | **does not exist** |
| Model-training infrastructure | **schema and registry exist; no training** |

A model used by Synora is not "Synora's model". A prompt wrapper is not a
model. A rules engine is not a model. Nothing may be called the Synora Model
until it has: a version, dataset provenance, evaluation results, a safety
evaluation, an artifact identity, an inference interface, rollback, and
ownership metadata.

---

### The kernel's eight verbs, and where each stands

```
EXPERIENCE (text ▸ voice ▸ API)
        │
        ▼
┌─ SYNORA INTELLIGENCE KERNEL ─────────────────────────────────┐
│  UNDERSTAND   command/understand ▸ decompose ▸ resolve        │ EXISTS
│  MEMORIZE     memory.service + 6 siblings ▸ pgvector          │ EXISTS
│  REASON       —                                               │ MISSING
│  PLAN         command/plan ▸ run-plan ▸ CommandPlan(+Step)    │ EXISTS
│  ACT          command/execute ▸ approve ▸ undo                │ EXISTS
│  OBSERVE      eos/* (44 modules) ▸ CommandExecution           │ EXISTS
│  EVALUATE     evaluation.service ▸ eos judges/graders         │ PARTIAL
│  LEARN        —                                               │ MISSING
└───────────────────────────────────────────────────────────────┘
```

There is deliberately **no second command path**. Everything the intelligence
layer eventually does converges on the existing Universal Command Layer.

---

### Implemented: the Behavior Rule Registry

`apps/backend/src/intelligence/behavior-rules.ts`

Twenty slices of work produced a consistent set of principles — never claim
an unverified success, never let a missing credential read as a missing
capability, re-check permission on the path that actually executes. All of
them lived **only as prose in code comments**. Prose cannot be queried,
versioned, or evaluated against, and it cannot tell you when it has quietly
stopped being true.

The registry gives each rule a stable id, a statement, a rationale, a scope,
a severity, a version, the slice it came from, and a **provenance link to the
tests that prove it**.

#### It does not enforce anything by existing

Enforcement lives where it always did — in the code paths and the tests that
pin them. What this adds is the ability to *reason about* the behaviour: to
ask which rules exist, which are proven, and later, whether a given
interaction violated one.

#### The property that makes it non-fakeable

A rule may be marked `enforced` **only if it names at least one test file
that really exists on disk**, and a test asserts exactly that. Without that
check the file would decay into a wish list in which every entry reads like
a guarantee.

This is not theoretical. The first provenance path written into the registry
was wrong — `secrets/__tests__/credentialHonesty.test.ts` when the file is
in `ai/__tests__/`. The filesystem check caught it before the rule shipped.

Three statuses, kept separate on purpose:

- **enforced** — a named test would fail if the system stopped upholding it.
- **advisory** — held to by convention and visible in review, but nothing
  would fail. An honest "we mean this and have not pinned it".
- **aspirational** — a commitment for behaviour that does not exist yet.
  Recorded so it is not forgotten, and explicitly not a guarantee.

Coverage is reported as **three counts, never a percentage**. A single
"behavioural compliance" score would be read as a grade and immediately
optimised, and it would destroy the only information the split carries.

#### Current contents

12 enforced, 2 advisory, 1 aspirational.

`SB-015` (learning never silently changes production behaviour) is
aspirational and was written **before** the thing it constrains exists —
deliberately, so the constraint is not retrofitted onto a pipeline that has
already shipped without it.

---

### Implemented: capability availability says what is actually missing

`apps/backend/src/command/availability.ts`

The catalogue answered "why can't Synora do this here?" with two values, so
every unavailable capability produced one sentence — *"needs a provider
credential configured"*. For text generation that was wrong in the way that
matters: answering a question needs a **model**, and a local model serves it
as well as a bought one. Telling someone an administrator must configure a
credential hides the path that needs no vendor, no account and no money —
the path this platform intends to make ordinary.

`needs-model` is now its own value, and `ai.generate` carries it. Sending an
invitation stays `needs-credentials`, because SMTP has no local substitute.
Same word before, different worlds.

**Only values with a real capability behind them exist.** The directive lists
a longer vocabulary — infrastructure required, training required, and others.
Nothing in the catalogue is blocked by those today, and an enum member
nothing produces is a value no test can exercise and no reader can trust.
They are absent, and a test pins the set of values actually in use, so a
future slice adding one must add a capability that uses it.

**A regression this nearly shipped.** `understandCommand` filtered for the
literal `'needs-credentials'` when listing what cannot run. Reclassifying
`ai.generate` would have silently dropped it from that list, and a person
asking for text generation would have been told nothing was wrong right up
until it failed. All six availability checks now go through one
`isRunnableHere` helper so the next widening cannot repeat it.

---

### Reused, not rebuilt

The audit found substantially more prior art than expected. None of it was
duplicated:

- **Training foundation** — `Dataset`, `DatasetVersion`, `DatasetSample`,
  `DatasetLabel`, `DatasetSplit`, `EvaluationRun`, `EvaluationResult`,
  `BenchmarkRun`, `BenchmarkMetric`, `ModelRegistry`, `ModelVersion` all
  exist in Prisma with services, and are **mounted and reachable**.
- **Consent** — `TrainingConsent` and `privacyConsent.service.ts` exist, and
  `canUseForTraining` correctly defaults to `false`.
- **Observability** — `eos/` is 44 modules covering latency, cost, provider
  degradation, prompt outcomes, judges, graders, benchmarks and gates.
- **Provider abstraction** — `ai/registry.ts` and `ai/resolver.ts` already
  keep the business layer free of any vendor name.
- **Memory** — seven services plus pgvector, workspace-scoped, GDPR erasure.

---

### Known gaps, stated plainly

1. **No kernel object.** The eight verbs are implemented as separate modules
   with no stable interface binding them. `REASON` and `LEARN` have nothing
   behind them at all.
2. **No experience record.** `CommandExecution` is the closest thing and is a
   genuine proto-version, but it carries no ambiguity, clarification, user
   correction, confidence, latency, cost, model identity, evaluation result,
   privacy class or retention class.
3. ~~**No capability-status vocabulary.**~~ **Partly addressed.** See
   "Implemented: capability availability" below. The values with no real
   capability behind them are still deliberately absent.
4. **No learning pipeline.** Nothing converts experience into a candidate,
   evaluates it, versions it, or deploys it. `SB-015` constrains a thing that
   is not there yet.
5. **No local model RUNNING.** The adapter exists — the launch audit
   corrected this document's earlier claim that it did not
   (`ollama.provider.ts`, registered and tested, activated by
   `OLLAMA_BASE_URL`). What is missing is an installed Ollama and a pulled
   model. Until then, natural language beyond the fixed grammar cannot be
   served, and the system says so rather than pretending.

---

### What runs with nothing configured

Synora starts and works with no external provider, no credential, no cloud
and no GPU. Specifically: workspaces, conversations, the whole command layer
(understand ▸ plan ▸ authorise ▸ approve ▸ execute ▸ undo), scheduling,
permissions, memory storage, workflows, audit, capability reporting, the
evaluation harness, the dataset and model registries, and this rule registry.

What genuinely needs a model says **"local model required"** rather than
degrading into a guess.

---

### Planned, in dependency order — not yet built

Written as future work on purpose. None of this exists.

1. **Experience record** — extend the `CommandExecution` lineage into a full
   experience, including privacy and retention classification. The
   availability vocabulary it needed now exists.
2. **Rule evaluation** — answer "did this interaction violate a rule?"
   against the registry. Depends on 1.
3. **Kernel interface** — the stable eight-verb surface over the existing
   modules. Depends on 1 and 2.
4. **Learning pipeline** — experience → normalisation → consent check →
   evaluation → candidate → review → versioned deployment. Depends on all
   of the above, and is governed by `SB-015` before a line of it is written.
5. **Local model activation** — the adapter exists; this slice is installing
   Ollama, pulling an evaluated model, and verifying generation end-to-end.
   No business logic changes.

---

# Part VIII — Product specification

*Merged from `PRODUCT_SPEC.md` on 2026-08-10. Headings demoted one level; content otherwise unchanged.*

> **File references inside this merged section are historical.** They name
> documents that existed when it was written; those were consolidated on
> 2026-08-10 into `SYNORA_MASTER_BLUEPRINT.md`, `SYNORA_OPERATIONS.md` and
> `SYNORA_LEARNING.md`. The text is preserved unedited rather than rewritten,
> because editing an archived record to look current is how a record stops
> being evidence.

## PRODUCT SPEC — Synora AI Platform

**Created:** 2026-07-25
**Status:** Permanent product bible
**Maintenance rule:** Never remove information from this file. Only append
updates. Every AI engineer must read and follow this document before
implementing any feature, screen, or interaction.

---

### 1. Product Vision

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

### 2. Product Mission

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

### 3. Target Users

#### Primary: Professional creators (Pros)

Writers, content marketers, developers, designers, and video producers
who use AI tools daily and have outgrown single-purpose apps. They pay
for tools that save time. They care about output quality, workflow
speed, and not being locked into a vendor. Age 24-45, tech-comfortable
but not necessarily technical.

#### Secondary: Creative teams (Teams)

Small-to-mid agencies, startup marketing teams, content studios, and
internal creative teams (5-50 people) who need shared workspaces, role
controls, a shared asset library, and visibility into what the team is
generating. The buyer is usually a team lead or director; the users are
individual creators.

#### Tertiary: Enterprise creative organizations

Large organizations (500+ employees) with compliance requirements,
SSO/SAML mandates, audit log needs, data residency constraints, and the
desire to run AI on their own infrastructure. They buy through
procurement, require a security review, and need a self-hosted option.

#### Not our users (today)

Hobbyists who won't pay for a tool. Developers building AI applications
(they need an API, not a workspace). Researchers who need fine-tuning
and training capabilities. These may become users in future releases, but
we do not design for them now.

---

### 4. User Personas

#### Maya — the content lead

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

#### Dev — the indie creator

Dev is a solo developer-creator who writes newsletters, builds side
projects, and generates marketing images. He's deeply technical, has
opinions about which AI model is best for which task, and wants to bring
his own API keys to keep costs low. He cares about keyboard shortcuts,
dark mode, and not being patronized by a UI that hides power features.

**Pain points:** Generic chat UIs that waste screen space, no model
choice, paying for capacity he doesn't use, no prompt library.

**Success metric:** He replaces three separate AI tools with one Synora
workspace and spends less.

#### Ava — the creative director

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

### 5. User Problems

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

### 6. User Journey

#### Discovery → Trial

1. Creator finds Synora via search, word of mouth, or a shared asset link
2. Lands on the marketing site — reads the value proposition in under 10
   seconds
3. Clicks "Start creating free" — no credit card required
4. Registers with email (or OAuth in a future release)

#### Onboarding (first 2 minutes)

5. Enters their name (pre-filled from registration if provided)
6. Creates their first workspace (suggested name, auto-generated slug)
7. Picks a theme preference (dark is default — this is a signal that we
   respect their taste, not a throwaway setting)
8. Lands in the dashboard with their first workspace ready

#### First value (under 5 minutes)

9. The dashboard has a prominent "Try AI generation" card with a
   pre-filled example prompt
10. They generate their first piece of content (text or code) with one
    click — zero configuration if an API key is provided by the platform,
    or a guided "bring your own key" flow if self-hosted
11. The result appears instantly in their project, with the model name and
    generation time visible

#### Habit formation (first week)

12. They create a project, organize generations into it
13. They discover the prompt library and save their first prompt
14. They try the command palette (Cmd+K) and realize they can navigate
    the entire app without touching the mouse
15. They invite a teammate (Teams plan) or hit a Free tier limit and
    consider Pro

#### Upgrade (within 30 days)

16. They hit the project limit (Free: 3 projects) or want media
    generation (Pro)
17. The upgrade flow is inline — no redirect to a billing portal in
    another tab
18. They're on Pro and creating across all modalities

---

### 7. First Impression

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

### 8. Brand Personality

Synora's brand voice is **confident, precise, and warm** — never
corporate, never cute, never condescending.

#### We are:

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

#### We are not:

- **Hype-driven.** No "revolutionary," "game-changing," "next-generation,"
  "cutting-edge," or "powered by AI" (everything is powered by AI — saying
  it is noise).
- **Playful at the expense of clarity.** A clever button label that takes
  2 seconds to parse is worse than a boring one that takes 0.5 seconds.
- **Verbose.** Every word must earn its place. If a section of UI text
  can be cut in half and say the same thing, cut it in half.

---

### 9. UX Philosophy

#### Principle 1: Reduce time to creation

Every screen must be optimized for getting to the next creative action.
Registration to first generation must be under 5 minutes. Opening the
app to generating content must be under 30 seconds. If a workflow takes
more than 3 clicks, it's wrong.

#### Principle 2: Progressive disclosure

Show the simplest possible interface by default. Power features (model
selection, temperature, system prompts, advanced settings) are available
but not in the way. The Free tier user and the power user should both
feel that the interface was designed for them.

#### Principle 3: Spatial consistency

The sidebar is always on the left. Navigation is always in the same
place. The command palette is always Cmd+K. The user should never have
to wonder "where am I?" or "how do I get back?" Every page has a
breadcrumb context. Back always works.

#### Principle 4: No dead ends

Every empty state has a clear action. Every error state has a recovery
path. Every loading state shows progress (or at least a skeleton that
communicates structure). The user is never left staring at a blank
screen.

#### Principle 5: Keyboard-first, mouse-friendly

Every action reachable by mouse must also be reachable by keyboard.
Power users should be able to navigate the entire application without
touching the mouse. But the mouse experience must be equally polished —
keyboard-first does not mean mouse-hostile.

#### Principle 6: Respect the creator's attention

No marketing banners inside the product. No upgrade nags on every page.
No analytics popups. No cookie consent modals beyond what the law
requires. The product UI is the creator's workspace — treat it with the
same respect you'd treat their desk.

---

### 10. Design Philosophy

#### Premium by default

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

#### Token-driven

Every color, radius, shadow, and font size comes from CSS custom
properties (design tokens). No hardcoded hex values anywhere in
application code. This makes theming a data-attribute swap, not a
rebuild.

#### Dark-first

Dark mode is the default theme. It's not an afterthought or an
"alternative" — it's the primary design surface. Light mode is supported
and must look equally good, but dark mode is what we design first, test
first, and screenshot first.

Rationale: our users are creators who work in visual tools. They
overwhelmingly prefer dark interfaces (evidence: every design tool,
code editor, and creative app defaults to dark). Leading with dark also
forces better contrast discipline — if it's readable on dark, it's
readable on light.

#### Component-driven

Every UI element is composed from the design system
(`@synora/design-system`). Pages do not create one-off styled elements.
If a page needs a component that doesn't exist, the component is added
to the design system with tests, not hand-rolled in the page.

---

### 11. Animation Philosophy

Animation in Synora serves clarity, not decoration. Every animation must
answer: "What does this help the user understand?"

#### Rules

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

#### Approved easing curves

- `ease-out` (cubic-bezier 0.0, 0.0, 0.2, 1.0) for enters
- `ease-in` (cubic-bezier 0.4, 0.0, 1.0, 1.0) for exits
- `ease-in-out` for transforms that loop (loading spinners)
- Linear only for progress bars

#### Approved animation tokens

Defined in `tailwind-preset.cjs`: `fade-in`, `fade-up`, `shimmer`,
`gradient-x`. New animations are added to the preset, never inline.

---

### 12. Color Philosophy

#### Semantic, not decorative

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

#### Contrast requirements

- All text must meet WCAG 2.1 AA contrast (4.5:1 for normal text, 3:1
  for large text) in both themes.
- Interactive elements must have a visible focus indicator that meets
  3:1 contrast against adjacent colors.
- Status colors (destructive, success, warning) must be distinguishable
  without relying solely on color — always pair with an icon or label.

#### No brand colors in the product UI

The marketing site uses the full brand palette. Inside the product (post-
login), color is purely functional. The product UI does not "look like
Synora" through color — it looks like Synora through typography, spacing,
and interaction quality.

---

### 13. Typography

#### Font stack

- **Primary (sans):** Geist Sans — geometric, technical, excellent at
  small sizes. Used for all UI text, headings, and body copy.
- **Monospace:** Geist Mono — matches Geist Sans's proportions. Used for
  code blocks, model names, token counts, and technical values.

Both fonts are bundled via npm (`geist` package) and loaded locally — no
build-time or runtime network requests for fonts. This is a non-negotiable
architecture decision: Docker builds and CI must never depend on Google
Fonts CDN availability.

#### Scale

- Use Tailwind's default type scale (`text-xs` through `text-7xl`)
- Headings: `font-bold` or `font-semibold`. Never `font-black` (too
  heavy for screens).
- Body: `font-normal` (400 weight). Never `font-light` (too thin for
  dark backgrounds).
- Line height: Tailwind defaults (`leading-normal`, `leading-relaxed`).
  Tighten for headings (`leading-tight`), loosen for body blocks.

#### Rules

- One font size per visual level. Don't use `text-sm` and `text-xs` on
  the same line unless one is explicitly subordinate (e.g., a label and
  its helper text).
- Monospace is only for code, model identifiers, and numeric values that
  need tabular alignment. Never for headings or body text.
- Truncation over wrapping for single-line values (file names, model
  names, workspace names). Show the full value on hover via tooltip.

---

### 14. Navigation

#### Sidebar (left, collapsible)

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

#### Topbar (fixed)

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

#### Mobile navigation

On screens below 768px:
- Sidebar becomes a slide-over drawer, triggered by a hamburger icon in
  the topbar.
- Topbar stays fixed and gains the hamburger trigger.
- Bottom tab bar is NOT used — drawers are more scalable as navigation
  grows and avoid the "too many tabs" problem.

---

### 15. Dashboard Experience

The dashboard is the first thing a user sees after login. It must
accomplish three things:

1. **Orient.** Show the user where they are (which workspace), what's
   recent, and what they can do.
2. **Accelerate.** Provide fast paths to the most common actions: new
   generation, open recent project, create a project.
3. **Inform.** Surface relevant information: recent generations, usage
   stats (Pro/Team), team activity (Team).

#### Layout

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

#### Empty state (new user)

The dashboard for a new user with no projects or generations shows:
- Welcome message with their name
- A single prominent card: "Create your first project" with a
  description of what projects are for and a CTA button
- A secondary card: "Try AI generation" with a pre-filled example prompt
  and a "Generate" button that works without creating a project first
- No sidebar links are grayed out — all are clickable, and each empty
  section has its own meaningful empty state

---

### 16. Workspace Experience

Workspaces are the organizational primitive. Every project, document,
and generated asset belongs to a workspace. Users can belong to
multiple workspaces with different roles.

#### Workspace creation

- **Trigger:** onboarding wizard (first workspace), sidebar "Create
  workspace" button (additional workspaces), or settings page.
- **Flow:** name → auto-generated slug (editable) → optional description
  → create. One screen, not a multi-step wizard (additional workspaces
  are a power-user action).
- **Creator becomes OWNER** automatically. No confirmation needed.

#### Workspace switching

- **Trigger:** workspace switcher in sidebar (top position, always
  visible).
- **Dropdown:** shows all workspaces the user belongs to, with name,
  avatar, and role. "Create workspace" option at the bottom.
- **Switching is instant.** The sidebar, dashboard, and all content
  update to the selected workspace. URL changes to include workspace
  context.

#### Workspace settings (owner/admin only)

- General: name, slug, description, avatar
- Members: invite by email, change roles, remove members
- Billing: plan details, upgrade/downgrade (M8)
- API keys: create/revoke workspace API keys (M6)
- Danger zone: transfer ownership, delete workspace

#### Roles

| Role | Can create | Can view all | Can manage members | Can manage settings | Can delete workspace |
|---|---|---|---|---|---|
| Owner | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes (except billing) | No |
| Editor | Yes | Yes | No | No | No |
| Member | Yes | Own only | No | No | No |
| Viewer | No | Yes | No | No | No |

---

### 17. AI Chat Experience

The AI chat interface is where users have conversational interactions
with AI models. It is NOT the primary generation interface (that's the
playground) — it's the freeform, open-ended surface for exploration,
brainstorming, and iterative refinement.

#### Layout

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

#### Behavior

- Streaming responses: tokens appear as they arrive, not after the full
  response is complete. Cursor blinks at the insertion point.
- Stop button: visible during streaming, stops generation immediately.
- Retry: user can re-generate the last AI response with one click.
- Edit: user can edit a previous message and re-generate from that point.
- The model and provider used for each response is visible (small label
  below the response). This is transparency, not decoration.

#### What it is NOT

- It is not a "copilot" that watches everything you do. It is an
  explicit, user-initiated conversation.
- It is not a replacement for the playground. The playground is
  structured (prompt → result). Chat is freeform.
- It does not have "personas" or "characters." It's a professional tool.

---

### 18. AI Agent Experience

AI agents are autonomous multi-step workflows that accomplish complex
tasks on behalf of the user. This is a future capability (Release 3+)
and must be designed now even though it is not implemented.

#### Vision

An agent is a named, reusable workflow that:
1. Accepts a high-level goal ("Research competitors and write a summary")
2. Breaks it into steps
3. Executes each step using the AI generation capabilities
4. Reports progress and results back to the user

#### UX principles

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

#### Architecture alignment

Agents sit above `generateText()` and below routes in the backend
architecture. They inherit provider-agnosticism by construction — an
agent doesn't know or care which model answers its requests.

---

### 19. AI Image Experience

Image generation is a prompt-to-image workflow with durable storage and
project organization.

#### Flow

1. User navigates to image generation (sidebar, command palette, or
   project context)
2. Enters a prompt. Optional: select style, aspect ratio, model
3. Clicks "Generate"
4. Sees a loading skeleton in the target aspect ratio (not a spinner —
   a skeleton communicates what's coming)
5. Image appears. Options: download, add to project, generate variations,
   regenerate with modified prompt
6. Image is automatically saved to the workspace asset library

#### Key decisions

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

#### Empty state

"No images yet" with a prominent "Generate your first image" card
showing an example prompt and a preview of what the output looks like.

---

### 20. AI Video Experience

Video generation follows the same pattern as image generation with
longer processing times and richer preview.

#### Flow

1. User enters a prompt or selects a script
2. Optional: duration, aspect ratio, style, model
3. Submits — sees a progress card with estimated time remaining
4. Video appears in-place with a player. Options: download, add to
   project, regenerate.
5. Video saved to workspace asset library

#### Key decisions

- Processing times are 30 seconds to several minutes. The UI must
  communicate progress without requiring the user to wait on-page.
- A notification (in-app, push if enabled) fires when the video is ready.
- Video thumbnails are auto-generated from the first frame.
- The video player is embedded (no external redirects to watch a video).

---

### 21. AI Audio Experience

Audio generation covers voiceovers, narration, sound effects, and music.

#### Flow

1. User enters text (for speech) or a descriptive prompt (for music/SFX)
2. Optional: voice selection, duration, model
3. Submits — sees a waveform loading skeleton
4. Audio appears with an inline player. Options: download, add to project,
   regenerate.
5. Audio saved to workspace asset library

#### Key decisions

- Inline playback is mandatory. Users must be able to listen without
  downloading.
- Waveform visualization for audio assets (not a generic music icon).
- Text-to-speech previews are fast (under 10 seconds for short clips) and
  can be synchronous; long-form narration is async.

---

### 22. AI Code Experience

Code generation is a specialized mode of the AI engine tuned for
developer workflows.

#### Playground mode

- **Input:** prompt textarea + language selector + optional system prompt
- **Output:** syntax-highlighted code block with copy button, language
  detection, and line numbers
- **Model selector:** same as text, but defaults to a code-optimized
  model if available

#### Integration with documents

- Code generations can be saved as documents with `PLAIN_TEXT` format
- Future: inline code editor with AI-assisted completion

#### Key decisions

- Code output is never wrapped in prose. The `code-generation` capability
  applies code-specific defaults so output is runnable.
- Output must be copyable with one click (copy button on the code block,
  not Cmd+C which requires selection).
- Language detection is automatic but overridable.
- The code playground should feel closer to a REPL than to a chat.

---

### 23. Collaboration Experience

Collaboration is how teams work together on AI-generated content.

#### Shared visibility

- All workspace members can see projects, documents, and generated
  assets (subject to role permissions).
- Recent activity feed shows who generated what, when.
- Asset library shows all generated content across the workspace.

#### Real-time (future)

- Multiple users viewing the same document see each other's cursors
  (Release 3+, requires WebSocket infrastructure).
- Comments on generated content: "Can you regenerate this with a more
  formal tone?" (Release 3+).

#### Sharing

- Share a generated asset (image, text, code) via a public link with
  optional expiry.
- Embed generated content in external sites via iframe (future).
- Export projects as ZIP with all assets and metadata.

#### Permissions

Workspace roles govern access. There is no per-document permission model
today — access is workspace-scoped. Per-document permissions are a
Release 3+ concern.

---

### 24. Billing Experience

Billing must be invisible when it works and helpful when it doesn't.

#### Principles

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

#### Plan display

- Current plan with feature list and usage summary
- Upgrade/downgrade options with clear price comparison
- Annual vs monthly toggle with savings displayed
- Payment method management (add/update/remove card)

#### Usage visibility

- Token/generation count per billing period
- Storage used (when media ships)
- Seat count (Team plan)
- Simple progress bars against plan limits — not complex charts

---

### 25. Admin Experience

The admin dashboard is for platform operators and workspace owners with
Admin/Moderator roles.

#### Platform admin (ADMIN role)

- User management: list, search, suspend, delete users
- Workspace overview: list all workspaces, usage stats
- System health: API latency, error rates, generation queue depth
- Audit log viewer: filterable log of all security-relevant events
- Feature flags (future): enable/disable features per workspace

#### Workspace admin (OWNER/ADMIN workspace role)

- Member management: invite, change roles, remove
- Usage dashboard: workspace-level generation stats
- API key management: create, rotate, revoke
- Billing management: plan, payment method, invoices

#### Principles

- Admin UIs are functional, not beautiful. Density over decoration.
- Tables over cards for list views — admins need to scan data fast.
- Every admin action is logged in the audit trail.
- Destructive actions (suspend user, delete workspace) require typed
  confirmation ("type workspace name to delete").

---

### 26. Mobile Experience

Synora is a responsive web application — not a native mobile app (native
is a future release). The mobile web experience must be excellent, not
merely functional.

#### Breakpoints

- Mobile: 0-639px (`sm:` breakpoint)
- Tablet: 640-1023px (`md:` breakpoint)
- Desktop: 1024px+ (`lg:` breakpoint)

#### Mobile-specific behavior

- Sidebar → slide-over drawer (hamburger trigger)
- Topbar → compact (workspace name truncated, avatar smaller)
- Cards → single column, full width
- Dialogs → full-screen on mobile (not centered floating)
- Command palette → full-screen overlay
- Tables → horizontal scroll within a container (`overflow-x: auto`),
  or card-based layout for small datasets
- Text generation → full-screen input with output below

#### What must work perfectly on mobile

- Registration and login
- Dashboard browsing
- Text generation (simple prompts)
- Reading and copying generated content
- Switching workspaces
- Notifications

#### What can be desktop-optimized

- Complex settings pages (multi-column layouts)
- Admin dashboards (data-dense tables)
- Side-by-side comparisons
- Code editing with line numbers

---

### 27. Tablet Experience

Tablets get the best of both worlds: mobile touch interaction with
desktop-class layout space.

#### Behavior

- Sidebar is collapsible (not a drawer) — starts collapsed, expandable
- Two-column layouts where desktop uses three
- Touch targets are 44x44px minimum (Apple HIG standard)
- Hover states replaced with active/pressed states
- Command palette works with on-screen keyboard

---

### 28. Desktop Experience

Desktop is the primary design target. This is where creators do deep
work.

#### Expectations

- Full sidebar always visible (collapsible by choice)
- Multi-column layouts for settings and admin
- Keyboard shortcuts for every action
- Command palette as the fastest way to navigate
- Hover states on every interactive element
- Right-click context menus on projects, documents, assets (future)
- Drag-and-drop for file uploads and project organization (future)
- Window resizing gracefully reflows all layouts

---

### 29. Accessibility

Accessibility is a requirement, not a feature. Every page and component
must be usable by people with disabilities.

#### Standards

- **WCAG 2.1 AA** compliance minimum. AAA where achievable without
  compromising the design.
- All interactive elements must be keyboard-reachable and operable.
- All images must have alt text (generated images: use the prompt).
- All form inputs must have associated labels.
- Color is never the sole indicator of status — always pair with icon,
  text, or pattern.

#### Implementation

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

#### Testing

- Axe accessibility audit on every page (M10 Playwright suite)
- Manual screen reader testing (VoiceOver, NVDA) for critical flows:
  registration, login, generation, navigation
- Keyboard-only navigation testing for all core workflows

---

### 30. Performance Targets

#### Page load

| Metric | Target |
|---|---|
| First Contentful Paint (FCP) | < 1.5s |
| Largest Contentful Paint (LCP) | < 2.5s |
| Cumulative Layout Shift (CLS) | < 0.1 |
| First Input Delay (FID) | < 100ms |
| Time to Interactive (TTI) | < 3.5s |

#### API response

| Endpoint type | Target |
|---|---|
| Auth (login/register) | < 500ms |
| CRUD read (list/get) | < 200ms |
| CRUD write (create/update) | < 500ms |
| AI text generation (streaming) | First token < 2s |
| AI image generation (async) | Job accepted < 500ms |

#### Client-side

| Metric | Target |
|---|---|
| Route transition | < 100ms (perceived) |
| Command palette open | < 50ms |
| Search results | < 200ms |
| Skeleton → content swap | No layout shift |

#### Bundle size

- Initial JS bundle: < 150KB gzipped (excluding vendor chunks)
- Per-route code split: lazy load routes not in the initial viewport
- Design system: tree-shakeable — unused components must not be bundled

---

### 31. Error States

Every error must be handled. No uncaught exceptions visible to users.

#### Principles

- **Tell them what happened** — in plain language. Not "Error 500" but
  "Something went wrong on our end."
- **Tell them what to do** — "Try again," "Go back to dashboard," "Check
  your internet connection."
- **Don't blame them** — never "Invalid input." Instead: "Please enter a
  valid email address."
- **Preserve their work** — if a generation fails, the prompt must still
  be in the input. If a form submission fails, the form must still be
  filled.

#### Error types and their UX

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

### 32. Empty States

Empty states are onboarding opportunities, not dead ends.

#### Principles

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

#### Required empty states

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

### 33. Loading States

Loading states communicate that work is happening. They prevent the
user from wondering if the interface is broken.

#### Skeleton loading

The default loading pattern is skeleton screens — gray shapes that match
the layout of the content that will appear. This communicates structure
before content.

- Cards: skeleton card with placeholder lines
- Lists: skeleton rows with shimmer animation
- Text: skeleton lines at paragraph width
- Images: skeleton rectangle at the target aspect ratio

#### When to use skeletons vs spinners

| Scenario | Pattern |
|---|---|
| Page content loading | Skeleton (matches layout) |
| Action in progress (button click) | Button loading state (spinner inside button, button disabled) |
| Background refresh | No visible indicator (TanStack Query refetch) |
| Long operation (generation) | Inline progress or skeleton with message |
| Navigation | Instant (client-side routing); skeleton for server data |

#### Never

- A full-page spinner with no other content
- A loading bar that doesn't represent actual progress
- "Loading..." text without a visual indicator
- A blank white/black screen

---

### 34. Offline Behavior

Synora is an online-first application. Most features require a server
connection. However, the offline experience must not be hostile.

#### When offline

- Show a clear, persistent banner: "You're offline. Changes will sync
  when you reconnect." (not a modal that blocks the UI)
- Read-only access to cached data (TanStack Query cache) where available
- Generation requests queue locally and retry on reconnect (future)
- The app never crashes or shows a blank page due to network failure

#### Service worker

Not implemented today. When added (M10 scope), it should cache the app
shell and static assets for instant loading, not act as a full offline
database.

---

### 35. Notifications

Notifications inform the user about events that happened outside their
current focus.

#### Types

| Type | Example | Channel |
|---|---|---|
| Generation complete | "Your image is ready" | In-app, push (if enabled) |
| Team activity | "Maya invited you to workspace 'Acme'" | In-app, email |
| System | "Your plan renews in 3 days" | In-app |
| Security | "New login from Chrome on macOS" | In-app, email |

#### In-app notifications

- Bell icon in the topbar with unread count badge
- Dropdown panel showing recent notifications, grouped by date
- Mark as read (individual, all)
- Click a notification to navigate to the relevant content

#### Push notifications

- Opt-in only (never enabled by default)
- Settings page to control which notification types trigger push
- Used sparingly: only for events that genuinely benefit from
  interruption (generation complete, security alerts)

#### Email notifications

- Opt-in per type in user preferences
- Unsubscribe link in every email
- Transactional emails (password reset, invitation) are always sent
  regardless of preference

---

### 36. Settings

Settings are organized by scope: user-level and workspace-level.

#### User settings

- **Profile:** name, avatar, bio (UserProfile model)
- **Account:** email, password change, delete account
- **Appearance:** theme (dark/light/auto), language
- **Notifications:** per-type toggle for in-app, email, push
- **Sessions:** list active sessions, revoke any session
- **Security:** MFA enrollment (M6), password change
- **API keys:** personal API keys (separate from workspace keys)

#### Workspace settings (owner/admin)

- **General:** name, slug, description, avatar
- **Members:** invite, change roles, remove
- **Billing:** plan, payment method, invoices (M8)
- **API keys:** workspace-scoped keys
- **Security:** provider restrictions, SSO configuration (R3)

#### Layout

- Left nav for settings sections (not tabs — too many sections for tabs)
- Content area with form sections
- Save button at bottom of each section (not auto-save for settings — users
  expect explicit save for configuration changes)
- Destructive actions in a "Danger zone" section at the bottom, visually
  separated with a destructive-colored border

---

### 37. Search

Search is a first-class feature, not an afterthought.

#### Global search (Cmd+K or search bar)

- Searches across: projects, documents, generated content, prompts,
  workspace members
- Results grouped by type with type icons
- Fuzzy matching: "projct" finds "project"
- Instant results as you type (debounced 200ms)
- Keyboard navigation: arrow keys to select, Enter to open, Esc to close

#### Scoped search

- Within a project: search documents and generations in that project
- Within asset library: filter by type, date, model used
- Within members: search by name or email

#### Search results empty state

"No results for '{query}'" with:
- Spelling suggestions if a near-match exists
- "Search all workspaces" option if currently scoped to one
- "Create a new {type}" action if the search term could be a new item name

---

### 38. Keyboard Shortcuts

Every power user lives on the keyboard. Synora must be fully operable
without a mouse.

#### Global shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` / `Ctrl+K` | Open command palette |
| `Cmd+/` / `Ctrl+/` | Show keyboard shortcut reference |
| `Cmd+B` / `Ctrl+B` | Toggle sidebar |
| `Cmd+N` / `Ctrl+N` | New generation (context-dependent) |
| `Cmd+P` / `Ctrl+P` | Search projects |
| `Esc` | Close current dialog / palette / drawer |

#### Navigation shortcuts

| Shortcut | Action |
|---|---|
| `G then D` | Go to dashboard |
| `G then P` | Go to projects |
| `G then S` | Go to settings |
| `G then A` | Go to AI playground |

#### Generation shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Enter` | Submit generation prompt |
| `Cmd+Shift+C` | Copy last generation result |
| `Cmd+Shift+R` | Regenerate last result |

#### Implementation

- Shortcuts must not conflict with browser defaults or OS shortcuts
- All shortcuts must be discoverable via `Cmd+/` or the command palette
- Shortcuts must be disabled when a text input is focused (except
  Cmd+K, Esc, and Cmd+Enter)
- Modifier key display must adapt to OS: "Cmd" on macOS, "Ctrl" on
  Windows/Linux

---

### 39. Command Palette

The command palette is the fastest way to do anything in Synora. It is
inspired by VS Code's Cmd+P, Raycast, and Linear's Cmd+K.

#### Behavior

- **Trigger:** Cmd+K (global, always available)
- **Appearance:** centered modal overlay with search input, no backdrop
  click-to-close (Esc only — prevents accidental dismissal)
- **Search:** fuzzy matching across all actions and navigation targets
- **Results:** grouped by category (Navigation, Actions, Recent)
- **Keyboard:** arrow keys to navigate, Enter to execute, Esc to close

#### Action categories

| Category | Examples |
|---|---|
| Navigation | Go to Dashboard, Go to Projects, Go to Settings |
| Create | New Project, New Document, New Generation |
| Actions | Switch Workspace, Toggle Theme, Toggle Sidebar |
| Recent | Recently viewed projects, documents, generations |
| Search | Search projects, Search documents, Search members |

#### Visual design

- Background: glass/blur over the current page
- Input: large, prominent, placeholder "Type a command or search..."
- Results: clean list with icon, label, and shortcut hint (right-aligned)
- Selected item: highlighted with accent background
- Category headers: muted, uppercase, small text

#### Accessibility

- Focus is trapped inside the palette when open
- Focus returns to the trigger element when closed
- All items are in a listbox with proper ARIA roles
- Screen readers announce the selected item and result count

---

### 40. Future Marketplace

The marketplace is a Release 3+ feature for sharing and discovering
community-created assets.

#### Vision

- **Prompt marketplace:** share and discover prompts for text, code,
  image, video, and audio generation. Prompts can be free or paid.
- **Template marketplace:** pre-built project templates (blog post
  pipeline, product launch kit, video series template).
- **Integration marketplace:** third-party integrations (Slack, Notion,
  Figma, Google Docs) that extend Synora's capabilities.

#### Principles

- Quality over quantity. Curated, not a dumping ground.
- Creator attribution. Every shared asset credits its creator.
- Revenue sharing. Paid assets split revenue with creators.
- Safety. All shared content is reviewed for policy compliance.

---

### 41. Future Mobile App

A native mobile app is planned for Release 4+. It is NOT a wrapper around
the web app.

#### Purpose

- Quick capture: voice-to-text generation on the go
- Review and approve: check generated content, approve team requests
- Notifications: push notifications for generation completion and team
  activity

#### What it is NOT

- A full replacement for the desktop web experience
- A content creation environment (complex generation workflows stay on
  desktop/tablet)

#### Technology decision

React Native or native (Swift/Kotlin) — deferred. The web app's API
client and type definitions are designed to be reusable regardless of
the mobile framework choice.

---

### 42. Future Desktop App

A native desktop app (Electron or Tauri) is considered for Release 4+.

#### Purpose

- System-level keyboard shortcuts (global Cmd+Space to open Synora)
- Menu bar quick access for generation
- Offline draft mode with sync
- File system integration (drag files into Synora)
- Native notifications

#### Decision

Deferred. The web app with PWA capabilities (service worker caching,
install prompt) may be sufficient. A native app is justified only if
there are interactions that the web platform cannot support.

---

### 43. Future Enterprise Version

Enterprise Synora is a Release 3 deliverable.

#### Features

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

#### Pricing

Custom pricing, annual contract. Not displayed on the public pricing
page. "Contact sales" CTA with a form.

---

### 44. Future Self-Hosted Version

Self-hosted Synora is a Release 3 deliverable.

#### Target users

Organizations that cannot send data to external cloud providers due to
regulatory, security, or sovereignty requirements.

#### Architecture

- Single `docker compose up` deploys the entire stack: frontend, backend,
  database, Redis, object storage (MinIO)
- All AI providers work, including Ollama for fully air-gapped
  deployments (no external AI API calls)
- Updates delivered as Docker image tags; `docker compose pull && docker
  compose up -d` to update
- License key validation (online check with grace period for air-gapped
  deployments)

#### What self-hosted does NOT include

- Managed infrastructure (customer provides their own Docker host)
- Automatic backups (customer configures their own backup strategy)
- Multi-region deployment (single-node by default; scaling docs provided)

---

### 45. Success Metrics

#### North star metric

**Weekly active creators** — users who generated at least one piece of
content (any modality) in the past 7 days.

#### Acquisition metrics

| Metric | Target (first 6 months) |
|---|---|
| Marketing site → registration conversion | > 5% |
| Registration → first generation (same session) | > 60% |
| Registration → onboarding completion | > 80% |

#### Activation metrics

| Metric | Target |
|---|---|
| Time to first generation | < 5 minutes |
| Users who generate in first session | > 70% |
| Users who create a project in first week | > 40% |

#### Retention metrics

| Metric | Target |
|---|---|
| D1 retention (return next day) | > 30% |
| D7 retention (return within a week) | > 20% |
| D30 retention (return within a month) | > 15% |
| Monthly active users / registered users | > 25% |

#### Revenue metrics

| Metric | Target |
|---|---|
| Free → Pro conversion (within 30 days) | > 5% |
| Pro → Team upsell | > 10% of Pro users |
| Monthly churn (Pro) | < 5% |
| Net Revenue Retention (Team) | > 110% |

#### Product quality metrics

| Metric | Target |
|---|---|
| P95 API latency (CRUD) | < 200ms |
| P95 AI first token latency | < 2s |
| Error rate (5xx) | < 0.1% |
| Uptime | > 99.9% |
| Lighthouse performance score | > 90 |

---

### 46. Launch Checklist

Before public launch, all of the following must be true:

#### Product

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

#### Quality

- [ ] All pages pass WCAG 2.1 AA contrast checks
- [ ] All pages render correctly at 320px width (minimum mobile)
- [ ] All pages render correctly at 2560px width (ultrawide desktop)
- [ ] All core flows work with keyboard only
- [ ] No console errors in production build
- [ ] Lighthouse performance > 90 on all pages
- [ ] E2E suite covers registration, login, generation, navigation

#### Security

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

#### Infrastructure

- [ ] CI pipeline green (test, security, docker)
- [ ] CD pipeline tested with rollback
- [ ] Monitoring and alerting configured
- [ ] Database backups verified with restore drill
- [ ] SSL/TLS configured on all endpoints
- [ ] Domain and DNS configured

#### Legal

- [ ] Privacy policy published
- [ ] Terms of service published
- [ ] Cookie consent (if applicable)
- [ ] GDPR data export mechanism (if EU users)

---

### 47. Definition of Production

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

### 48. Product Principles

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

### 49. Things That Must Never Change

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

---

# Part IX — Product reasoning and decision record

*Merged from `SYNORA_BRAIN.md` on 2026-08-10. Headings demoted one level; content otherwise unchanged.*

> **File references inside this merged section are historical.** They name
> documents that existed when it was written; those were consolidated on
> 2026-08-10 into `SYNORA_MASTER_BLUEPRINT.md`, `SYNORA_OPERATIONS.md` and
> `SYNORA_LEARNING.md`. The text is preserved unedited rather than rewritten,
> because editing an archived record to look current is how a record stops
> being evidence.

## SYNORA BRAIN

**Created:** 2026-07-25
**Last updated:** 2026-07-25
**Maintenance rule:** Never remove information from this file. Only append
updates. This is Synora's permanent brain — the single source of truth for
every future AI engineer, human or machine, who touches this codebase.

---

### 1. Executive Summary

Synora is a premium, enterprise-grade AI creation platform for creators.
It is a unified SaaS where users generate text, code, images, video, and
audio, collaborate in workspaces, and automate workflows — with UI polish
comparable to Linear, Vercel, Framer, and Raycast.

The platform is a monorepo containing a Next.js 15 frontend, an Express 4
TypeScript backend REST API, and a PostgreSQL 16 database via Prisma, all
orchestrated by pnpm workspaces and Turbo. It ships a provider-agnostic
AI abstraction supporting 10 providers today, a custom JWT + rotating
refresh token authentication system, a CSS-variable design token system
(dark-first), and a full component library on Radix primitives.

Release 1 delivered a launchable core (auth, CRUD, AI text/code, security,
CI, Docker). Release 2 is turning it into the complete customer-facing
platform: design system, marketing site, auth UX, app shell, workspace
flows, AI playground, billing, admin, and observability across 10
milestones (renumbered from 9 on 2026-07-25 — see §2's note and
`RELEASE_2_PLAN.md` §3). As of this writing, M1 (design system
foundation), M2 (marketing site), M3 (auth/account UX), and M4
(application shell) are complete; M5 (core product surfaces) is next.

---

### 2. Current State of Progress

**Note (2026-07-26):** the milestone numbering below reflects the
founder's split of the original M3 into M3 (auth/account UX) + M4
(application shell), which shifted every later milestone up one slot.
`RELEASE_2_PLAN.md` §3 has the full before/after mapping.

| Area | Status |
|---|---|
| **Release** | Release 2 in progress |
| **Milestones complete** | M1 (design system foundation), M2 (marketing site), M3 (auth/account UX), M4 (application shell), M5 (workspace members, projects, folders, assets, invitations) |
| **Current milestone** | M6 (billing) — in progress |
| **Branch** | `claude/synora-ai-platform-h5q0k2` |
| **Last pushed commit** | M5 closing commit (dd359e7), PR #37 created and CI green (test, security, docker all passed) |
| **PR** | #37 (M5) → base `SYNORA`, draft, waiting for auto-merge; #31 (M4) merged |
| **CI** | M5 CI all green ✅ |
| **Tests** | 632 total (backend 432, web 200, design-system varies by count) — all passing |
| **Production readiness** | ~60% toward Release 2 launch (M5/6 billing are core data model + payment integration) |
| **Known issues** | None open at code level |
| **Uncommitted on disk** | None — working tree clean, M5 fully committed and pushed |

#### What is complete and working

- Full auth lifecycle: registration (+ email verification), login
  (remember-me), token refresh (rotating, reuse-detected, `sid` session
  claim), logout/logout-everywhere, forgot/reset-password, account
  lockout — backend + tests, and every screen rebuilt on the design
  system + typed API client (no raw `fetch`/`localStorage['token']`
  anywhere in the frontend — that was fixed in M3)
- Session management (list/revoke/logout-all), account settings
  (password change, notification preferences, soft-delete), profile
  settings (edit + avatar upload) — `/dashboard/settings/{profile,
  account,sessions,workspace}`
- **Workspaces**: `POST/GET /api/workspaces`, `GET/PATCH
  /api/workspaces/:id`, `GET /api/workspaces/:id/members` —
  membership-checked, OWNER-only writes, real workspace switcher +
  creation dialog in the app shell (M4)
- **In-app notifications**: real `Notification` model + routes, created
  at genuine event triggers, surfaced in a real notification center (M4)
- **Application shell**: sidebar, topbar, command palette (⌘K), profile
  menu with a server-persisted theme submenu, breadcrumbs,
  keyboard-shortcuts dialog, branded 404/error pages both at the root
  and inside the dashboard shell (M4)
- **Workspace-scoped projects & documents (new in M5):** `POST/GET
  /api/projects`, `GET/PATCH/DELETE /api/projects/:id`,
  `POST/GET /api/documents`, `GET/PATCH/DELETE /api/documents/:id`
  — all membership-checked, 404 for non-members (matching M4 pattern).
  Projects optionally scoped to workspaceId, all tests passing.
- **Workspace folders (new in M5):** hierarchical folder support with
  recursive cascade delete, nested parent/child relationships, 
  `POST/GET /api/workspaces/:id/folders`, PATCH/DELETE with project
  and parent filtering — workspace-scoped and fully tested.
- **Workspace assets (new in M5):** multipart file upload, storage
  integration, `POST/GET /api/workspaces/:id/assets`, DELETE with
  permission checks — workspace-scoped, fully integrated with storage
  abstraction from M3.
- **Workspace invitations (new in M5):** email-based invitations with
  token acceptance, `POST /api/workspaces/:id/invitations`, `POST
  /api/invitations/:token/accept`, `GET /api/invitations/:token`
  (preview), `DELETE` revoke — full lifecycle with mail template.
- **Workspace audit logging (new in M5):** `AuditLog` model,
  `recordAuditEvent()` service, all mutations logged — audit trail
  queryable via workspace settings page.
- **Permissions system (new in M5):** role-based enforcement
  (VIEWER/MEMBER/EDITOR/ADMIN/OWNER), `requireMembership()` and
  `requirePermission()` middleware pattern, tested across all new routes.
- **Frontend M5 additions:** Projects/Folders/Assets pages, invite
  acceptance page, workspace settings tabs (members, invitations,
  activity), Sidebar Projects nav item with active-state logic, all
  real CRUD with real API wiring, no mock UI.
- AI text/code generation (`POST /api/ai/generate`) through the
  10-provider abstraction; provider chosen purely by configuration
- Typed config system (stage-aware, zod, fail-closed) + SecretsManager
  (audited reads, pluggable sources, secret catalog)
- Provider-agnostic mailer (`src/mail/`) and file storage (`src/storage/`)
  — real, load-bearing (avatar uploads, transactional email), not
  placeholders (M3)
- CI pipeline (test / security / docker smoke) — all blocking, all green
- Production Docker image (multi-stage, non-root, healthcheck)
- Design tokens (dark default/light override), shared Tailwind preset,
  21-component design-system library (Radix-based, plus a hand-rolled
  `Command`/`CommandDialog` palette — no `cmdk` dependency) with 35 tests
- Typed API client with single-flight 401-refresh-retry, multipart
  upload support, token storage, Zustand auth store, TanStack Query +
  next-themes providers, Geist fonts
- Marketing site: glass navbar (mobile menu, theme toggle) + footer;
  animated landing page; pricing page + FAQ; six SSG feature pages from
  one template; changelog timeline — all driven by typed content modules;
  sitemap/robots/OpenGraph

#### What is working but interim

- None carried over from M1–M4. The legacy raw-fetch auth pages and the
  deprecated `token` alias, both once flagged here as "interim," were
  removed in M3.

#### What is partially completed

- **Workspaces/teams:** create/list/get/rename + membership-checked reads
  are real (M4); invitations, roles beyond OWNER, and API keys remain
  schema-only — M6
- **MFA:** complete implementation on `recover/mfa` branch (needs rebase);
  4 MFA-adjacent services in mainline (`services/mfa/`) are tested but
  dead code — M6
- **CSRF:** complete implementation on `recover/csrf` branch; lands with
  the cookie-auth migration — M6
- **Media generation:** `POST /api/images/generate` returns a hardcoded
  placeholder; no provider, no queue, no storage — M7. The M3/M4 storage
  abstraction (`src/storage/`) is a real building block for this, not a
  placeholder.

---

### 3. Architecture Deep Dive

#### High-level diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 15)                │
│  TanStack Query + Zustand + typed API client (fetch     │
│  wrapper w/ single-flight refresh rotation), tokens in  │
│  localStorage; UI from @synora/design-system (dark-first │
│  token theme). Marketing site via (marketing) route     │
│  group with glass navbar and shared footer.             │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS, Authorization: Bearer <jwt>
┌────────────────────▼────────────────────────────────────┐
│              Backend API (Express 4)                    │
│  helmet → CORS → global rate limiter → express.json    │
│  → requestLogger → routes (zod-validated) → errorHandler│
│  ├── auth (register/login/refresh/logout)               │
│  ├── users, projects, documents, images                 │
│  ├── ai (text/code generation, 10 providers)            │
│  ├── config (typed, stage-aware, zod-validated)         │
│  └── secrets (audited reads, pluggable sources)         │
└────────────────────┬───────────────────┬────────────────┘
                     │                   │
              ┌──────▼──────┐    ┌───────▼────────┐
              │ PostgreSQL  │    │  AI Provider    │
              │ 16 (Prisma  │    │  (Anthropic,    │
              │  5.22)      │    │  OpenAI, etc.)  │
              └─────────────┘    └────────────────┘
```

#### Backend architecture

Layered, assembled in `apps/backend/src/app.ts` (`createApp(config)`
returns an Express app without calling `.listen()`, so tests exercise the
real middleware chain):

1. `helmet()` — security headers
2. CORS — origins from typed config (`server.corsOrigins`)
3. Global rate limiter — `express-rate-limit`, IP-based, all of `/api/*`
4. `express.json()` / `urlencoded` — 10MB body cap
5. `requestLogger` — structured Winston request logging
6. Routes — each mutating route validates its body with a zod schema
   before touching Prisma
7. 404 catch-all
8. `errorHandler` — `ZodError` → 400 with field issues; `ApiException`
   subclasses → their status code; anything else → 500 with internals
   hidden outside `development`

**Startup order** (`index.ts`): secrets validation → `initConfig()`
(zod-validated, fail-closed in staging/production) → `createApp` →
listen on `0.0.0.0` (explicit — container networking bug fixed in R1).

#### Frontend architecture

- **Root layout** (`src/app/layout.tsx`): Geist Sans/Mono font variables,
  design-system token stylesheet, `Providers` (TanStack `QueryClient` +
  `next-themes` with `attribute="data-theme"`, `defaultTheme="dark"`),
  global `Toaster` outlet
- **Marketing route group** (`src/app/(marketing)/`): shared `MarketingNav`
  + `MarketingFooter` layout wrapping landing, pricing, feature pages,
  changelog
- **API layer** (`src/lib/api/`): `client.ts` exposes `api.get/post/...`
  typed against the backend envelope `{ success, data, error }`. Attaches
  `Authorization: Bearer <accessToken>`, and on a 401 performs a
  single-flight refresh then retries once. `auth.ts` wraps
  login/register/logout.
- **Token storage** (`src/lib/auth/token-storage.ts`): localStorage under
  `synora.accessToken` / `synora.refreshToken`, SSR-safe guards
- **Stores** (`src/stores/auth-store.ts`): Zustand store holding
  `user` + `status` (`loading | authenticated | unauthenticated`)
- **Pages today**: marketing site (landing, pricing, 6 feature pages,
  changelog), `/auth/login`, `/auth/register`, `/dashboard` — auth pages
  still on raw-fetch logic (M3 rebuilds them)

#### Config vs Secrets separation

Two deliberately separate systems:
- **Config** (`src/config/`): typed, non-sensitive settings — zod-validated
  `AppConfig` with stage-aware defaults, fail-closed in staging/production
- **Secrets** (`src/secrets/`): `SecretsManager` with pluggable source
  chain, audit-logged reads, secret catalog with owners/rotation schedules.
  Credentials are read only via `secretsManager.get()`, never from
  `process.env` at call sites, never logged.

---

### 4. Folder Structure

```
synora/
├── apps/
│   ├── backend/                # Express REST API
│   │   ├── src/
│   │   │   ├── ai/            # Provider-agnostic AI abstraction
│   │   │   │   ├── index.ts   # Facade: generateText()
│   │   │   │   ├── registry.ts # Provider descriptor registry
│   │   │   │   ├── resolver.ts # Auto-selection logic
│   │   │   │   ├── types.ts   # Shared AI types
│   │   │   │   └── providers/ # 10 provider adapters
│   │   │   │       ├── anthropic.provider.ts
│   │   │   │       ├── openaiCompatible.provider.ts (shared by OpenAI/xAI/DeepSeek/OpenRouter/Together)
│   │   │   │       ├── gemini.provider.ts
│   │   │   │       ├── azureOpenai.provider.ts
│   │   │   │       ├── bedrock.provider.ts
│   │   │   │       └── ollama.provider.ts
│   │   │   ├── config/        # Typed config (stage-aware defaults + env, zod)
│   │   │   ├── db/            # Prisma singleton wrapper
│   │   │   ├── middleware/    # errorHandler, requestLogger, auth
│   │   │   ├── routes/        # auth, users, projects, documents, images, ai
│   │   │   ├── secrets/       # SecretsManager + sources + audit log + registry
│   │   │   ├── services/      # password, token, lockout, mfa/* (not wired)
│   │   │   ├── utils/         # logger, etc.
│   │   │   ├── app.ts         # Express app assembly (createApp)
│   │   │   └── index.ts       # Entry: secrets→config→listen
│   │   └── tests/             # Integration tests (supertest + real Postgres)
│   └── web/                    # Next.js app (App Router)
│       ├── postcss.config.js   # tailwindcss + autoprefixer (added M1)
│       ├── tailwind.config.ts  # consumes @synora/design-system/tailwind-preset
│       └── src/
│           ├── app/
│           │   ├── layout.tsx        # Geist fonts, tokens, Providers, Toaster
│           │   ├── providers.tsx      # QueryClient + ThemeProvider
│           │   ├── globals.css        # Token classes, selection color
│           │   ├── (marketing)/       # Route group: shared nav+footer layout
│           │   │   ├── layout.tsx     # MarketingNav + MarketingFooter
│           │   │   ├── page.tsx       # Landing page (hero, stats, features, CTA)
│           │   │   ├── pricing/       # Pricing + FAQ
│           │   │   ├── features/[slug]/ # SSG feature pages (6)
│           │   │   └── changelog/     # Changelog timeline
│           │   ├── auth/login/        # Login page
│           │   ├── auth/register/     # Register page
│           │   └── dashboard/         # Dashboard (basic sidebar)
│           ├── components/
│           │   └── marketing/         # ThemeToggle, MarketingNav, MarketingFooter,
│           │                          # Section, SectionHeading, PlanCard
│           ├── content/               # Typed content modules
│           │   ├── plans.ts           # Plan data (Free/Pro/Team)
│           │   ├── features.ts        # Feature data (6 features)
│           │   └── changelog.ts       # Changelog entries
│           ├── lib/
│           │   ├── api/               # client.ts, auth.ts, types.ts
│           │   └── auth/              # token-storage.ts
│           └── stores/                # auth-store.ts (Zustand)
├── packages/
│   ├── database/               # Prisma schema (18 models) + 4 migrations
│   │   └── prisma/
│   │       ├── schema.prisma   # Single source of truth for all models
│   │       └── migrations/     # Version-controlled migrations
│   ├── shared/                 # ApiException hierarchy, createApiResponse, types
│   └── design-system/          # Tokens + preset + 17 components + tests
│       ├── src/
│       │   ├── components/     # Avatar, Badge, Button, Card, Dialog, DropdownMenu,
│       │   │                   # Input, Kbd, Label, Separator, Skeleton, Spinner,
│       │   │                   # Switch, Tabs, Textarea, Toaster, Tooltip
│       │   ├── lib/cn.ts       # clsx + tailwind-merge
│       │   ├── styles/tokens.css # HSL CSS variables, dark default
│       │   └── index.ts        # Barrel export
│       ├── tailwind-preset.cjs (+ .d.ts) # Shared Tailwind config
│       └── vitest.config.ts
├── infrastructure/
│   ├── docker/
│   └── k8s/                    # Present but unused — Release 4 scope
├── docs/                       # See docs/README.md for full index
│   ├── architecture.md         # System design (living — update with code)
│   ├── api.md                  # API reference (living)
│   ├── database.md             # Schema docs (living)
│   ├── deployment.md           # Deploy procedures (living)
│   ├── security.md             # Security practices (living)
│   ├── operations/             # Operational reference docs
│   ├── security/               # Security reference docs
│   ├── production/             # Per-feature R1 docs (R1-a through R1-g)
│   └── archive/                # Historical, frozen docs
├── .github/workflows/ci.yml   # test, security, docker jobs
├── Dockerfile                  # Multi-stage production image (backend)
├── docker-compose.dev.yml      # Local Postgres (+ Redis placeholder)
├── PROJECT_HANDOVER.md         # Zero-context entry point for humans
├── CURRENT_STATE.md            # Point-in-time state (updated per milestone)
├── NEXT_TASK.md                # The single next development task
├── SYNORA_BRAIN.md             # This file — permanent project intelligence
├── RELEASE_ROADMAP.md          # R1 ✅ / R2 active / R3 / R4
├── RELEASE_1_FINAL.md          # Frozen R1 snapshot
├── RELEASE_2_PLAN.md           # Active plan, 9 milestones
├── CLAUDE.md                   # AI/developer instructions
└── package.json                # Workspace root, packageManager pin (pnpm 10.33.0)
```

---

### 5. Every Database Model

18 models in `packages/database/prisma/schema.prisma` (19 with the
uncommitted `PasswordResetToken`). 4 migrations applied: `init`,
`add_refresh_token`, `add_login_lockout`, `drop_redundant_unique_indexes`.
No seed script.

#### Identity models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `User` | Core user account | id, email (unique), password (Argon2id hash), role (USER/ADMIN/MODERATOR), status (ACTIVE/INACTIVE/SUSPENDED/DELETED), failedLoginAttempts, lockedUntil | Active — used by auth, CRUD, AI |
| `Account` | OAuth provider links | userId FK, provider, providerAccountId | Schema only — no OAuth wired |
| `UserProfile` | Extended profile | userId FK (unique), bio, avatar, website, location, socialLinks (JSON) | Schema only — no routes |
| `UserPreferences` | User settings | userId FK (unique), theme (LIGHT/DARK/AUTO), language, notification booleans | Schema only — no routes |

#### Workspace models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `Workspace` | Team workspace | name, slug (unique), description, avatar | Schema only — first routes in M3 |
| `WorkspaceMember` | Membership | userId + workspaceId (unique pair), role (OWNER/ADMIN/EDITOR/MEMBER/VIEWER) | Schema only |
| `WorkspaceInvitation` | Invite tokens | workspaceId, email, role, token (unique), expiresAt, acceptedAt | Schema only — M6 |
| `ApiKey` | Workspace API keys | workspaceId, name, key (unique), lastUsedAt, expiresAt | Schema only — M6 |

#### Content models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `Project` | User projects | userId FK, workspaceId FK (optional), name, status (ACTIVE/ARCHIVED/DELETED) | Active — CRUD routes |
| `Document` | Text content | userId FK, projectId FK, title, content, format (MARKDOWN/HTML/PLAIN_TEXT/RICH_TEXT), status | Active — CRUD routes |
| `GeneratedImage` | AI images | userId FK, projectId FK, prompt, imageUrl, width, height, model | Placeholder only |
| `GeneratedVideo` | AI videos | userId FK, projectId FK, prompt, videoUrl, duration, model | Schema only |
| `GeneratedAudio` | AI audio | userId FK, projectId FK, prompt, audioUrl, duration, model | Schema only |

#### Auth/session models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `RefreshToken` | Rotating sessions | tokenHash (SHA-256, unique), userId FK, expiresAt, revokedAt | Active — auth flow |
| `PasswordResetToken` | Password resets | tokenHash (SHA-256, unique), userId FK, expiresAt, usedAt | **Uncommitted** — M3 |
| `Session` | NextAuth sessions | sessionToken, userId, expires | Schema only — NextAuth placeholder |
| `VerificationToken` | Email verification | identifier, token (unique), expires | Schema only — NextAuth placeholder |

#### Audit models

| Model | Purpose | Key fields | Status |
|---|---|---|---|
| `ActivityLog` | User activity | userId FK, action, resource, resourceId, metadata (JSON), ipAddress | Schema only — no routes |
| `MFAAuditLog` | MFA audit trail | userId (soft ref — no FK), action, metadata (JSON), timestamp | Schema only — dead code references it |

#### Index strategy

Every FK column is indexed. `@unique` constraints (email, slug, tokenHash)
are not duplicated by explicit `@@index` (redundant indexes were removed
in the post-R1 audit). Composite unique constraints: `Account(provider,
providerAccountId)`, `WorkspaceMember(userId, workspaceId)`,
`WorkspaceInvitation(workspaceId, email)`, `VerificationToken(identifier,
token)`.

---

### 6. API Inventory

#### Response envelope

Success: `{ success: true, data: T, meta: { timestamp, version } }`
Error: `{ success: false, error: { code, message, details? } }`

#### Endpoints

| Route | Method | Auth | Purpose | Status |
|---|---|---|---|---|
| `/health` | GET | None | Liveness (Docker HEALTHCHECK, CI smoke) | Active |
| `/ready` | GET | None | Readiness (probes database) | Active |
| `/api/auth/register` | POST | None | Create account, returns access+refresh tokens | Active |
| `/api/auth/login` | POST | None | Authenticate (423 if locked) | Active |
| `/api/auth/refresh` | POST | None | Rotate refresh token, returns new pair | Active |
| `/api/auth/logout` | POST | None | Revoke a refresh token | Active |
| `/api/users/me` | GET | Bearer | Current user profile | Active |
| `/api/users/:userId` | GET | Bearer | Public user profile | Active |
| `/api/projects` | GET | Bearer | List user's projects | Active |
| `/api/projects` | POST | Bearer | Create project | Active |
| `/api/projects/:id` | GET | Bearer | Project details | Active |
| `/api/documents` | GET | Bearer | List user's documents | Active |
| `/api/documents` | POST | Bearer | Create document | Active |
| `/api/documents/:id` | GET | Bearer | Document details | Active |
| `/api/images` | GET | Bearer | List generated images | Active |
| `/api/images/generate` | POST | Bearer | **Placeholder** — hardcoded URL, no provider | Placeholder |
| `/api/images/:id` | GET | Bearer | Image details | Active |
| `/api/ai/generate` | POST | Bearer | Real text/code generation (10 providers) | Active |

#### Planned endpoints (M3)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/forgot-password` | POST | Request password reset (always 200, no enumeration) |
| `/api/auth/reset-password` | POST | Consume reset token, change password |
| `/api/workspaces` | POST | Create workspace |
| `/api/workspaces` | GET | List my workspaces |
| `/api/workspaces/:id` | GET | Workspace details (membership-checked) |

---

### 7. AI Architecture

#### Provider abstraction (`apps/backend/src/ai/`)

The AI layer is provider-agnostic by design. UI and routes never touch a
vendor SDK directly — everything goes through the facade.

- **Facade** (`index.ts`): `generateText(request)` — the only entry point
  routes use
- **Registry** (`registry.ts`): every provider ships an
  `AIProviderDescriptor` — `id`, `displayName`, `capabilities`,
  `isConfigured()` (checks secrets/config, never throws), `create()`
  (builds the adapter). Adding a provider = one descriptor file.
- **Resolver** (`resolver.ts`): `AI_PROVIDER` env override wins; else
  first configured provider in fixed priority order (Anthropic first)
- **Errors**: vendor errors wrapped in `AIProviderError` with provider id

#### 10 providers

| Provider | Adapter | Config required |
|---|---|---|
| Anthropic Claude | `anthropic.provider.ts` | `ANTHROPIC_API_KEY` |
| OpenAI | `openaiCompatible.provider.ts` | `OPENAI_API_KEY` |
| Google Gemini | `gemini.provider.ts` | `GOOGLE_AI_API_KEY` |
| xAI Grok | `xai.provider.ts` (uses openaiCompatible) | `XAI_API_KEY` |
| OpenRouter | `openrouter.provider.ts` (uses openaiCompatible) | `OPENROUTER_API_KEY` |
| DeepSeek | `deepseek.provider.ts` (uses openaiCompatible) | `DEEPSEEK_API_KEY` |
| Together AI | `together.provider.ts` (uses openaiCompatible) | `TOGETHER_API_KEY` |
| Azure OpenAI | `azureOpenai.provider.ts` | `AZURE_OPENAI_API_KEY` + endpoint + deployment |
| AWS Bedrock | `bedrock.provider.ts` | AWS creds + explicit `BEDROCK_REGION` |
| Ollama | `ollama.provider.ts` | `OLLAMA_BASE_URL` (no API key) |

#### Design principles

- Adding a provider = one descriptor file. Nothing else changes.
- The Ollama provider proves the self-hosted model path: a future Synora
  model is just another descriptor whose `create()` points at an internal
  endpoint.
- Bedrock deliberately requires explicit `BEDROCK_REGION` so ambient AWS
  credentials never silently activate a billable provider.
- Capabilities today: `text-generation`, `code-generation`. Media
  capabilities join in M7.
- No agent/orchestration layer exists. When it arrives (R3+), it sits
  above `generateText()` and below routes.

---

### 8. Authentication Deep Dive

#### Token architecture

- **Access token**: 15-minute JWT, HS256, algorithm pinned (not
  configurable — security invariant). Claims: `userId`, `email`, `role`.
- **Refresh token**: 7-day, opaque, cryptographically random (48 bytes,
  base64url). Only its SHA-256 hash is stored in the `RefreshToken` table.
  Single-use: presenting a refresh token rotates it (revokes the old one,
  issues a new pair). Reuse of a revoked token is detectable.
- **Password reset token** (M3, uncommitted): same hash-at-rest discipline.
  Single-use (`usedAt`), short expiry (≤1 hour). Consuming one revokes
  all refresh tokens for the user.

#### Flow

1. Register/login → `{ accessToken, refreshToken, user }` (+ deprecated
   `token` alias until M3)
2. Authenticated calls use `Authorization: Bearer <accessToken>`
3. On 401, the frontend API client performs single-flight
   `POST /api/auth/refresh` → new pair → retries the original request
4. Logout revokes the refresh token — this is what makes "log out"
   actually end the session
5. Lockout: 5 failed attempts → 15-minute lock (both config-driven),
   DB-backed

#### Password hashing

Argon2id (`argon2` package). Legacy bcrypt hashes (from before R1)
migrate transparently: on successful login with a bcrypt hash, the hash
is replaced with Argon2id. No batch migration needed.

#### What's deliberately absent and why

- **Cookies/CSRF**: bearer tokens in the Authorization header are not
  CSRF-vulnerable. CSRF protection lands with the cookie-auth migration
  in M6.
- **MFA**: fully built on `recover/mfa` branch, not merged. Lands in M6.
- **OAuth2**: `next-auth` is declared but unused — reserved for a future
  OAuth flow.

---

### 9. Frontend Architecture

#### Design system (`@synora/design-system`)

- **Tokens** (`src/styles/tokens.css`): HSL triples as CSS variables.
  `:root` = dark theme (the default); `[data-theme="light"]` overrides.
  `color-scheme` is set per theme so native controls match.
- **Preset** (`tailwind-preset.cjs`): maps Tailwind color names to
  `hsl(var(--token) / <alpha-value>)`, radii to `var(--radius)`, fonts to
  `var(--font-sans)`/`var(--font-mono)`, plus keyframes
  (fade-in/fade-up/shimmer/gradient-x) and `tailwindcss-animate`.
- **17 components**: Button (cva variants, `asChild` via Radix Slot,
  `loading` state), Input, Textarea, Label, Card (+5 subcomponents),
  Badge, Skeleton, Spinner, Separator, Kbd, Dialog, Tabs, Switch,
  Tooltip, Avatar, DropdownMenu, Toaster (sonner)
- **Build**: tsc to `dist/`; web app consumes built output (Turbo
  `dependsOn: ["^build"]` guarantees order). Token CSS and preset exported
  as source via package `exports` map.
- **Tests**: 16 tests (Vitest + Testing Library + jsdom)

#### State management

- **TanStack Query 5**: server state (API data caching, refetching)
- **Zustand 4**: UI/auth state (`auth-store.ts`)
- **API client**: typed `fetch` wrapper with envelope awareness, bearer
  attachment, and single-flight refresh rotation

#### Typed content modules

Data-driven pages use typed content arrays:
- `src/content/plans.ts` — `Plan` interface + `PLANS` array (Free/Pro/Team)
- `src/content/features.ts` — `Feature` interface + `FEATURES` array (6)
- `src/content/changelog.ts` — `ChangelogEntry` interface + `CHANGELOG`

M8 billing can bind to the same plan IDs without page rewrites.

#### Current routes

| Route | Layout | Status |
|---|---|---|
| `/` | `(marketing)` | Landing page — hero, stats, features, CTA |
| `/pricing` | `(marketing)` | Plan cards + FAQ accordion |
| `/features/[slug]` | `(marketing)` | 6 SSG feature pages |
| `/changelog` | `(marketing)` | Timeline with dated entries |
| `/auth/{login,register,forgot-password,reset-password,verify-email}` | Standalone | Rebuilt on the typed API client (M3) |
| `/dashboard` | App shell | Real workspace overview + empty state (M4) |
| `/dashboard/settings/{profile,account,sessions,workspace}` | App shell | Real settings, no mock UI (M3/M4) |
| `/dashboard/[...catchAll]` | App shell | Triggers the shell-aware 404 (M4) |

---

### 10. Security Model

#### Implemented layers (outermost first)

1. **HTTPS** — deployment responsibility
2. **helmet()** — security headers (HSTS, X-Frame, CSP, etc.)
3. **CORS allowlist** — from typed config (`server.corsOrigins`)
4. **IP rate limiting** — `express-rate-limit`, global on `/api/*`
5. **Zod input validation** — every mutating route
6. **JWT verification** — pinned HS256 algorithm
7. **Per-account lockout** — 5 fails/15 min, DB-backed, config-driven
8. **Argon2id password hashing** — transparent bcrypt migration
9. **Hashed single-use refresh tokens** — SHA-256, reuse detection
10. **Prisma parameterized queries** — structural SQL injection immunity
11. **Centralized error handling** — hides internals outside development
12. **SecretsManager** — audited reads, pluggable sources
13. **CI security gates** — `pnpm audit` high+ (blocking), gitleaks
    (blocking), Snyk (best-effort)
14. **Docker** — non-root user, no `.env` in image layers

#### Deliberately not yet implemented

| Feature | Reason | When |
|---|---|---|
| MFA | Built on branch, not merged; launch without is standard practice | M6 |
| CSRF | Only matters with cookie-auth; bearer tokens aren't vulnerable | M6 |
| Redis-shared rate limits | Single-instance is correct for now | M7 |
| Field-level encryption | Not needed until PII compliance work | R3 |
| Auth-endpoint rate limiting | Global limiter covers for now | M6 |
| OAuth2 login | `next-auth` declared but unused | Future |

---

### 11. Deployment Runbook

#### Current: manual Docker deploy

```bash
## 1. Build
docker build -t synora-backend:latest -f Dockerfile .

## 2. Migrate
DATABASE_URL="<prod-db-url>" pnpm --filter @synora/database db:migrate

## 3. Run
docker run -d --name synora-backend \
  -e NODE_ENV=production -e APP_STAGE=production -e PORT=3001 \
  -e DATABASE_URL="<prod-db-url>" \
  -e JWT_SECRET="<generated>" -e NEXTAUTH_SECRET="<generated>" \
  -e ANTHROPIC_API_KEY="<real-key>" \
  -p 3001:3001 synora-backend:latest

## 4. Verify
curl -f http://<host>:3001/health
curl -f http://<host>:3001/ready
```

#### Dockerfile invariants (do NOT change)

- No `pnpm prune --prod` — corrupts workspace symlinks
- Explicit OpenSSL install — Prisma engine needs it on bookworm-slim
- Non-root `node` user
- `0.0.0.0` bind — container networking
- `.env*` excluded via `.dockerignore`

#### CI pipeline (`.github/workflows/ci.yml`)

| Job | What | Blocking? |
|---|---|---|
| `test` | install → migrate → lint → type-check → test → build → coverage | Yes |
| `security` | `pnpm audit --prod --audit-level=high` → gitleaks → Snyk | Yes |
| `docker` | Build image → smoke-test `/health` | Yes |

#### Environment variables

**Required to boot (staging/prod, fail-closed):**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — symmetric JWT signing key
- `NEXTAUTH_SECRET` — session encryption key

**AI (any one enables generation):**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `XAI_API_KEY`,
  `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`
- Azure: `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT`
- Bedrock: AWS creds + `BEDROCK_REGION` (all three required)
- Ollama: `OLLAMA_BASE_URL`

**Frontend:** `NEXT_PUBLIC_API_URL`

**Operational modes:** `APP_STAGE`, `OFFLINE_MODE`, `MOCK_MODE`,
`ENTERPRISE_MODE`, `GOVERNMENT_MODE`, `SELF_HOSTED_MODE`

Full list: `.env.example` (root + per-app) and
`docs/archive/RELEASE_1_LAUNCH_READINESS.md` §2.

---

### 12. Business Model

#### Pricing tiers (defined in `apps/web/src/content/plans.ts`)

| Tier | Price | Target |
|---|---|---|
| **Free** | $0/mo | Individual creators exploring AI tools |
| **Pro** | $29/mo | Professional creators who need full power |
| **Team** | $79/mo per seat | Teams that collaborate on AI projects |

#### Revenue model

SaaS subscription with usage-based tiers. Billing abstraction (M8) will
be provider-agnostic with Stripe as the first adapter. Plan IDs in the
content module are designed to map directly to billing plan IDs when M8
ships.

#### Not yet implemented

- Payment processing (M8)
- Usage metering and dashboards (M8)
- API key enforcement for external integrations (M6)
- Team seat management (M6)

---

### 13. Roadmap

#### Release 1 — COMPLETE

Launchable core: auth (register, login, refresh, logout, lockout), CRUD
(users, projects, documents), AI text/code generation (10 providers),
security hardening, CI pipeline, Docker production image.

#### Release 2 — IN PROGRESS (9 milestones)

| # | Milestone | Status | Summary |
|---|---|---|---|
| **M1** | Foundation | **Complete** | Design tokens, shared Tailwind preset, 17-component library, typed API client, auth store, TanStack Query + Zustand + next-themes |
| **M2** | Marketing site | **Complete** | Landing, pricing, 6 feature pages, changelog, glass navbar, responsive, dark/light |
| **M3** | Auth/account UX | **Complete** | Login/register rebuilt on the API client, forgot/reset-password, email verification, session management, account/profile settings, avatar upload, mailer + storage abstractions |
| **M4** | Application shell | **Complete** | Workspace routes (create/list/get/rename), notifications, sidebar/topbar/workspace switcher/command palette/keyboard shortcuts, workspace settings, 404/error boundaries |
| **M5** | Core product surfaces | **Next** | Project management UI, document editor, generation history, AI playground, prompt library |
| **M6** | Workspace, security & account | Pending | Team management, invitations, settings, API keys, MFA (rebase `recover/mfa`), CSRF + cookie auth (rebase `recover/csrf`) |
| **M7** | Media generation + assets | Pending | Redis, async job queue, image/video/audio generation, asset manager, file uploads, object storage |
| **M8** | Billing, usage & notifications | Pending | Provider-agnostic billing (Stripe first), subscriptions, usage dashboard, analytics, notifications |
| **M9** | Admin, support & content | Pending | Admin dashboard, monitoring, audit logs, feedback, support center, docs site, blog, API docs |
| **M10** | Quality closeout & ops | Pending | CD pipeline, metrics/alerting, backups, Playwright E2E suite, accessibility pass, mobile polish |

#### Release 3 — PLANNED

Enterprise: workspace multi-tenancy enforcement, SSO/SAML/OIDC, RBAC
depth, audit export, data residency, self-hosting bundle, API versioning
+ OpenAPI, agent/memory architecture candidates.

#### Release 4 — PLANNED

Hyperscale (10M+): Kubernetes, Terraform, multi-region, read replicas,
edge auth, regional cells, self-hosted Synora model serving (interface
designs on `feature/synora-infra-interfaces`).

#### Infrastructure timeline

| Infra | Required before | Status |
|---|---|---|
| Redis (managed) | M7 | Not provisioned |
| S3-compatible bucket | M7 | Not provisioned |
| Stripe test keys | M8 | Not configured |
| Email provider | M6 (invitations) | Abstracted; console transport ships with M3 |
| CD platform | M10 | Not decided |
| Metrics backend | M10 | Not decided |

---

### 14. Non-Negotiable Principles

These are founder-set rules that apply to every line of code, every
architectural decision, and every milestone. They cannot be overridden
without explicit founder approval.

1. **Production-grade and future-proof only.** No temporary solutions. No
   throwaway code. Every module must be built as if it will run in
   production for five years.

2. **Scalable to millions of users.** Every design decision must consider
   horizontal scaling. Nothing may assume single-instance state unless it
   is DB-backed (and scheduled for Redis migration).

3. **Provider-agnostic everywhere.** AI providers, payment providers, email
   providers, and object storage are all replaceable through configuration
   only. The platform must eventually be able to run entirely on Synora's
   own AI models without changing the architecture. No vendor SDK imports
   outside their adapter file.

4. **Launch requires only environment variables and deploy.** At launch:
   set env vars, configure provider keys, deploy. Everything else already
   works. No manual setup steps, no data migrations, no seed scripts.

5. **Preserve every Release 1 guarantee.** API envelope, auth semantics,
   lockout behavior, security invariants — all preserved unless a release
   plan explicitly changes them. Do not rewrite working code unless
   objectively necessary.

6. **UI quality comparable to Linear, Vercel, Framer, Raycast, OpenAI.**
   No generic dashboard templates. Dark mode first, light mode supported,
   accessible, keyboard-shortcut friendly, animated, responsive.

7. **Milestone gating.** After each milestone: lint, typecheck, tests,
   build — all green. Commit. Push. Wait for green CI. Only then continue
   to the next milestone. Never proceed on red.

8. **Design tokens are the only way to define colors and styles.** UI
   colors, radii, and fonts come from the token system. No hardcoded
   palette values in app code.

9. **Auth invariants are immutable.** Refresh tokens stored hashed only
   (SHA-256). Single-use rotation with reuse detection. JWT algorithm
   pinned to HS256. These extend to any new token type (password reset,
   email verification, etc.).

10. **CI gates stay blocking.** The test, security, and docker jobs never
    weaken or skip to get green.

11. **Secrets discipline.** Credentials read only via SecretsManager.
    Never from `process.env` at call sites. Never logged.

12. **Config-only provider swaps.** Adding or selecting any provider (AI,
    mail, payment, storage) must never require code changes at call sites.

---

### 15. Coding Standards

#### Language and typing

- TypeScript strict mode everywhere
- Explicit return types on functions
- No `any` types (use `unknown` if necessary)
- ESM (`"type": "module"`) in backend

#### Naming

- **Files**: PascalCase for components (`Button.tsx`), camelCase for
  utilities and services (`token.service.ts`)
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Types/Interfaces**: PascalCase
- **CSS variables**: kebab-case (`--background`, `--primary`)

#### Commits

Conventional commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
Scopes: `backend`, `web`, `database`, `auth`, `design-system`, etc.

#### Testing

- Every feature ships with unit + integration tests
- Backend: Vitest + Supertest against real Postgres (no DB mocks)
- Frontend: Vitest + Testing Library + jsdom
- Design system: Vitest + Testing Library + jsdom
- E2E (Playwright): arrives in M10
- Test files: `*.test.ts(x)` colocated or in `tests/`

#### Dependencies

- pnpm 10.33.0 (pinned via `packageManager` in root `package.json`;
  corepack picks it up)
- Turbo for build orchestration
- New dependencies: add to the narrowest possible package; prefer
  workspace-level dependencies only for build tools

#### Code comments

- Default to no comments
- Only add when the WHY is non-obvious: hidden constraint, subtle
  invariant, workaround
- Never explain WHAT the code does — well-named identifiers do that
- Never reference the current task/fix/caller — that belongs in the PR

---

### 16. Definition of Production Ready

Synora is production-ready when ALL of the following are true:

#### Already met (Release 1)

- [x] Auth: register, login, refresh, logout with secure token rotation
- [x] AI: real text/code generation through provider abstraction
- [x] CRUD: users, projects, documents fully functional
- [x] Security: all OWASP top-10 mitigations appropriate to current auth
      model are in place
- [x] CI: test, security, docker gates — all blocking, all green
- [x] Docker: multi-stage, non-root, reproducible production image
- [x] Config: typed, stage-aware, fail-closed in production
- [x] Secrets: audited, pluggable, never logged

#### Required (Release 2)

- [x] Marketing site (M2)
- [x] Auth UX: forgot/reset-password, email verification, polished
      login/register, protected routes (M3)
- [x] Session management, account/profile settings, avatar upload (M3)
- [x] Workspace creation + membership-checked routes (M4)
- [x] App shell: sidebar, topbar, workspace switcher, command palette,
      notifications, keyboard shortcuts (M4)
- [ ] Project management UI with real CRUD (M5)
- [ ] AI playground with model selector (M5)
- [ ] Team management, invitations, settings (M6)
- [ ] MFA (M6)
- [ ] Cookie auth + CSRF (M6)
- [ ] Media generation: image/video/audio with queue + storage (M7)
- [ ] Billing: subscription management, usage metering (M8)
- [ ] Admin dashboard with monitoring (M9)
- [ ] CD pipeline with tested rollback (M10)
- [ ] Metrics endpoint + alerting (M10)
- [ ] Playwright E2E suite (M10)

#### Required (Release 3+)

- [ ] Workspace multi-tenancy enforcement
- [ ] SSO/SAML/OIDC
- [ ] API versioning + OpenAPI spec
- [ ] Self-hosting bundle

---

### 17. AI Handover Protocol

When a new AI engineer (human or machine) takes over Synora, follow this
protocol:

#### Step 1: Read these files in order

1. `SYNORA_BRAIN.md` (this file) — permanent intelligence, full context
2. `CURRENT_STATE.md` — point-in-time snapshot (which milestone, which
   commit, what's green, what's broken)
3. `NEXT_TASK.md` — the single next development task with full spec
4. `CLAUDE.md` — coding standards and dev setup
5. `PROJECT_HANDOVER.md` — zero-context entry for humans

#### Step 2: Verify the current state

```bash
git status                    # Check for uncommitted work
git log --oneline -5          # Verify HEAD matches CURRENT_STATE.md
pnpm run lint                 # Must be clean
pnpm run type-check           # Must pass
CI=1 DATABASE_URL=postgresql://synora:synora@localhost:5432/synora pnpm run test
pnpm run build                # Must succeed
```

#### Step 3: Understand what NOT to do

- Do NOT rewrite working code unless objectively necessary
- Do NOT add features beyond what the current milestone specifies
- Do NOT skip the milestone gate (lint → typecheck → test → build → CI)
- Do NOT import vendor SDKs outside their adapter file
- Do NOT use `process.env` outside config/secrets systems
- Do NOT change auth invariants (hash-at-rest, rotation, pinned algorithm)
- Do NOT weaken CI gates
- Do NOT build temporary solutions or throwaway code
- Do NOT hardcode colors — use design tokens
- Do NOT duplicate indexes that `@unique` already provides

#### Step 4: Execute the next task

Read `NEXT_TASK.md`. It contains the full specification: what to build,
what files to create/modify, testing requirements, security requirements,
acceptance criteria, and definition of done. Follow it exactly.

#### Step 5: Close the milestone

1. Run the full gate: `pnpm run lint && pnpm run type-check && CI=1 pnpm run test && pnpm run build`
2. Fix every issue
3. Commit with conventional commit message
4. Push to the designated branch
5. Wait for green CI
6. Update `CURRENT_STATE.md` with the new state
7. Update `NEXT_TASK.md` with the next milestone's spec
8. Update `SYNORA_BRAIN.md` — append to section 19 (AI Memory Log)

---

### 18. Current Next Task

**M6 — Billing (Stripe abstraction, subscriptions, plans, credits, invoices, payment methods)**

Full specification is in the M6 billing design plan and `NEXT_TASK.md` (will be updated at M6 close). Summary:

1. **Provider-agnostic billing abstraction** — `src/billing/` with types, registry, resolver, Stripe provider (first adapter)
2. **Schema additions** — `Plan`, `Subscription`, `Invoice`, `PaymentMethod`, `WorkspaceCredits`, `CreditLedgerEntry`, `UsageRecord`, `ProcessedWebhookEvent` + migration
3. **Services** — plan, subscription, paymentMethod, invoice, credit, webhook
4. **Routes** — workspace-scoped (`/api/workspaces/:id/billing/*`), admin (`/api/admin/billing/*`), webhook (`/api/billing/webhook`)
5. **Frontend** — billing settings tab (plan/payment-methods/invoices/usage), admin pages, design-system `Progress` component
6. **Tests** — provider unit, registry, resolver, service, route, webhook, admin layers
7. **Documentation** — architecture, api, database, security, billing.md, .env updates

#### Note on M5 (previous milestone — complete)

**M5 — Workspace Members, Projects, Folders, Assets, Invitations**, shipped:
workspace-scoped project/document CRUD, folder hierarchy with recursion support,
asset multipart upload integration, email-based workspace invitations with token
acceptance, audit logging for all mutations, permission system (VIEWER/MEMBER/EDITOR/ADMIN/OWNER),
frontend pages for projects/folders/assets/invitations/audit, Sidebar Projects nav
with active-state logic, 47 new backend integration tests, 19 new frontend tests
(632 total backend + web), all verification gates green, PR #37 CI passing.

#### Note on M4 (previous milestone — complete)

**M4 — Application Shell**, per founder instruction on 2026-07-25,
redefined M4 to mean the authenticated application shell rather than
`RELEASE_2_PLAN.md`'s original "Core product surfaces" (which shifted to
M5, with every milestone after it renumbered up one: old
M4→M5, M5→M6, …, M9→M10 — see `RELEASE_2_PLAN.md` §3). M4 shipped:
first-ever workspace backend routes (create/list/get/rename,
membership-checked, OWNER-only writes), a `Notification` model + routes
with real event triggers (no fabricated notification content), and a
full application shell replacing the M3 placeholder — `Sidebar`,
`Topbar`, `WorkspaceSwitcher` + `CreateWorkspaceDialog`,
`NotificationsMenu`, `UserMenu` (with a server-persisted theme
submenu), `Breadcrumbs`, a hand-rolled `CommandPalette` (⌘K, doubles as
header search, no `cmdk` dependency needed), `KeyboardShortcutsDialog`,
a real dashboard empty/overview state, a workspace settings page, and
branded 404/error-boundary pages at both the root and dashboard-shell
level (the latter reachable via a `[...catchAll]` route). Full detail is
in the dated "Release 2 M4" entry in section 19 below.

---

### 19. AI Memory Log

This section is append-only. Every AI engineer who works on Synora adds
entries here documenting what they did, what they learned, and what the
next engineer needs to know. Entries are dated and never deleted.

#### 2026-07-25 — Session: Release 1 + Release 2 M1-M2

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`
**Work completed:**

- **Release 1** (R1-a through R1-h): email-enumeration fix, input
  validation on all routes, refresh token rotation with reuse detection,
  account lockout, 10-provider AI abstraction, production Dockerfile, CI
  security gates, launch readiness documentation
- **Release 2 M1** (Foundation): CSS-variable design tokens (dark-first),
  shared Tailwind preset, 17-component Radix-based design-system library
  (16 tests), fixed a latent gap where Tailwind never compiled (missing
  postcss.config.js), typed API client with single-flight refresh
  rotation, token storage, Zustand auth store, TanStack Query + next-themes
  providers, Geist fonts, legacy pages converted to token classes
- **Release 2 M2** (Marketing site): landing page (hero, stats, features
  grid, pillars, CTA), pricing page + FAQ, six SSG feature pages from one
  template, changelog timeline, glass navbar with mobile menu + theme
  toggle, footer, typed content modules, sitemap/robots/OpenGraph,
  browser-verified desktop/mobile in both themes

**Bugs found and fixed:**

- `@vitest/coverage-v8` missing from design-system devDeps → CI `test`
  job failure. Added the dep.
- `lucide-react` was only available transitively → web test failures.
  Added as direct web dependency.
- Changelog test assertion failure (multiple `<ul>` elements from footer).
  Fixed with `aria-label` query.
- Stale next-server on port 3100 serving old build. Killed and restarted.
- Deleted `page.tsx` not staged with `git rm`. Used `git add -A`.
- Stale `.next/types` after page move caused type-check failure. Rebuilt.
- Redundant `@unique` + `@@index` on `User.email` and `Workspace.slug`.
  Removed the redundant explicit indexes.

**Lessons learned:**

- Always verify Tailwind is actually compiling (check for postcss.config.js)
- The design system's `dist/` output must be built before the web app
  consumes it — Turbo's `dependsOn: ["^build"]` handles this
- Marketing pages should use typed content modules (not inline data) so
  billing (M7) can bind to the same plan IDs
- Browser verification is essential — screenshots caught rendering issues
  that lint/typecheck/tests cannot
- When moving Next.js pages between route groups, delete the old path with
  `git rm` and rebuild to regenerate `.next/types`

**State at handoff:**

- Last pushed commit: `da8b5a1`
- CI: green
- Tests: 312 (backend 273, web 23, design-system 16)
- Working tree: uncommitted PasswordResetToken schema changes (M3 prep)
- PR #31: open, not merged

#### 2026-07-25 — Session: Release 2 M3 (Auth/account UX, scope-narrowed)

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`

**Scope decision:** the founder's task request listed auth screens, email
verification, password reset, session management, and account/profile
settings, but did not mention the onboarding wizard, workspace creation,
or app shell that `NEXT_TASK.md`'s original M3 also specified. Asked via
`AskUserQuestion`; founder chose "auth/account only" — redefine M3 to
exactly that scope and push onboarding/workspace/app-shell into a new
M3.5. `NEXT_TASK.md` now carries the M3.5 spec; this entry documents what
M3 itself shipped.

**Work completed:**

- **Database**: `EmailVerificationToken` model; `RefreshToken` gained
  `userAgent`, `ipAddress`, `lastUsedAt`, `rememberMe` — every refresh
  token row is now a listable/revocable "session." 20 models total.
- **Mailer abstraction** (`apps/backend/src/mail/`): same
  descriptor-registry-resolver-facade shape as the existing AI provider
  abstraction — console transport (default, in-memory testable log) +
  SMTP transport (`nodemailer`). Templates: verify-email, password-reset,
  password-changed, account-deleted, all sharing one inline-CSS layout.
  Deliberately **explicit-config-only** provider selection (never
  auto-detected from credential presence, unlike AI providers) — reasoning
  documented in `docs/architecture.md`: `SecretsManager`'s dev/testing/qa
  placeholder fallback means every secret key "resolves" to something in
  those stages, so credential presence can't signal "really configured"
  the way it can for AI provider keys.
- **Storage abstraction** (`apps/backend/src/storage/`): same pattern —
  local-filesystem provider today (served via `express.static` with
  `Cross-Origin-Resource-Policy: cross-origin`), facade exposes
  `uploadAvatar`/`deleteAvatar`/`avatarKeyFromUrl` with a content-type
  allowlist (png/jpeg/webp/gif).
  Used for the new avatar-upload feature.
- **Sessions**: `token.service.ts` rewritten — `issueTokens` creates the
  `RefreshToken` row first, then signs the access-token JWT with a `sid`
  claim equal to that row's id; `rotateTokens` carries `rememberMe`
  forward and refreshes device metadata. New `session.service.ts`:
  `listSessions`/`revokeSession`/`revokeAllSessions`/`revokeOtherSessions`,
  plus a regex-based User-Agent parser for device/browser/OS labels.
- **New backend routes**: `POST /api/auth/forgot-password` (no
  enumeration), `POST /api/auth/reset-password` (revokes all sessions on
  success), `POST /api/auth/verify-email`, `POST
  /api/auth/resend-verification`, `GET /api/auth/sessions`, `DELETE
  /api/auth/sessions/:id`, `POST /api/auth/logout-all`; `users.ts`
  extended with `PATCH /me`, `POST`/`DELETE /me/avatar`, `POST
  /me/password` (revokes every *other* session), `GET`/`PATCH
  /me/preferences`, `DELETE /me` (soft delete — `status: DELETED`, email
  mangled to `deleted-<id>@deleted.synora.internal`, password nulled,
  frees the original email for reuse, confirmation email sent to the
  original address).
- **Removed** the deprecated `token` alias from login/register responses
  (only `accessToken`/`refreshToken` remain) and the `axios` dependency
  (confirmed zero usages first).
- **Frontend**: full API client coverage (`auth.ts`, new `account.ts`,
  new `sessions.ts`, `FormData`-aware `api.upload`); `useCurrentUser` +
  `useRequireAuth` hooks; rebuilt login (remember-me checkbox, safe
  `next` redirect guarding against `//` open-redirect) and register
  pages; new forgot-password, reset-password, and verify-email pages
  (each using the server-page + Suspense-wrapped client-form split
  required by `useSearchParams()` in the Next.js App Router); dashboard
  layout rewritten on `useRequireAuth`; new settings section
  (`/dashboard/settings/{profile,account,sessions}`) covering profile
  editing + avatar upload, password change, notification preferences,
  account deletion (typed-"DELETE" + password confirmation dialog), and
  session list with per-session revoke + "log out everywhere."
  New design-system `Checkbox` component (Radix-based) added to support
  the remember-me control.
- **Docs**: `docs/api.md`, `docs/database.md`, `docs/architecture.md`
  (new Mailer Abstraction and Storage Abstraction sections),
  `docs/security.md`, `CURRENT_STATE.md`, `PROJECT_HANDOVER.md` all
  updated; `NEXT_TASK.md` replaced with the M3.5 spec.

**Bugs found and fixed (both discovered only by actually running the app,
per `CLAUDE.md`'s browser-verification requirement — neither was caught
by lint/typecheck/tests):**

- **ESM resolution break in `pnpm dev`**: `packages/shared` and
  `packages/database` lacked `"type": "module"`, and
  `packages/shared/src/index.ts`'s `export * from './types/index'` (and
  `./utils/index`) had no `.js` extension. Node's native ESM loader (used
  by `tsx watch`, unlike the bundler-based tooling used for tests/builds)
  enforces extension-required resolution and failed with "does not
  provide an export named 'ApiException'." Fixed by adding the `.js`
  extensions (TypeScript's classic "node" resolution accepts `.js`
  pointing to `.ts` source) and adding `"type": "module"` to both
  packages' `package.json`. Verified with direct
  `node --input-type=module -e "import(...)"` probes and a full
  type-check/test re-run to confirm zero regressions.
- **Mobile sidebar never collapsed**: the dashboard sidebar had no
  mobile-specific positioning, so it stayed docked and pushed content off
  the mobile viewport. Fixed with a `fixed`-positioned overlay sidebar +
  backdrop below the `md:` breakpoint (768px), auto-closing on mount for
  narrow viewports and on navigation-link click.
- **jsdom has no `ResizeObserver`**: Radix `Checkbox`/`Switch` construct
  one internally; only manifested when `PasswordInput` and `Checkbox`
  were rendered together in the same tree during test-writing (isolated
  renders of either passed fine). Fixed with a `ResizeObserverStub`
  polyfill in a new `apps/web/vitest.setup.ts`, wired into
  `vitest.config.ts`'s `setupFiles`.
- iOS user-agent strings contain "like Mac OS X," so
  `session.service.ts`'s `parseUserAgent()` initially misclassified
  iPhones as macOS. Fixed by checking the iOS pattern before the macOS
  pattern.
- A TanStack Query v5 quirk: passing a service function directly as
  `mutationFn` (rather than wrapping it in a zero-arg arrow function)
  causes the library to invoke it with an extra internal second argument,
  which shows up in a `vi.fn()` mock's recorded call args and breaks a
  naive `toHaveBeenCalledWith(x)` assertion. Worth remembering for any
  future direct-reference `mutationFn` usage — either wrap in an arrow
  function, or assert on `.mock.calls[0][0]` instead of the whole args
  array.

**Lessons learned:**

- The provider-agnostic descriptor-registry-resolver-facade pattern (AI
  providers → mail transports → storage providers, three for three now)
  is Synora's default shape for "swap the backend without touching
  callers." New provider-style abstractions should default to this shape
  unless there's a specific reason not to.
- Not every provider-style abstraction should auto-detect from credential
  presence the way AI providers do — when a stage's placeholder-secret
  fallback makes "credential present" always true, the selection must be
  explicit config instead. Evaluate this per-abstraction, don't copy the
  AI-provider auto-detection pattern reflexively.
- Soft-delete (mangled email, nulled password, status flag) beats hard
  delete when other rows (projects, documents, activity logs) hold a
  foreign key to the user and the product needs the vacated email address
  to become reusable immediately.
- `useSearchParams()` in a Next.js App Router client component needs a
  `<Suspense>` boundary above it; the clean way to structure this is a
  thin server `page.tsx` that renders `<Suspense><XForm /></Suspense>`,
  with the real logic in a sibling client component.
- Running `pnpm dev` and actually clicking through the app caught two real
  bugs that a fully green lint/typecheck/test/build gate did not — the
  browser-verification step in `CLAUDE.md` is not redundant with
  automated checks.

**State at handoff:**

- Last pushed commit: this session's M3 closing commit (see `git log` on
  `claude/synora-ai-platform-h5q0k2` for the exact hash)
- Tests: 479 (backend 361, web 98, design-system 20) — all green locally
  (lint, type-check, test, build across all 5 workspace packages)
- PR #31: open, not merged, tracking this branch — verify CI goes green
  on the new commit
- Next task: M3.5 (read `NEXT_TASK.md`) — onboarding wizard, workspace
  creation routes, app shell (workspace switcher, user menu, command
  palette)
- Next task: M3 (read `NEXT_TASK.md`)

#### 2026-07-28 — Session: Release 2 M5–M6 Completion and Production Readiness

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`

**Work completed:**

- **Release 2 M5 (Workspace operations)**: Projects/folders/assets CRUD with multipart upload, workspace invitations (email-based token flow), audit logging for all mutations, role-based permission system (VIEWER/MEMBER/EDITOR/ADMIN/OWNER), frontend pages for all new operations, 47 new backend tests + 19 frontend tests (632 total)
- **Release 2 M6 (Billing system)**: Provider-agnostic billing abstraction (`src/billing/`) with Stripe adapter, Plan/Subscription/Invoice/PaymentMethod/WorkspaceCredits/CreditLedger schema, 6 billing services (plan/subscription/paymentMethod/invoice/credit/webhook), 15 workspace-scoped billing routes + admin routes, webhook processing with idempotency, frontend billing settings tab (4 tabs: plan/payment-methods/invoices/usage), admin plan management UI, Progress component, 45 billing route tests
- **Release 2 production stabilization**: Fixed critical architectural issues (multi-workspace violation in billing routes, API response format inconsistency, TypeScript compilation errors, test route pattern mismatch, Docker entrypoint mismatch, frontend API method mismatch), all production gates green
- **Production readiness documentation**: docs/archive/RELEASE_2_CLOSEOUT.md with comprehensive status, all gates passing, 632+ tests, zero critical vulnerabilities

**Key architectural decisions executed:**

- Workspace as the billing unit (not user-scoped) — Subscription FK to workspace
- Provider-agnostic descriptor-registry-resolver pattern for billing (matching AI/mail/storage abstractions)
- Platform admin role distinct from workspace roles — fresh DB lookup, not JWT claim
- Credits granted only via webhook `invoice.paid` event (prevents double-grant races)
- API response format consistency — all endpoints return raw data (no createApiResponse wrappers)
- Workspace-scoped routing enforced at every layer — 404 for non-members, never 403

**Production gates achieved:**

- ✅ Lint: clean (77 pre-existing warnings in test files)
- ✅ TypeCheck: all 5 packages strict mode green
- ✅ Tests: 632+ passing (backend 432, web 165, design-system 35)
- ✅ Build: production build succeeds
- ✅ Docker: multi-stage image builds successfully
- ✅ Security: no vulnerabilities (pnpm audit, gitleaks, Snyk)

**State at handoff:**

- Latest commit: 4150693 (fix: billing API client PATCH method)
- PR #37 merged to SYNORA
- Branch `claude/synora-ai-platform-h5q0k2` is production-ready
- All Release 2 gates green
- Next: M7 (Media Generation, Asset Manager, Async Queue) — specs in NEXT_TASK.md

#### 2026-07-25 — Session: Release 2 M4 (Application shell, redefined scope)

**Engineer:** AI (Claude)
**Branch:** `claude/synora-ai-platform-h5q0k2`

**Scope decision:** the founder's task request named this milestone "M4"
and listed deliverables — professional dashboard, sidebar, workspace
selector, header, search, global command palette, notifications, profile
menu, workspace settings, breadcrumbs, responsive navigation, keyboard
shortcuts, user preferences, theme persistence, empty states, loading
states, error boundaries, 404, 500 pages — that matched what this file's
prior M3 entry called "M3.5" (`NEXT_TASK.md`'s deferred remainder of the
original M3 scope), not `RELEASE_2_PLAN.md`'s original M4 ("Core product
surfaces"). Rather than ask, this was resolved as a pure renumbering
decision (no product-scope ambiguity — the deliverables list was
unambiguous and exhaustive): "M3.5" was retired and became the real M4,
and everything `RELEASE_2_PLAN.md` originally numbered M4 through M9
shifted down one slot to M5 through M10. `RELEASE_2_PLAN.md` §3,
`CURRENT_STATE.md`, `PROJECT_HANDOVER.md`, `PRODUCT_SPEC.md`,
`docs/architecture.md`, and this file were all updated to the new
numbering in the same session. The deliverables list did not explicitly
mention an onboarding wizard; the design choice made instead (see
below) was to derive "has a workspace" from an empty-state prompt on the
dashboard rather than build a separate onboarding route — this also
directly satisfies the "empty states" deliverable rather than competing
with it.

**Work completed:**

- **Database**: new `Notification` model + `NotificationType` enum
  (SECURITY/ACCOUNT/WORKSPACE/SYSTEM). 21 models total.
- **Workspace backend** (`workspace.service.ts` + `routes/workspaces.ts`):
  `POST /api/workspaces` (slugify + uniqueness-suffix collision
  resolution, creator becomes `OWNER` in the same transaction as
  workspace creation), `GET /api/workspaces` (list mine with role +
  member count), `GET /api/workspaces/:id` (membership-checked — 404 for
  non-members, mirroring the `projects.ts` non-owner-404 pattern already
  established in Release 1), `PATCH /api/workspaces/:id` (OWNER-only —
  403 for a non-owner member, since they already know the workspace
  exists), `GET /api/workspaces/:id/members` (read-only list). A
  `createWorkspace` call also fires a real "Workspace created"
  notification — the very first content a new user's notification center
  ever shows, generated from a genuine event rather than seeded sample
  data.
- **Notification backend** (`notification.service.ts` +
  `routes/notifications.ts`): `GET /api/notifications` (list + unread
  count in one response), `GET /api/notifications/unread-count`, `POST
  /api/notifications/:id/read`, `POST /api/notifications/read-all`.
  Wired to three more real trigger points alongside their existing
  `sendMailBestEffort` email calls: password changed, password reset,
  email verified — using a parallel `notifyBestEffort` helper with the
  same "never fail the operation that already succeeded" discipline as
  the mailer calls.
- **Design-system additions**: `Breadcrumb`/`BreadcrumbList`/
  `BreadcrumbItem`/`BreadcrumbLink`/`BreadcrumbPage`/`BreadcrumbSeparator`
  (shadcn-shaped, `asChild` via `@radix-ui/react-slot` for Next.js
  `Link` composition), `EmptyState` (icon/title/description/action —
  reused for 404 pages, error boundaries, and the dashboard's
  no-workspace state, avoiding four near-duplicate layouts), and a fully
  hand-rolled `Command`/`CommandDialog`/`CommandInput`/`CommandList`/
  `CommandEmpty`/`CommandGroup`/`CommandItem`/`CommandSeparator`/
  `CommandShortcut` set — no `cmdk` dependency, per the original spec's
  "add cmdk only if hand-rolling proves inadequate." Filtering and
  keyboard nav are driven by scanning real DOM attributes
  (`data-command-item`, `data-hidden`, `data-active`) on
  mount/query-change rather than duplicating item state in React, since
  items are declared as JSX children, not a data array.
- **App shell** (`apps/web/src/components/shell/`): `Sidebar` (kept M3's
  browser-verified mobile-overlay behavior, now hosting the
  `WorkspaceSwitcher`), `Topbar` (breadcrumbs, a search-bar-styled button
  that opens the same command palette rather than maintaining a separate
  content-search index that has nothing real to search yet, notifications,
  profile menu), `WorkspaceSwitcher` + `CreateWorkspaceDialog` (the
  create-dialog's open state lives in a shared Zustand store so both the
  switcher's "+ Create workspace" item and the command palette's
  "Create workspace" action open the same dialog instance),
  `NotificationsMenu` (real unread badge, mark-read/mark-all-read,
  genuine "you're all caught up" empty state), `UserMenu` (profile links,
  a theme submenu wired to `useThemePreference`, a keyboard-shortcuts
  trigger, logout), `Breadcrumbs` (derived from `usePathname()` + a small
  route-label map), `CommandPalette` (global ⌘K / Ctrl+K via a
  `window.addEventListener('keydown', ...)` effect; also binds ⌘/ to
  open `KeyboardShortcutsDialog`), `KeyboardShortcutsDialog`.
- **Theme persistence**: `useThemePreference` hook bridges `next-themes`
  (instant, local) with `UserPreferences.theme` (server-side, already
  built as unused plumbing in M3) — on login it hydrates from the server
  value; a user-initiated change updates both together. `providers.tsx`'s
  `ThemeProvider` needed no changes (it already supported `system` via
  the `AUTO` mapping).
- **Dashboard rebuild**: `dashboard/page.tsx` now shows a loading
  skeleton, a genuine `EmptyState` ("create your first workspace") when
  the user has none, or a real workspace overview (avatar-style initial,
  member count, role, created date, a link to workspace settings) when
  they do — the old page's four hardcoded "create image/video/document/
  code" cards linking to routes that didn't exist were removed as
  exactly the kind of dead-link mock UI the milestone's "no mock UI" and
  "do not build temporary components" requirements rule out.
- **Workspace settings page** (`dashboard/settings/workspace/page.tsx`):
  rename form for the OWNER (read-only name display for other members,
  with an explanatory line rather than a form that would just 403), slug
  shown read-only (renaming never changes it), and a read-only member
  list. Added to `SETTINGS_NAV`. Invitations and role management were
  deliberately left out — out of scope until M6, matching the workspace
  backend's own OWNER-only-writes boundary.
- **404 / error boundaries**: root `not-found.tsx`/`error.tsx` (real
  `EmptyState`-based UI, safe to use design-system components since the
  root layout's CSS is guaranteed loaded), `global-error.tsx` (replaces
  the entire root layout on a root-layout-level crash, so it deliberately
  uses inline styles only — it cannot assume the design-system CSS
  bundle loaded). A dashboard-scoped `not-found.tsx`/`error.tsx` keep the
  sidebar/topbar chrome visible; since Next.js only reaches a nested
  `not-found.tsx` for genuinely unmatched paths when there's a matching
  route segment to bubble from, a `dashboard/[...catchAll]/page.tsx` that
  unconditionally calls `notFound()` was added to make the dashboard's
  404 actually reachable for arbitrary bad URLs under `/dashboard/*`
  (confirmed in the production build: it appears as a dynamic `ƒ` route).
- Added `@testing-library/user-event` as a new web devDependency —
  `fireEvent.click` on a Radix `DropdownMenuTrigger` does not reliably
  open the menu under jsdom (the trigger's `aria-expanded` stayed
  `false`); `userEvent.click`'s fuller pointer/mouse/focus event sequence
  does. Radix `DropdownMenuSub` submenus specifically need
  `userEvent.hover()`, not `.click()`, to open (matches Radix's real
  hover-first interaction model).

**Bugs found and fixed (both discovered only by actually driving the app
in a real browser, per `CLAUDE.md`'s browser-verification requirement —
neither was caught by lint/typecheck/unit tests):**

- **Stale notifications after workspace creation**: creating a workspace
  server-side also creates a real "Workspace created" notification, but
  `CreateWorkspaceDialog`'s success handler only invalidated the
  `['workspaces']` TanStack Query cache, not `['notifications']` — the
  bell showed "you're all caught up" for up to 30 seconds (the poll
  interval) after a workspace that had in fact just generated a
  notification. Fixed by invalidating both query keys on success; added
  a regression test spying on `queryClient.invalidateQueries`.
- **Empty command-palette groups kept their heading**: typing a query
  that matched zero items in a `CommandGroup` (e.g. filtering to
  "workspace settings" while an "Actions" group had no match) hid every
  `CommandItem` but left the group's heading text floating with nothing
  under it. Fixed by having `CommandGroup` read the shared `query` from
  context and check its direct children's `value` props, rendering
  `null` for the whole group (heading included) when none match — not
  just a design-system unit-test case, a real visual defect only visible
  by actually opening the palette and typing.
- (Design-system only, not user-visible) `element.scrollIntoView` is not
  implemented in jsdom, which is called from `Command`'s keyboard-nav
  highlight logic; guarded with `?.()` rather than adding another jsdom
  polyfill, since `scrollIntoView` is a genuinely optional browser API
  and the guard is correct in real browsers too.

**Lessons learned:**

- A founder's scope/milestone description doesn't always match the
  session's own internal tracking labels ("M3.5" vs. their "M4") — when
  the deliverables themselves are unambiguous, resolve the numbering
  mismatch unilaterally (it's bookkeeping, not a product decision) and
  document the reasoning, rather than spending a clarifying question on
  something the deliverables list already answered.
- `EmptyState` earns its keep by being reusable across four distinct
  surfaces (404, error boundary, dashboard's no-workspace state, and the
  notification center's "caught up" state) — a good sign a primitive
  belongs in the design system rather than one feature's folder.
- A search bar and a command palette don't need to be two different
  pieces of UI when there's no real content-search index yet — making
  the header's search field just open the palette is honest (it doesn't
  imply content search that doesn't exist) and is exactly how
  Linear/Vercel treat the two before their product has enough indexable
  content to justify a separate search backend.
- Next.js's nested `not-found.tsx` is not reachable for arbitrary
  unmatched URLs the way `error.tsx` is for arbitrary thrown errors — it
  only fires for an explicit `notFound()` call within a segment that DOES
  match a route. A `[...catchAll]` page that calls `notFound()`
  unconditionally is the standard, correct way to make a segment-scoped
  404 page reachable for truly-unmatched sub-paths.
- `global-error.tsx` replaces the entire root layout when it fires,
  so it cannot safely assume any CSS bundle loaded — inline styles are
  the right call there, not a shortcut.
- Radix Dropdown/Submenu components need `@testing-library/user-event`,
  not bare `fireEvent`, to open reliably under jsdom — worth reaching for
  by default on any new Radix-menu test rather than debugging a
  mysteriously-closed menu first.

**State at handoff:**

- Last pushed commit: this session's M4 closing commit (see `git log` on
  `claude/synora-ai-platform-h5q0k2` for the exact hash)
- Tests: 577 (backend 385, web 157, design-system 35) — all green locally
  (lint, type-check, test, build across all 5 workspace packages)
- PR #31: open, not merged, tracking this branch — verify CI goes green
  on the new commit
- Next task: M5 (read `NEXT_TASK.md`) — project management UI, document
  editor, AI playground with a real provider selector, generation
  history, prompt library, all workspace-scoped

---

# Part X — Architectural immunity

Rules that keep Synora replaceable. Added 2026-08-10. These describe what is
**already implemented**; they are recorded so the property is defended rather
than rediscovered.

## X.1 The rule

> Business logic must never learn a vendor's name.

Business logic depends on a **capability**, never on a provider. A provider is
selected by configuration and reached through an adapter. Replacing one is a
configuration change; it is never a rewrite.

```
Synora business logic
      ↓
Capability interface        ai · embeddings · vectordb · storage · mail
      ↓                     billing · queue · tools · crypto · secrets
Provider registry + resolver
      ↓
Provider adapter            one file, owns its SDK and wire format
      ↓
External provider
```

Ten capability layers exist in `apps/backend/src/`. Sixteen AI provider
adapters exist under `ai/providers/`. No business-logic module imports a
vendor SDK.

## X.2 What every provider must declare

`AIProviderDescriptor` (`ai/types/descriptor.ts`) is the contract. The registry
and resolver interact **only** with this shape — never with a provider's SDK,
auth mechanism, or wire format.

| Field | Purpose |
|---|---|
| `id`, `displayName` | Identity |
| `capabilities` | What it can do |
| `isConfigured()` | Are its secrets present? Network-free — it runs on every request |
| `verifyCredential?()` | Cheapest authenticated call proving the credential works |
| `metering` | **Required.** `metered` or `unmetered` |
| `create()` | Builds the adapter |

Two deliberate design decisions worth preserving:

**Credential verification has four states, never a boolean.** `verified`,
`rejected`, `unreachable`, `not-verifiable`. Collapsing `unreachable` into
`rejected` sends an operator hunting a credential fault that does not exist;
collapsing it into `verified` hides a real one. A provider with no cheap check
reports `not-verifiable` honestly rather than faking a pass.

**`metering` is required and never defaulted.** Inferring "free" from a missing
price entry cannot distinguish a genuinely free local runtime from a paid model
nobody has priced. Those look identical to a cost calculation and opposite to a
bill.

## X.3 Every external dependency must have

interface · adapter · capability declaration · configuration boundary ·
failure semantics · observability · cost metadata where applicable · security
requirements · a replacement strategy.

If any is missing, the dependency is not yet abstracted — it is merely wrapped.

## X.4 The future Synora model

A future Synora-trained model enters through the **same descriptor** as every
external provider, and is a peer to them. No module outside the provider layer
learns which one is "ours."

Nothing about a proprietary model is built today. The seam already exists;
building the model before there is a reason to would be architecture theatre.

> The goal is to make model replacement **boring**.

## X.5 The future physical-action seam

Synora may eventually observe and act on physical systems. That capability is
**not built**, and must not be built speculatively. What is recorded here is
the shape it must take when a validated reason exists.

```
observe() → sense() → plan() → requestAction() → authorizeAction()
         → executeAction() → verifyOutcome() → stop()
```

**A model never receives actuator credentials.** The model *proposes*; a
policy-controlled execution layer *decides*. Every physical action must pass
identity, authentication, authorization, capability scope, rate limits,
simulation where possible, human approval where risk requires it, audit log,
telemetry, outcome verification, and fail-safe defaults — with an emergency
stop that does not depend on the model.

This mirrors a boundary Synora already enforces: the internal engineering
platform's execution layer can open a pull request and nothing more. It has no
merge, deploy, or push operation — **the capability is absent, not guarded.**
That is the pattern physical action must inherit.

## X.6 What must not be built

No fake AGI, no fake autonomy, no fake self-training, no speculative robotics,
no unused microservices, no abstraction without a named reason.

Every future-facing seam needs a documented justification. Every
implementation needs current value, or an architectural seam that is explicitly
justified.

> **Optionality without bloat.**

---

# Part XI — Hybrid classical + quantum intelligence

> Added 2026-08-11. Local development only: nothing in this Part is deployed,
> nothing in it changes DNS or infrastructure, and nothing in it costs money
> in its default configuration.

## XI.1 The principle

Synora's intelligence layer routes by **capability**, never by vendor. Part X
established that rule for models. Quantum computing is the first capability
that is not a model at all — it is a different *kind* of computer — and it
enters through the same door:

```
                        SYNORA
                           |
                 Intelligence Orchestrator
                           |
                  +--------+--------+
                  |                 |
            Classical path     Quantum path
                  |                 |
          AI Provider Layer   Quantum Provider Layer
                  |                 |
           models / providers   algorithms / backends
                  |                 |
                  +--------+--------+
                           |
                    Unified result
```

Business logic knows capabilities. It does not know vendors, and it does not
know whether an answer came from a transformer or a statevector.

## XI.2 Why Qiskit is not a dependency

Qiskit is a Python library. Synora's backend is Node.js/TypeScript ESM. There
is no import that makes `qiskit.circuit` reachable from this process, and
manufacturing one would mean a Python runtime inside the production image — a
permanent infrastructure change for a capability nobody has asked to run in
production.

So the coupling is inverted, which is the better direction anyway. Synora
emits **OpenQASM 3** (`quantum/qasm.ts`), the open interchange format that
`qiskit.qasm3`, IBM Quantum Runtime and Amazon Braket all consume. A
Qiskit-based executor reads Synora's circuits without Synora importing Qiskit,
and Synora reads results back through `QuantumExecutionResult` without learning
that Qiskit was involved.

**There is no quantum vendor package in `package.json`, in any layer.** That is
asserted by a test, not by intent.

## XI.3 The execution hierarchy

| Level | What | Cost | Status here |
|---|---|---|---|
| **0** | Local statevector simulator, in-process | free | **VERIFIED** — 37 tests against known quantum states |
| 1 | Free/low-cost cloud simulator | ~free | reachable via IBM adapter; **NOT VERIFIED** |
| 2 | Open-access QPU (IBM free tier) | free at point of use | adapter written; **NOT VERIFIED** |
| 3 | Paid QPU | real money | refused by default, twice over |

`QUANTUM_MAX_EXECUTION_LEVEL` defaults to **0** and bounds *every* path —
explicit and automatic. A ceiling an explicit request could step over would be
decorative. Level 3 additionally requires `QUANTUM_PAID_QPU_ENABLED=true` AND a
non-zero `QUANTUM_MAX_COST_PER_EXECUTION_CENTS`; no default sets either, and a
staging/production boot with the first but not the second is refused at startup
(`assertQuantumLaunchGates`).

## XI.4 Cost control reuses the existing ledger

Quantum spend flows through `ai/spend-guard.ts` via its `knownCostCents`
channel — the same route media and embeddings already use for workloads that
are not token-priced. One ledger, one set of daily/workspace/user caps, one
number that means what an operator thinks it means.

A second quantum budget would have been simpler to write and would have let a
deployment with a $5/day AI cap and a $5/day quantum cap spend $10.

Four refusals, all **before** submission, so a refusal costs nothing:

1. Level 3 without explicit enablement.
2. A metered execution whose cost is **UNKNOWN** — an unknown price is not a
   zero price. `QuantumCost.estimatedCents` is `number | null` for this reason.
3. Cost above the caller's own authorisation, which must be explicit for any
   non-zero spend.
4. Cost above the deployment's per-execution ceiling.

## XI.5 The Quantum Suitability Analyzer

`quantum/suitability.ts`. Pure, synchronous, free, and its job is to say no.

Five verdicts: `NOT_SUITABLE` · `UNKNOWN` · `RESEARCH_CANDIDATE` ·
`SIMULATOR_CANDIDATE` · `QPU_CANDIDATE`. `UNKNOWN` is the default and anything
missing produces it.

Four structural guarantees:

- The strongest expressible benefit is `demonstrated-in-literature` — a
  citation, not a result Synora reproduced. **There is no enum member meaning
  "quantum wins",** and adding one is the single change that would turn the
  analyzer into marketing.
- `classicalBaselineRequired` is the literal type `true`. It cannot be switched
  off, at compile time, by anybody.
- `QPU_CANDIDATE` additionally requires the operator to have raised the
  execution ceiling. Recommending hardware nobody enabled is recommending a bill.
- Every algorithm it names exists in the registry with its assumptions,
  limitations and research status attached.

## XI.6 The algorithm registry — 15 entries, 3 of which execute

**Executable on the local simulator, each with a mandatory classical baseline:**
QAOA (vs exhaustive enumeration), VQE (vs exact diagonalisation by shifted
power iteration), quantum kernel (vs RBF-kernel ridge with the *same* solver,
regulariser and split).

**Described, contract-compatible, deliberately not executable:** QNN, QCNN,
QRL, QBM, quantum reservoir computing, quantum generative models, hybrid
quantum-classical networks, the variational family.

**Textbook references the analyzer names and then explains away:** Grover,
Shor, HHL, Trotterised simulation.

Every entry declares assumptions, a classical baseline, qubit requirement,
limitations, research status, test coverage and references — all required
fields. `requireExecutableAlgorithm()` throws for anything without a `run`
rather than returning a plausible number, because a fabricated benchmark is
indistinguishable from a real one once written down.

## XI.7 "Did quantum actually help?"

`quantum/benchmark/`. Two separate fields, and the separation is the design:

- `outcome` — which side did better on this instance. A measurement.
- `advantageClaim` — the claim. A far higher bar.

**A simulator run can never yield `QUANTUM_ADVANTAGE_DEMONSTRATED`,** and not
as a policy — as a matter of fact. The simulator is a classical program on a
classical CPU; a win there is one classical algorithm beating another. Hardware
must additionally win on objective *and* wall-clock *and* cost, and be
reproducible.

Every result this build can currently produce lands on
**`QUANTUM_ADVANTAGE_NOT_DEMONSTRATED`**. That is the honest state of the field,
not a limitation of the harness.

## XI.8 Knowledge acquisition — legal, not extractive

`knowledge/`. Synora does **not** attempt to acquire another model's knowledge.
There is no code that scrapes, distils or reconstructs Claude, GPT or Gemini,
and "outputs of other AI models" is an explicitly **blocked** catalogue entry.

The rule: a dataset is ingested because its **licence** permits it, never
because it was downloadable. Common Crawl is catalogued and blocked precisely
because it is the most likely future suggestion — Common Crawl *distributes*
the crawl, it does not licence the underlying pages.

`UNKNOWN` is a real licence state and is refused. CC-BY-NC is refused (Synora is
commercial). CC-BY-ND is refused (chunking and embedding *are* derivatives).
Per-item sources like arXiv require a per-item licence; the collection's licence
does not transfer to its items.

The pipeline — policy gate, security scan, validation, normalisation,
deduplication, quality, chunking, embedding, indexing, versioning — **reuses the
existing stack**: `embeddings/chunking.ts`, `EmbeddingService`,
`VectorDBService`, the queue. There is no second vector store and no second
embedding path. A parallel system would have needed its own workspace scoping,
and that is the one it would have got wrong.

**The policy gate has five states** (`knowledge/policy.ts`):
`ALLOWED` · `ALLOWED_WITH_ATTRIBUTION` · `REVIEW_REQUIRED` · `REFUSED` ·
`UNKNOWN`. Only the first two permit ingestion, and `UNKNOWN` never becomes
`ALLOWED` by any path. `REVIEW_REQUIRED` exists because government-portal and
public-domain terms are jurisdictional and genuinely need a human — collapsing
it into `REFUSED` would lose the difference between "not yet" and "no".

**Ingested knowledge is UNTRUSTED DATA** (`knowledge/security.ts`). Markup and
script are stripped before anything reads the text; document-supplied metadata
is stripped of Synora's reserved provenance keys, so a document cannot ship
`sourceName: "World Health Organization"` and forge its own citation;
identifiers are allowlisted against path traversal and cross-tenant collision;
archive expansion is bounded on ratio *and* absolute size; outbound fetches go
through the existing SSRF guard. Prompt injection is **detected and labelled,
never deleted** — a security textbook has to be able to quote the attack it
describes — and the actual defence is `fenceUntrustedContent`, which wraps
every retrieved passage in a per-call random delimiter and tells the model, in
the same message, that the contents are data and not instruction.

**Ingestion jobs are resumable** (`knowledge/jobs.ts`). The cursor is persisted
after every batch, before the next fetch, so a crash costs one batch instead of
re-embedding a whole dataset — which on a metered embedding provider is a bill
paid twice for work already done. `running → running` is a legal transition
*because* a process killed mid-run leaves a job in exactly that state, and
forbidding the self-transition would make the one state a resume exists for the
one state a resume cannot reach. Concurrency is the queue's job, not this
module's.

**Retrieval cannot lose provenance** (`knowledge/retrieval.ts`). A passage whose
source, licence and document id cannot be reconstructed is DROPPED and counted,
not returned bare. Hybrid ranking combines semantic similarity with keyword
overlap, recency and source trust — all computed from indexed metadata, with no
external search vendor — and every citation carries its `signals` breakdown so a
ranking can be explained rather than trusted. Conflicting numbers across sources
are **reported and never resolved**: picking the more trusted source would
manufacture confidence out of a genuine disagreement.

**Not yet durable.** The version catalogue and the job store are in-memory
(`knowledge/ports.ts`), which means ingestion progress does not survive a
restart. The two Prisma models required are written out in that file. This is a
real limitation, recorded rather than discovered.

## XI.9 Configuration — all optional, all safe by default

| Variable | Default | Effect |
|---|---|---|
| `QUANTUM_MAX_EXECUTION_LEVEL` | `0` | free local simulator only |
| `QUANTUM_PAID_QPU_ENABLED` | `false` | paid hardware unreachable |
| `QUANTUM_MAX_COST_PER_EXECUTION_CENTS` | `0` | any non-zero cost refused |
| `QUANTUM_LOCAL_MAX_QUBITS` | `20` | 16 MB of amplitudes |
| `QUANTUM_DEFAULT_SHOTS` / `QUANTUM_DEFAULT_TIMEOUT_MS` | `1024` / `60000` | — |
| `IBM_QUANTUM_API_TOKEN` | unset | IBM provider stays unconfigured |
| `IBM_QUANTUM_BASE_URL` | IBM Runtime | SSRF-validated on every call |
| `IBM_QUANTUM_INSTANCE` / `IBM_QUANTUM_OPEN_ACCESS` | unset / `false` | real devices classified level 3 |

Deliberately **not** added to `config/envCatalog.ts`: that file is the short
list of things a human must actually decide, and the correct quantum answer for
every founder today is "nothing".

## XI.10 Status, stated at the correct rung

- **VERIFIED** — circuit IR, OpenQASM 3/2 emission, local statevector
  simulator, suitability analyzer, budget gates, provenance, benchmark harness,
  QAOA/VQE/quantum-kernel, licence gate and ingestion pipeline. 153 tests.
- **IMPLEMENTED, NOT VERIFIED** — the IBM Quantum adapter. Written against
  IBM's published REST interface and never executed against IBM, because no
  credential exists. Its wire-format decoding is concentrated in three
  `decode*` functions so a first credentialed run corrects a small, local area.
- **SCAFFOLDED** — the Amazon Braket adapter. `unsupportedReason` is set; the
  resolver skips it and says so honestly if named.
- **RESEARCH-ONLY** — the eight described algorithms and four reference entries.
- **NOT BUILT** — no HTTP route exposes any of this. Exposing a new public
  surface is a separate founder decision, and Release 1 is mid-deployment.
