# Synora Feature Inventory

**Living document.** Update whenever a feature's real status changes — this
is the record the Engineering Constitution's "never overstate completion"
rule is enforced against.

**Last verified:** 2026-08-04, by direct inspection of the working tree
(routes, services, providers, frontend routes, test files) at commit
`8505491`.

---

## How to read this

Status uses the founder's five categories, and they are assigned by
evidence, not by intent:

| Status | Means |
|---|---|
| **WORKING NOW** | Runs today with no credentials, no cloud, no domain. Local Postgres/Redis are allowed — they are part of the local-first baseline. |
| **WORKING AFTER REAL API KEYS** | Code path complete and tested against its adapter; needs only an API key / env var. No business logic left to write. |
| **WORKING AFTER CLOUD DEPLOYMENT** | Complete but requires deployed infrastructure (managed DB, object storage, domain, TLS). |
| **PARTIALLY IMPLEMENTED** | Real code exists and some of it works; a named part is missing. The missing part is always named. |
| **NOT YET IMPLEMENTED** | No implementation exists. A type, enum value, or interface mentioning it does **not** count as an implementation. |

**Test coverage** is stated as the test files that exist for that area, not
as a percentage — a percentage over a suite that doesn't exercise the real
path is exactly the kind of number this document exists to avoid.

---

## ⚠️ Blueprint documents referenced but absent

The founder directive treats `SYNORA_MASTER_BLUEPRINT.md` and
`SYNORA_UI_SYSTEM.md` as living documents to verify features against.
**Neither exists** — verified absent from the working tree and from every
branch's git history (`git log --all --diff-filter=A`). They have never
been committed to this repository.

This matters because the directive's first verification step is "verify it
belongs to the blueprint." Until those documents exist, that check cannot
be performed, and this inventory is the closest available substitute: it
records what *is*, from which a blueprint of what *should be* can be
written. **Founder decision required** — see §Founder Decisions.

---

## 1. Foundations — WORKING NOW

| Feature | Module | Status | Evidence | Notes |
|---|---|---|---|---|
| Authentication (register, login, refresh rotation, logout-all) | `routes/auth.ts`, `services/token.service.ts` | WORKING NOW | `routes/__tests__/auth*.test.ts`, `services/__tests__/token.service.integration.test.ts` | Custom JWT + rotating refresh tokens. |
| Password reset + email verification | `services/passwordReset.service.ts`, `emailVerification.service.ts` | PARTIALLY IMPLEMENTED | service tests present | Logic complete; **email delivery** needs a mail provider (see §6). Tokens/flows work; the message doesn't leave the building. |
| Account lockout | `services/lockout.service.ts` | WORKING NOW | service test | |
| Sessions + device metadata | `services/session.service.ts` | WORKING NOW | `session.service.test.ts` | Dependency-free user-agent parsing. |
| MFA | `services/mfa/*` | PARTIALLY IMPLEMENTED | `mfa/` tests | Services exist (`mfa.service.ts`, `challenge-token.service.ts`) and `routes/mfa.ts` is present. **Not verified end-to-end in this audit** — treat as partial until a login flow is exercised with it enabled. |
| Workspaces, members, roles | `services/workspace.service.ts`, `permissions.ts` | WORKING NOW | route + service tests | Backend-enforced permissions. |
| Projects, folders, assets | `services/project|folder|asset.service.ts` | WORKING NOW | route + service tests | Asset *storage* is local-disk (see §6). |
| Invitations | `services/invitation.service.ts` | PARTIALLY IMPLEMENTED | service test | Same constraint as password reset: invite records work, the email does not send without a mail provider. |
| Audit log | `services/audit.service.ts` | WORKING NOW | service test | |
| Notifications (in-app) | `services/notification.service.ts` | WORKING NOW | service + route tests | In-app only. Email/push notification channels: NOT YET IMPLEMENTED. |
| CSRF protection | middleware | WORKING NOW | csrf tests | |
| API keys | `services/apiKey.service.ts` | WORKING NOW | service test | |

## 2. AI core — provider-neutral, credential-gated

| Feature | Module | Status | Evidence | Notes |
|---|---|---|---|---|
| Provider abstraction + registry + resolver | `ai/registry.ts`, `ai/resolver.ts` | WORKING NOW | `registry.test.ts`, `resolver.test.ts` | The neutrality seam. Works today with mock/dev-runtime providers. |
| Anthropic, OpenAI, Gemini, Azure OpenAI, Bedrock, DeepSeek, OpenRouter, Together, xAI, OpenAI-compatible | `ai/providers/*.provider.ts` | WORKING AFTER REAL API KEYS | `anthropic.provider.test.ts`, `openaiCompatible.provider.test.ts` | Adapters written. Only the two named have dedicated tests; the rest share the compatible-adapter path. |
| Ollama (local models) | `ai/providers/ollama.provider.ts` | WORKING NOW* | — | *Requires a local Ollama daemon, no credentials or cloud. This is the path to measuring AI quality gates at zero cost. **No dedicated test yet.** |
| Model registry + pricing | `ai/models.ts`, `ai/pricing.ts` | WORKING NOW | `pricing.test.ts` | |
| Streaming (SSE) | `ai/streaming/`, `routes/streaming.ts`, `services/streaming.service.ts` | WORKING NOW | `streaming.integration.test.ts` | |
| Image generation | `services/imageGeneration.service.ts`, `ai/providers/openaiImage.provider.ts` | WORKING AFTER REAL API KEYS | `imageGeneration.service.test.ts` | Returns honest 503 when unconfigured — verified in test. |
| Text-to-speech / audio | `services/audioGeneration.service.ts`, `openaiTextToSpeech.provider.ts` | WORKING AFTER REAL API KEYS | `audioGeneration.service.test.ts` | Honest 503 when unconfigured. |
| Video generation | `services/videoGeneration.service.ts`, `replicateVideo.provider.ts` | WORKING AFTER REAL API KEYS | `videoGeneration.service.test.ts` | Async job abstraction + polling. |
| Capability layer | `services/capabilities.service.ts` | WORKING NOW | `capabilities.service.test.ts` | |

## 3. Chat, conversations, knowledge

| Feature | Module | Status | Evidence | Notes |
|---|---|---|---|---|
| Conversations + messages + folders + templates | `routes/conversations.ts`, `messages.ts`, `conversationFolders.ts`, `conversationTemplates.ts` | WORKING NOW | route tests each | |
| Message branching | `services/branch.service.ts`, `routes/branches.ts` | WORKING NOW | branch tests | |
| Feedback on messages | `services/feedback.service.ts` | WORKING NOW | feedback tests | |
| File attachments | `routes/files.ts` | PARTIALLY IMPLEMENTED | file tests | Upload/processing/download work on local disk. Virus scanning requires a ClamAV service (fail-closed by policy). |
| Sharing (public links) | `services/sharing.service.ts`, `routes/sharing-public.ts` | WORKING NOW | sharing tests | |
| Export / import | `services/export.service.ts`, `import.service.ts` | WORKING NOW | tests | |
| Search (full-text) | `services/search.service.ts` | WORKING NOW | search tests | Postgres FTS. |
| Semantic / vector search | `services/memoryEmbedding.service.ts` | WORKING AFTER REAL API KEYS | `memoryEmbedding.service.test.ts` | pgvector store + provider adapters; gated and returns 503 without an embedding provider. Deliberately does not fabricate embeddings. |
| Memory subsystem (retrieval, ranking, dedup, summarization, lifecycle, GDPR, analytics, cache) | `services/memory*.service.ts` (11 modules) | PARTIALLY IMPLEMENTED | `memory-unit.test.ts` + per-service tests | Non-semantic paths work now; semantic paths inherit the embedding gate above. |
| Prompt templates | `services/promptTemplate.service.ts` | WORKING NOW | tests | |

## 4. Tools, agents, extensibility

| Feature | Module | Status | Evidence | Notes |
|---|---|---|---|---|
| Tool engine (registration, execution, audit, retry, circuit breaker) | `services/tool-engine.service.ts`, `tool.service.ts` | WORKING NOW | `tool-engine.service.test.ts` | |
| HTTP / Webhook tool transport | `services/tool-transport.ts` | WORKING NOW | `tool-transport.test.ts` | Hardened against SSRF: validates every resolved address via the DNS `lookup` hook, refuses private IP literals, follows no redirects. |
| Tool secrets (encrypted) | `services/toolSecret.service.ts` | WORKING NOW | tests | Requires `TOOL_SECRET_MASTER_KEY`. |
| Tool types: GraphQL, Database, Search, File, Browser, Python, **MCP**, Custom | `tools/types.ts` | **NOT YET IMPLEMENTED** | — | These are *enum values only* (`ToolType`). No transport implements them. `MCP = 'MCP'` on line 15 of `tools/types.ts` is the entire MCP presence in this repository. |
| AI Agents (autonomous multi-step) | — | **NOT YET IMPLEMENTED** | — | No agent service, route, or orchestration exists. Every "agent" match in the codebase is `user-agent` HTTP header parsing. |
| Plugin system / Marketplace / Extension system | — | **NOT YET IMPLEMENTED** | — | No matches in the backend source. |
| Workflows / Automation | — | **NOT YET IMPLEMENTED** | — | Background workers exist (BullMQ) but there is no user-facing workflow or automation builder. |

## 5. Billing, admin, analytics

| Feature | Module | Status | Evidence | Notes |
|---|---|---|---|---|
| Plans, subscriptions, credits, invoices, refunds, payment methods | `services/{plan,subscription,credit,invoice,refund,paymentMethod}.service.ts` | WORKING AFTER REAL API KEYS | service + route tests | Stripe abstraction; needs `STRIPE_SECRET_KEY`. |
| Billing webhooks | `services/webhook.service.ts`, `webhook-validation.ts` | WORKING AFTER REAL API KEYS | `billingWebhook.test.ts` | Signature validation + dedup race fixed. |
| Usage tracking + ledger | `services/conversationUsage.service.ts`, `routes/usage.ts` | WORKING NOW | usage tests | Real aggregation. |
| Admin console | `routes/admin.ts`, `adminBilling.ts`, web `(dashboard)/admin` | PARTIALLY IMPLEMENTED | route tests | Engineering panel is rich (see §7). Broader admin surface is thinner. |
| Model registry admin | `routes/modelRegistry.ts` | WORKING NOW | `modelRegistry.test.ts` | |
| Privacy consent | `services/privacyConsent.service.ts` | WORKING NOW | tests | |
| Dataset export | `services/datasetExport.service.ts`, `workers/export-dataset.worker.ts` | WORKING NOW | tests + **privacy probe** | PII redaction proven by the EOS privacy audit, not assumed. |

## 6. Infrastructure adapters — complete, awaiting environment

| Adapter | Module | Status | Unblocked by |
|---|---|---|---|
| Mail | `src/mail/*` | WORKING AFTER REAL API KEYS | SMTP/provider credentials. Default is a log/no-op provider — which is why password reset, verification, and invitations are marked PARTIAL. |
| Object storage | `src/storage/*` | WORKING AFTER CLOUD DEPLOYMENT | S3-compatible bucket + credentials. Local disk works today. |
| Secrets manager | `src/secrets/*` | WORKING NOW | Env source works; HSM source is a documented stub. |
| Redis / queues | BullMQ | WORKING NOW | Local Redis via `docker-compose.dev.yml`. |
| Realtime (Socket.IO presence/typing) | `services/realtime.service.ts` | WORKING NOW | Cookie-handshake auth; join authorization enforced. |

## 7. Engineering Operating System (EOS) — internal platform

38 modules under `apps/backend/src/eos/`, surfaced at
`(dashboard)/admin/engineering`. **437 tests across 37 files, all passing.**

| Feature | Status | Notes |
|---|---|---|
| Event bus, collectors (boot, health, api, memory, worker, queue-depth) | WORKING NOW | |
| Error-rate, latency, cost, latency-drift, provider-degradation monitors | WORKING NOW | Detector-window abstraction shared. |
| Evaluation platform (datasets, graders, runner, case capture) | WORKING NOW | |
| Redaction + privacy coverage audit | WORKING NOW | Probes real egress paths; found 2 real leaks to date. |
| Launch gates (10) with durable measurement store | WORKING NOW | **1 of 10 measured** (privacy, 100% over 2 declared paths). |
| Regression suite with persisted baselines | WORKING NOW | |
| Benchmark importer (versioned, hashed, holdout-preserving) | WORKING NOW | Machinery proven; **no real benchmark data imported yet**, so the benchmark gate remains unmeasured. |
| Proposal engine + draft generator + execution layer | WORKING NOW | Execution layer has no merge/deploy capability by construction. |
| Evidence router (provider routing recommendations) | WORKING NOW | Recommends only; never intercepts. |
| AI judge | NOT WIRED | Needs a credentialed or local model to judge with. |

## 8. Frontend surfaces

| Surface | Path | Status |
|---|---|---|
| Marketing (landing, pricing, features, changelog) | `(marketing)/` | WORKING NOW |
| Auth pages (login, register, forgot/reset, verify) | `auth/` | WORKING NOW |
| Dashboard shell (sidebar, topbar, command palette, notifications, shortcuts) | `(dashboard)/` | WORKING NOW |
| Conversations / chat | `(dashboard)/conversations` | WORKING NOW |
| Knowledge | `(dashboard)/knowledge` | WORKING NOW |
| Search | `(dashboard)/search` | WORKING NOW |
| Studio (media generation) | `(dashboard)/studio` | WORKING AFTER REAL API KEYS |
| Developer portal | `(dashboard)/developer` | PARTIALLY IMPLEMENTED |
| Admin + engineering dashboard | `(dashboard)/admin` | WORKING NOW |
| Share / invite public pages | `share/`, `invite/` | WORKING NOW |
| **AI Canvas** | — | **NOT YET IMPLEMENTED** |
| **Mobile / Desktop / Offline / Sync engine** | — | **NOT YET IMPLEMENTED** (no matches in `apps/web/src`) |

---

## Honest completion summary

- **Implemented and working without credentials:** authentication, workspaces, projects, conversations, chat, branching, search (FTS), tools (HTTP/webhook), usage, audit, notifications, sharing, export/import, the full EOS, and the web shell.
- **Complete but credential-gated:** all 10+ AI providers, image/audio/video generation, embeddings/semantic search, billing, email.
- **Genuinely absent, despite appearing in the directive's feature list:** AI Agents, Plugin System, Marketplace, Extension System, MCP (enum only), Workflows/Automation, AI Canvas, Mobile/Desktop/Offline/Sync, SDK, and the six unimplemented tool transports.

**Launch gates: 1 of 10 measured. Not ready to launch.** That single line is
the only completion figure in this document that is a measurement rather
than a description, and it is the one that governs.

## Founder decisions required

1. **The blueprint documents don't exist.** Options: (a) I draft
   `SYNORA_MASTER_BLUEPRINT.md` from this inventory plus the existing
   `PRODUCT_SPEC.md` / `RELEASE_*_PLAN.md`, for your review and
   correction — *recommended*; (b) you supply them; (c) this inventory
   serves as the blueprint. Without one of these, "verify it belongs to
   the blueprint" cannot be performed and the directive's absent-feature
   list (Agents, Canvas, Marketplace, MCP, Mobile…) cannot be
   distinguished from scope that was never committed to.
2. **GitHub Actions billing** remains blocked — no CI verdict on any
   commit since ~17:30 UTC 2026-08-03.
