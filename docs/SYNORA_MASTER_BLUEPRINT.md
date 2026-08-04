# Synora Master Blueprint

**Canonical architecture and capability document.**
**Created:** 2026-08-04 · **Maintained:** update during development, never retroactively.

---

## 0. What this document is, and how it came to exist

This blueprint was **reconstructed from the repository**, not written ahead
of it. It was commissioned after the founder directive referenced
`SYNORA_MASTER_BLUEPRINT.md` and `SYNORA_UI_SYSTEM.md` as existing living
documents, and a search of the working tree and of every branch's git
history (`git log --all --diff-filter=A`) established that neither had ever
been committed.

It was assembled by inspecting: 43 backend route modules, 60+ services, 16
AI provider adapters, 121 Prisma models, 10 background workers, 14
middleware modules, 38 EOS modules, 27 design-system components, 49 web
components, the 28 Release 3 specifications in
`docs/release3/specifications/`, and ~180 documents under `docs/`.

**The four status labels are used strictly:**

| Label | Meaning |
|---|---|
| **Implemented** | Code exists, runs, and has tests. Credential-gating is noted separately — a complete adapter awaiting an API key is Implemented, not Partial. |
| **Partially implemented** | Real code exists; a named part is missing. The missing part is always named. |
| **Planned** | Committed to in an existing specification or release plan, not yet built. |
| **Future vision** | Directionally intended, not specified, not committed. |

**Rules governing this document** (from the founder directive):
- Never document a feature that does not exist.
- Never remove a documented capability without recording why, in §12.
- Update automatically during development.

An enum value, a type, or an interface **is not an implementation**. That
rule is what separates this document from a brochure.

---

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

**Missing, named:** event triggers (only a clock can start a workflow —
nothing reacts to a file arriving or a webhook firing); timezone support
(UTC only); and per-run cost metering. The scheduler is also tested only against an injected clock — it
has never been observed running over real elapsed time.

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

**Missing, named:** dragging (movement is by nudge button — the first
version deliberately avoids committing to an interaction model before
anyone has arranged a real canvas); zoom; grouping; connections between
blocks; and inline previews of linked runs or conversations, which
currently show their type and id only.

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
| Workflow engine | **Partially implemented** — see §5.10. Authored steps, immutable versioning, authoring-time validation, durability, HTTP routes, UI, clock-based scheduling and its UI: built and tested, executing through the agent run engine rather than a second copy of it. Event triggers and timezones: missing. |
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
