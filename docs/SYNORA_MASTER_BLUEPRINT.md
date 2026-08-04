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

**Missing, named:** persistence (definitions and runs are in-memory,
same stage as evaluation datasets); HTTP routes and UI; usage/cost
metering into the billing ledger; and no live model has ever produced a
plan — the planner's parsing is fully tested, its intelligence is
UNMEASURED — EXTERNAL PROVIDER REQUIRED (or a local OLLAMA_BASE_URL).

---

## 6. Frontend — see `SYNORA_UI_SYSTEM.md`

Surfaces Implemented: marketing (landing, pricing, features, changelog),
auth (login, register, forgot/reset, verify), dashboard shell,
conversations/chat, knowledge, search, admin + engineering dashboard,
share and invite public pages. Studio (media) is Implemented but
credential-gated. Developer portal is Partial.

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
| AI Agents | **Partially implemented** — see §5.9. Engine, registry, permissions, approvals, limits: built and tested. Routes, UI, persistence, model planner: missing. |
| Workflow engine | Not started. Composes on the agent engine's step/validation model. |
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
