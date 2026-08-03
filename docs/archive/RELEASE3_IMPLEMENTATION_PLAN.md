# Release 3 Implementation Plan — Universal AI Workspace

**Status:** Planning document. Converts the approved Release 3 architecture
(conversational AI workspace: chat, branching, knowledge management, search,
sharing, files/tools, analytics, collaboration) into sequenced, independently
shippable milestones.

**Source:** Release 3 architecture design (system topology, Prisma schema,
API surface, service layer, real-time architecture, security model,
performance strategy, testing strategy, DevOps plan — see architecture
design doc / PR #38 description for full detail). This document does not
repeat that design; it sequences it into buildable, testable increments.

**Relationship to PR #38:** PR #38 ("Release 3 M1–M3: Chat Platform Backend
Foundation") has already landed a first pass at the Prisma schema (17 models
including Conversation, Message, MessageBranch, ConversationFolder,
PromptTemplate, SharedConversation, StreamingJob, Tool/ToolCall,
ConversationUsage) plus `conversationService`, `messageService`, and
`streamingService` with initial routes and tests. Milestones **M1–M5** below
describe that same slice at finer grain; where PR #38 already covers a
milestone's scope, its "Estimated effort" should be read as **remaining**
work (route hardening, missing edge cases, docs, frontend), not from-scratch
effort. Every milestone from **M6 onward is net-new** relative to the
current branch.

**No code is written as part of this plan.** Every milestone below is a
unit of future implementation work.

---

## Ordering Principle

Milestones are sequenced to keep `main`/the release branch green at every
step and to minimize blast radius:

1. **Schema and backend service milestones ship before the frontend that
   depends on them**, and each backend milestone is independently testable
   against the existing CI Postgres service with no new infrastructure.
2. **New infrastructure dependencies (Redis/queue, Elasticsearch, Vector DB,
   S3, WebSocket) are each isolated into their own milestone**, gated behind
   config/feature flags so their absence in a given environment degrades
   gracefully (e.g., search disabled) rather than breaking the app.
3. **High-blast-radius / high-uncertainty work is pushed to the end**:
   semantic search (new paid external dependency), and real-time
   collaborative editing (concurrency correctness) are the two highest-risk
   milestones and are scheduled last among features, immediately before the
   hardening pass.
4. **Every milestone ends in a mergeable, fully-tested state** — no
   milestone depends on a *future* milestone to pass CI. Frontend milestones
   that need a backend capability are ordered strictly after that
   capability's backend milestone.

---

## Milestone Summary

| # | Milestone | Phase | Risk | Est. Effort | Depends On |
|---|-----------|-------|------|-------------|------------|
| M1 | Chat data model foundation | Core Chat | Low | 2d | — |
| M2 | Conversation service & API | Core Chat | Low | 3d | M1 |
| M3 | Message service & API (sync generation) | Core Chat | Low | 3d | M2 |
| M4 | Background job queue (Redis/BullMQ) | Core Chat | Medium | 3d | M3 |
| M5 | SSE streaming endpoint | Core Chat | Medium | 3d | M4 |
| M6 | Frontend: conversations list & management | Core Chat | Low | 4d | M2 |
| M7 | Frontend: chat interface + streaming | Core Chat | Medium | 5d | M5, M6 |
| M8 | Threading & branching (schema/service/API) | Threading | Medium | 4d | M3 |
| M9 | Frontend: branch selector & regenerate/edit | Threading | Low | 3d | M8, M7 |
| M10 | Prompt & template library (schema/service/API) | Knowledge | Low | 3d | M2 |
| M11 | Frontend: prompt/template library + autocomplete | Knowledge | Low | 4d | M10, M7 |
| M12 | Conversation folders (schema/service/API/UI) | Organization | Low | 3d | M6 |
| M13 | Usage & cost accounting (schema/service) | Usage | Medium | 3d | M3, M4 |
| M14 | Frontend: usage footer & summary dashboard | Usage | Low | 3d | M13 |
| M15 | Full-text search infra (Elasticsearch + indexer) | Search | Medium | 4d | M4 |
| M16 | Full-text search API & UI | Search | Low | 3d | M15 |
| M17 | Semantic search infra (Vector DB + embeddings) | Search | High | 5d | M15 |
| M18 | Semantic search API & UI integration | Search | High | 3d | M17, M16 |
| M19 | Sharing & invites (schema/service/API) | Sharing | Medium | 3d | M2 |
| M20 | Frontend: share modal & invite acceptance | Sharing | Low | 3d | M19 |
| M21 | Real-time presence (WebSocket server) | Sharing | Medium | 4d | M19 |
| M22 | File uploads (schema/S3 infra/API) | Files & Tools | Medium | 4d | M3 |
| M23 | Frontend: file upload UI & attachment rendering | Files & Tools | Low | 3d | M22 |
| M24 | Tool definitions & execution (schema/service/API) | Files & Tools | High | 5d | M4, M22 |
| M25 | Frontend: tool management & result rendering | Files & Tools | Medium | 3d | M24 |
| M26 | Export & version history (schema/service) | History | Medium | 4d | M8 |
| M27 | Frontend: version history & export UI | History | Low | 3d | M26 |
| M28 | Analytics dashboard (ledger, breakdowns, charts) | Analytics | Low | 4d | M13, M14 |
| M29 | Real-time collaborative message editing | Collaboration | High | 6d | M21 |
| M30 | Performance, E2E suite & launch hardening | Launch | Medium | 6d | All above |

**Total estimated effort:** ~113 engineer-days (~23 weeks at 1 engineer,
~11–12 weeks at 2 engineers working parallel tracks per the dependency
graph). **Total estimated LOC:** ~23,400 (close to the architecture
document's ~21,900 estimate; the delta is finer-grained milestone
overhead — tests and docs per slice rather than per phase).

---

## Phase 1 — Core Chat Foundation

### M1 — Chat data model foundation

- **Goal:** Land the core Prisma schema for conversations and messages so
  every later milestone has a stable, migrated data model to build against.
- **Files:** `packages/database/prisma/schema.prisma`,
  `packages/database/prisma/migrations/<timestamp>_add_chat_core/`
- **Database changes:** Add `Conversation`, `Message` models,
  `MessageRole` / `MessageStatus` enums, FKs to `Workspace`/`User`, indexes
  `(workspaceId, createdAt)`, `(conversationId, createdAt)`, `(parentId)`.
  No data migration needed (additive only).
- **API changes:** None yet — schema only.
- **Frontend changes:** None.
- **Tests:** Prisma migration smoke test (`db:migrate` runs clean against
  CI Postgres); schema-level Zod/type generation check.
- **Documentation:** `docs/database.md` — add Conversation/Message section.
- **Acceptance criteria:** Migration applies cleanly on a fresh DB and on
  top of the current Release 2 schema; `pnpm run db:generate` produces
  working Prisma client types; no existing model/relation is altered.
- **Estimated LOC:** 250 (schema + migration SQL)
- **Estimated effort:** 2 days
- **Dependencies:** None
- **Risk level:** Low — purely additive schema change.

### M2 — Conversation service & API

- **Goal:** CRUD and lifecycle management for conversations, workspace-scoped.
- **Files:** `apps/backend/src/services/conversation.service.ts`,
  `apps/backend/src/routes/conversations.ts`,
  `apps/backend/src/services/__tests__/conversation.service.test.ts`,
  `apps/backend/src/routes/__tests__/conversations.test.ts`
- **Database changes:** None beyond M1.
- **API changes:** `POST/GET/PATCH/DELETE /api/workspaces/:id/conversations`,
  `GET /api/workspaces/:id/conversations/:conversationId` (per architecture
  doc §2). Enforces workspace-membership permission check (404 on
  non-member, matching Release 2 convention).
- **Frontend changes:** None.
- **Tests:** Service unit tests (create/list/update/archive/delete,
  permission rejection); Supertest integration tests for all 5 endpoints.
- **Documentation:** `docs/api.md` — conversations section.
- **Acceptance criteria:** All endpoints pass integration tests; pagination
  and archived-filter query params work; non-member requests return 404.
- **Estimated LOC:** 500
- **Estimated effort:** 3 days
- **Dependencies:** M1
- **Risk level:** Low

### M3 — Message service & API (synchronous generation)

- **Goal:** Message CRUD plus a first, deliberately simple AI-response path
  (synchronous, blocking call to the existing AI provider abstraction) so
  the request/response contract is validated before streaming complexity
  is introduced in M4/M5.
- **Files:** `apps/backend/src/services/message.service.ts`,
  `apps/backend/src/routes/messages.ts`, associated test files.
- **Database changes:** None beyond M1.
- **API changes:** `POST/GET/PATCH/DELETE` message endpoints per
  architecture §2 (`.../messages`, `.../messages/:messageId`). On
  `role=USER`, synchronously calls `aiService` (existing provider
  abstraction) and stores the assistant reply before responding — no SSE
  yet.
- **Frontend changes:** None.
- **Tests:** Unit tests for prompt-context building (windowed history);
  integration tests covering create → synchronous assistant reply → stored
  token counts.
- **Documentation:** `docs/api.md` — messages section, noting streaming
  arrives in M5.
- **Acceptance criteria:** Sending a user message returns a completed
  assistant message in the same HTTP response; input/output token counts
  are recorded on the `Message` row.
- **Estimated LOC:** 550
- **Estimated effort:** 3 days
- **Dependencies:** M2
- **Risk level:** Low — reuses the existing, already-tested AI provider
  abstraction; no new infra.

### M4 — Background job queue (Redis / BullMQ)

- **Goal:** Introduce the queue infrastructure needed for async generation,
  search indexing, and later workers, without yet changing the message flow.
- **Files:** `apps/backend/src/queue/connection.ts`,
  `apps/backend/src/queue/queues.ts`, `docker-compose.dev.yml` (redis
  service — already present per `CLAUDE.md`, just consumed here for the
  first time), `apps/backend/src/config/schema.ts` (queue env vars),
  `apps/backend/src/queue/__tests__/connection.test.ts`
- **Database changes:** None.
- **API changes:** None (infra-only milestone).
- **Frontend changes:** None.
- **Tests:** Queue connects/enqueues/dequeues a no-op job in a test Redis
  instance in CI; graceful-degradation test (queue unavailable → clear
  startup error, not a silent no-op).
- **Documentation:** `docs/deployment.md` — Redis requirement; `.env.example`
  additions (`REDIS_URL`, `QUEUE_PROVIDER`).
- **Acceptance criteria:** CI workflow gains a Redis service container;
  queue module boots cleanly in dev, test, and CI; no route yet depends on it.
- **Estimated LOC:** 350
- **Estimated effort:** 3 days
- **Dependencies:** M3 (queue will carry generation jobs next, but ships
  independently first)
- **Risk level:** Medium — first new piece of infrastructure in the stack;
  CI workflow changes carry the same class of risk seen with the earlier
  Postgres-readiness fix.

### M5 — SSE streaming endpoint

- **Goal:** Move message generation from M3's synchronous call onto the
  M4 queue, and stream tokens to the client as they arrive.
- **Files:** `apps/backend/src/routes/streaming.ts`,
  `apps/backend/src/services/streamingService.ts` (job lifecycle — already
  partially scaffolded in PR #38), `apps/backend/src/queue/workers/generateResponse.worker.ts`
- **Database changes:** `StreamingJob` model (already added in PR #38) —
  add any missing fields (`retryCount`, `lastHeartbeatAt`) discovered
  during implementation; stale-job cleanup index.
- **API changes:** `GET /api/workspaces/:id/conversations/:conversationId/stream`
  (SSE, `token`/`done`/`error` events per architecture §5). `POST messages`
  now returns `202`-style pending message + spawns the worker job instead
  of blocking.
- **Frontend changes:** None yet (M7 consumes this).
- **Tests:** Worker unit tests (success, retry, failure paths); SSE
  integration test asserting `token` events arrive and a terminal `done`
  event includes usage counts.
- **Documentation:** `docs/api.md` — SSE contract and reconnect semantics.
- **Acceptance criteria:** A message create request returns immediately;
  a client subscribed to `/stream` receives incremental tokens and a final
  `done` event with accurate token counts; a worker crash surfaces as an
  `error` event, not a hung connection.
- **Estimated LOC:** 600
- **Estimated effort:** 3 days
- **Dependencies:** M4
- **Risk level:** Medium — streaming correctness and worker failure modes
  are the main sources of subtle bugs in this phase.

### M6 — Frontend: conversations list & management

- **Goal:** First user-facing surface — browse, create, rename, archive,
  delete conversations.
- **Files:** `apps/web/src/app/(dashboard)/conversations/page.tsx`,
  `apps/web/src/lib/api/conversations.ts`,
  `apps/web/src/hooks/useConversations.ts`, component tests.
- **Database changes:** None.
- **API changes:** None (consumes M2).
- **Frontend changes:** Conversations list page (search/sort, empty state,
  "New Conversation" CTA), rename/archive/delete actions, TanStack Query
  hooks with optimistic update + cache invalidation.
- **Tests:** Vitest + Testing Library — list rendering, create flow, rename,
  archive/delete confirmation.
- **Documentation:** None (UI is self-documenting; no architecture doc
  change).
- **Acceptance criteria:** A user can create, view, rename, archive, and
  delete a conversation entirely through the UI, verified against the real
  backend in a browser smoke test (per `CLAUDE.md`'s UI-testing requirement).
- **Estimated LOC:** 700
- **Estimated effort:** 4 days
- **Dependencies:** M2
- **Risk level:** Low

### M7 — Frontend: chat interface + streaming

- **Goal:** The core chat experience — message list, input, live token
  streaming.
- **Files:** `apps/web/src/app/(dashboard)/conversations/[id]/page.tsx`,
  `apps/web/src/components/chat/MessageList.tsx`,
  `apps/web/src/components/chat/MessageInput.tsx`,
  `apps/web/src/hooks/useMessageStream.ts`, component tests.
- **Database changes:** None.
- **API changes:** None (consumes M3/M5).
- **Frontend changes:** Virtualized message list, auto-expanding input with
  cmd+enter send, `EventSource`-based streaming hook with reconnect/backoff,
  per-message token count + copy action, loading/error states.
- **Tests:** Component tests with a mocked `EventSource`; one browser smoke
  test driving an actual streamed response end-to-end.
- **Documentation:** None.
- **Acceptance criteria:** Sending a message shows the assistant response
  streaming in token-by-token; network interruption shows a retry affordance
  rather than a silent hang; verified live in a browser per `CLAUDE.md`.
- **Estimated LOC:** 900
- **Estimated effort:** 5 days
- **Dependencies:** M5, M6
- **Risk level:** Medium — the interaction between SSE reconnect logic and
  React state is the most failure-prone UI code in the whole release.

---

## Phase 2 — Threading & Knowledge

### M8 — Threading & branching (schema/service/API)

- **Goal:** Enable alternative-response branches at any message.
- **Files:** `packages/database/prisma/schema.prisma` (`MessageBranch`
  model — already scaffolded in PR #38, finish relations/indexes),
  `apps/backend/src/services/branch.service.ts`,
  `apps/backend/src/routes/branches.ts`.
- **Database changes:** `MessageBranch` model + `Message.branchId` FK;
  index `(conversationId, parentMessageId)`; unique constraint on
  `(conversationId, parentMessageId, title)`.
- **API changes:** `POST/GET/PATCH/DELETE` branch endpoints per
  architecture §2 (create, list, activate, delete).
- **Frontend changes:** None yet.
- **Tests:** Service tests for branch creation (spawns a new generation job
  via M4/M5), activation swapping the canonical path, cascade delete of a
  branch's messages.
- **Documentation:** `docs/api.md` — branching section.
- **Acceptance criteria:** Creating a branch at any message produces an
  independent message sub-tree; activating a branch changes which path
  `GET messages` returns by default; deleting a branch removes only its
  messages.
- **Estimated LOC:** 600
- **Estimated effort:** 4 days
- **Dependencies:** M3
- **Risk level:** Medium — tree/graph integrity (cascade deletes, active-
  branch bookkeeping) is easy to get subtly wrong.

### M9 — Frontend: branch selector & regenerate/edit

- **Goal:** Let users see, switch between, and create branches from the UI.
- **Files:** `apps/web/src/components/chat/BranchSelector.tsx`,
  edits to `MessageList.tsx`/`MessageInput.tsx` from M7.
- **Database/API changes:** None (consumes M8).
- **Frontend changes:** Per-message "regenerate" and "edit → branch" actions,
  branch dropdown ("Main", "Alternative 1", …), branch-aware message list
  rendering.
- **Tests:** Component tests for branch switch, regenerate action, edit-
  creates-branch flow.
- **Documentation:** None.
- **Acceptance criteria:** Editing a past user message creates a branch and
  regenerates from that point without losing the original path; verified
  live in browser.
- **Estimated LOC:** 500
- **Estimated effort:** 3 days
- **Dependencies:** M8, M7
- **Risk level:** Low

### M10 — Prompt & template library (schema/service/API)

- **Goal:** Reusable system prompts and conversation-starter templates.
- **Files:** `packages/database/prisma/schema.prisma` (`Prompt`,
  `Template`), `apps/backend/src/services/prompt.service.ts`,
  `apps/backend/src/services/template.service.ts`,
  `apps/backend/src/routes/prompts.ts`, `apps/backend/src/routes/templates.ts`.
- **Database changes:** `Prompt` (versioned, rateable) and `Template`
  models per architecture §1; indexes on `(workspaceId)`, `(isPublic)`,
  `(category)`.
- **API changes:** Full CRUD + `/use` and `/rate` endpoints for prompts
  (architecture §2); CRUD for templates.
- **Frontend changes:** None yet.
- **Tests:** Versioning test (edit creates new version, preserves parent
  link); usage-counter increment; rating aggregation.
- **Documentation:** `docs/api.md` — prompts/templates section.
- **Acceptance criteria:** Editing a prompt creates a new version without
  mutating the original; usage/rating counters are race-safe under
  concurrent increments.
- **Estimated LOC:** 650
- **Estimated effort:** 3 days
- **Dependencies:** M2
- **Risk level:** Low

### M11 — Frontend: prompt/template library + autocomplete

- **Goal:** Surfaces for browsing/using prompts and templates, plus
  in-context autocomplete while composing a message.
- **Files:** `apps/web/src/app/(dashboard)/prompts/page.tsx`,
  `apps/web/src/app/(dashboard)/templates/page.tsx`,
  `apps/web/src/components/chat/PromptAutocomplete.tsx`.
- **Database/API changes:** None (consumes M10).
- **Frontend changes:** My Prompts / Public Library / Templates tabs,
  category filters, star rating UI, "Start conversation from template" flow
  that seeds a new conversation via M2.
- **Tests:** Component tests per tab; autocomplete trigger/selection test.
- **Documentation:** None.
- **Acceptance criteria:** Starting a conversation from a template pre-
  populates the system prompt and (if defined) the first user message,
  verified live in browser.
- **Estimated LOC:** 750
- **Estimated effort:** 4 days
- **Dependencies:** M10, M7
- **Risk level:** Low

---

## Phase 3 — Organization & Usage

### M12 — Conversation folders (schema/service/API/UI)

- **Goal:** Hierarchical organization of conversations.
- **Files:** schema `ConversationFolder`, `apps/backend/src/services/folder.service.ts`
  (chat-specific — distinct from the existing Release 2 asset `folder.service.ts`),
  `apps/backend/src/routes/conversationFolders.ts`,
  `apps/web/src/components/sidebar/FolderTree.tsx`.
- **Database changes:** `ConversationFolder` model (self-referential
  hierarchy) + `Conversation.folderId` FK.
- **API changes:** CRUD for folders; `PATCH conversations/:id` accepts
  `folderId` to move a conversation.
- **Frontend changes:** Collapsible folder tree in the sidebar with
  drag-to-move (reuses drag primitives from the Release 2 asset browser
  where possible).
- **Tests:** Cascade-on-delete test (folder deleted → conversations'
  `folderId` set null, not cascade-deleted); UI drag-drop test.
- **Documentation:** `docs/api.md` — folders section.
- **Acceptance criteria:** Deleting a folder never deletes conversations;
  moving a conversation between folders updates instantly (optimistic UI)
  and survives a refresh.
- **Estimated LOC:** 700
- **Estimated effort:** 3 days
- **Dependencies:** M6
- **Risk level:** Low

### M13 — Usage & cost accounting (schema/service)

- **Goal:** Per-conversation and per-workspace token/cost tracking, wired
  into the generation pipeline from M5.
- **Files:** schema `ConversationUsage` (scaffolded in PR #38 — finish
  cost-calc logic), `apps/backend/src/services/usage.service.ts`,
  edits to `generateResponse.worker.ts` (M5) to call `recordUsage`.
- **Database changes:** `ConversationUsage` finalized; provider pricing
  table/constant (`apps/backend/src/ai/pricing.ts`) mapping model → per-
  token cost.
- **API changes:** `GET .../conversations/:id/usage` (architecture §2).
- **Frontend changes:** None yet.
- **Tests:** Cost-calculation unit tests per provider/model; integration
  test asserting a completed generation increments both conversation usage
  and the existing Release 2 `CreditLedgerEntry`/workspace balance.
- **Documentation:** `docs/api.md` — usage section; note in
  `docs/architecture.md` that AI spend now debits the same credit ledger
  used by Release 2 billing.
- **Acceptance criteria:** A completed AI response deducts the correct
  credit amount from the workspace balance exactly once, even under
  worker retry (idempotency key on the ledger entry).
- **Estimated LOC:** 500
- **Estimated effort:** 3 days
- **Dependencies:** M3, M4
- **Risk level:** Medium — must not double-charge on worker retry; touches
  the existing billing/credit system, so a mistake here has direct revenue
  impact.

### M14 — Frontend: usage footer & summary dashboard

- **Goal:** Make usage/cost visible to users at both the per-conversation
  and workspace level.
- **Files:** `apps/web/src/components/chat/UsageFooter.tsx`,
  `apps/web/src/app/(dashboard)/settings/usage/page.tsx` (extends the
  existing Release 2 usage page rather than replacing it).
- **Database/API changes:** None (consumes M13).
- **Frontend changes:** Per-conversation footer ("Input: 1.2K | Output: 450
  | Cost: $0.003"); workspace usage summary cards + date-range filter.
- **Tests:** Component tests with mocked usage data.
- **Documentation:** None.
- **Acceptance criteria:** Usage footer updates live as a response streams
  in; summary page numbers match the ledger from M13, verified against a
  seeded test conversation.
- **Estimated LOC:** 450
- **Estimated effort:** 3 days
- **Dependencies:** M13
- **Risk level:** Low

---

## Phase 4 — Search

### M15 — Full-text search infra (Elasticsearch + indexer)

- **Goal:** Stand up search infrastructure and get messages indexed,
  without yet exposing a search API.
- **Files:** `apps/backend/src/search/client.ts`,
  `apps/backend/src/search/mapping.ts`,
  `apps/backend/src/queue/workers/indexMessage.worker.ts`,
  `docker-compose.dev.yml` (elasticsearch service).
- **Database changes:** None.
- **API changes:** None (infra-only).
- **Frontend changes:** None.
- **Tests:** Indexer worker test against a test Elasticsearch container in
  CI; mapping schema validation.
- **Documentation:** `docs/deployment.md` — Elasticsearch requirement;
  `.env.example` additions (`ELASTICSEARCH_URL`).
- **Acceptance criteria:** Every completed message is indexed within one
  worker cycle; app continues to function with search disabled if
  `ELASTICSEARCH_URL` is unset (feature-flagged, not a hard dependency).
- **Estimated LOC:** 400
- **Estimated effort:** 4 days
- **Dependencies:** M4
- **Risk level:** Medium — new external service in CI and production;
  first milestone that must degrade gracefully when absent.

### M16 — Full-text search API & UI

- **Goal:** Expose search to users.
- **Files:** `apps/backend/src/services/search.service.ts`,
  `apps/backend/src/routes/search.ts`,
  `apps/web/src/components/sidebar/SearchBar.tsx`.
- **Database changes:** None.
- **API changes:** `GET /api/workspaces/:id/search?q=...` (architecture §2
  `searchConversations`).
- **Frontend changes:** Sidebar search input with debounce, result list
  with highlighted snippets.
- **Tests:** API test with seeded indexed messages; UI test for debounce/
  highlight rendering.
- **Documentation:** `docs/api.md` — search section.
- **Acceptance criteria:** Searching returns workspace-scoped results only
  (no cross-workspace leakage); empty query returns no results, not an error.
- **Estimated LOC:** 450
- **Estimated effort:** 3 days
- **Dependencies:** M15
- **Risk level:** Low

### M17 — Semantic search infra (Vector DB + embeddings)

- **Goal:** Stand up embedding generation and vector storage for
  meaning-based search, isolated from the full-text path.
- **Files:** `apps/backend/src/search/vectorClient.ts`,
  `apps/backend/src/queue/workers/generateEmbedding.worker.ts`,
  provider-agnostic embedding wrapper reusing the existing AI provider
  abstraction (`apps/backend/src/ai/embeddings.ts`).
- **Database changes:** None in Postgres (vectors live in the external
  vector DB); optionally a `Message.embeddingStatus` column for
  observability.
- **API changes:** None yet.
- **Frontend changes:** None.
- **Tests:** Embedding worker test against a test/mock vector DB; retry-
  on-embedding-provider-failure test.
- **Documentation:** `docs/deployment.md` — Vector DB provider setup
  (Pinecone/Weaviate), cost note (per-embedding billing), `.env.example`.
- **Acceptance criteria:** New messages get embedded asynchronously without
  blocking generation; a vector DB outage does not affect chat/generation,
  only semantic search availability.
- **Estimated LOC:** 500
- **Estimated effort:** 5 days
- **Dependencies:** M15
- **Risk level:** High — new paid third-party dependency, new failure mode
  (embedding drift/staleness), and the least mature part of the
  architecture design relative to the rest of the stack.

### M18 — Semantic search API & UI integration

- **Goal:** Blend semantic results into the search experience from M16.
- **Files:** additions to `search.service.ts` (`semanticSearchMessages`),
  additions to `SearchBar.tsx` for a "smart search" toggle/mode.
- **Database/API changes:** `GET .../search` gains a `mode=semantic` param.
- **Frontend changes:** Toggle between keyword and semantic search modes;
  relevance-ranked result list.
- **Tests:** API test asserting ranking order against a fixed embedding
  fixture; UI toggle test.
- **Documentation:** `docs/api.md` — semantic search mode.
- **Acceptance criteria:** Semantic mode returns relevant results for a
  paraphrased query that keyword search misses, verified against a fixed
  test fixture (not flaky live-model output).
- **Estimated LOC:** 350
- **Estimated effort:** 3 days
- **Dependencies:** M17, M16
- **Risk level:** High — test flakiness risk if not pinned to fixed
  embeddings/fixtures; ranking quality is inherently harder to assert than
  exact-match behavior.

---

## Phase 5 — Sharing & Real-Time Presence

### M19 — Sharing & invites (schema/service/API)

- **Goal:** Invite-token-based conversation sharing with tiered permissions.
- **Files:** schema `SharedConversation` (scaffolded in PR #38 — finish),
  `apps/backend/src/services/sharing.service.ts`,
  `apps/backend/src/routes/sharing.ts`,
  `apps/backend/src/routes/sharing-public.ts` (unauthenticated accept
  endpoint — already stubbed as a public route in PR #38's `app.ts`).
- **Database changes:** `SharedConversation` finalized (`inviteToken`
  unique, `permission` enum, expiry).
- **API changes:** `POST .../share`, `GET /api/conversations/shared/:token`,
  `POST /api/conversations/shared/:token/accept`, list/revoke endpoints
  (architecture §2).
- **Frontend changes:** None yet.
- **Tests:** Permission-enforcement matrix test (VIEW/EDIT/MANAGE ×
  read/write/manage actions); token-expiry test; revoke-then-access-denied
  test.
- **Documentation:** `docs/security.md` — sharing/permission model section
  (mirrors architecture §6).
- **Acceptance criteria:** A VIEW-permission invitee cannot add messages; a
  revoked share immediately loses access (checked at request time, not
  cached); expired tokens are rejected.
- **Estimated LOC:** 700
- **Estimated effort:** 3 days
- **Dependencies:** M2
- **Risk level:** Medium — permission-boundary bugs here are
  security-sensitive (unintended cross-user access).

### M20 — Frontend: share modal & invite acceptance

- **Goal:** User-facing sharing flow.
- **Files:** `apps/web/src/components/chat/ShareModal.tsx`,
  `apps/web/src/app/conversations/shared/[token]/page.tsx`.
- **Database/API changes:** None (consumes M19).
- **Frontend changes:** Share modal (permission picker, expiry picker,
  copy-link), public accept-invite page with login/signup prompt for
  unauthenticated visitors (mirrors the existing Release 2
  `invite/[token]` pattern).
- **Tests:** Component tests for modal and accept flow.
- **Documentation:** None.
- **Acceptance criteria:** An unauthenticated visitor hitting a share link
  is prompted to log in/register and lands back on the shared conversation
  after auth, verified live in browser.
- **Estimated LOC:** 500
- **Estimated effort:** 3 days
- **Dependencies:** M19
- **Risk level:** Low

### M21 — Real-time presence (WebSocket server)

- **Goal:** Show who else is viewing a conversation, and typing indicators.
- **Files:** `apps/backend/src/realtime/server.ts`,
  `apps/backend/src/realtime/presence.ts`,
  `apps/web/src/hooks/usePresence.ts`,
  `apps/web/src/components/chat/PresenceIndicator.tsx`.
- **Database changes:** None (presence is ephemeral, Redis-backed, not
  persisted).
- **API changes:** New WebSocket upgrade path (not REST); auth via the
  existing JWT, validated on the handshake.
- **Frontend changes:** Presence avatars in the chat header; "Assistant is
  typing…" indicator (can reuse the same channel for both).
- **Tests:** WebSocket connect/auth-reject test; presence broadcast test
  (join/leave events reach other connected clients); heartbeat/disconnect
  cleanup test.
- **Documentation:** `docs/architecture.md` — real-time transport section;
  `docs/deployment.md` — sticky-session/load-balancer note for WebSocket in
  a multi-instance deployment.
- **Acceptance criteria:** Two browser sessions viewing the same
  conversation see each other's presence within 2s and see it clear within
  the heartbeat window after a tab close.
- **Estimated LOC:** 600
- **Estimated effort:** 4 days
- **Dependencies:** M19
- **Risk level:** Medium — first stateful, connection-oriented server
  component in the stack; interacts with deployment topology (load
  balancing) in a way REST/SSE endpoints don't.

---

## Phase 6 — Files & Tools

### M22 — File uploads (schema/S3 infra/API)

- **Goal:** Attach files to conversations, reusing the existing Release 2
  storage abstraction (`apps/backend/src/storage/*`) rather than building a
  parallel one.
- **Files:** schema `ConversationFile`, `MessageAttachment` (scaffolded in
  PR #38), `apps/backend/src/services/conversationFile.service.ts`,
  `apps/backend/src/routes/conversationFiles.ts`.
- **Database changes:** `ConversationFile`, `MessageAttachment` finalized;
  indexes `(conversationId)`, `(uploadedBy)`.
- **API changes:** Upload (presigned-URL pattern per architecture §7),
  list, delete, download-redirect endpoints (architecture §2).
- **Frontend changes:** None yet.
- **Tests:** Upload-then-download round-trip test against the existing
  `local.provider.ts` storage descriptor (no new provider needed —
  architecture explicitly says S3-compatible is additive, matching the
  descriptor pattern already in place); size-limit and mime-type
  rejection tests.
- **Documentation:** `docs/api.md` — files section; note in
  `docs/architecture.md` that this reuses the Release 2 storage descriptor
  pattern, not a new one.
- **Acceptance criteria:** A 100MB+ upload is rejected with a clear error
  before hitting storage; a deleted file is archived (soft-delete) not
  immediately purged, per architecture's 30-day retention note.
- **Estimated LOC:** 600
- **Estimated effort:** 4 days
- **Dependencies:** M3
- **Risk level:** Medium — file handling (size limits, mime validation,
  storage-key collisions) is a common source of security bugs (path
  traversal, unrestricted upload type).

### M23 — Frontend: file upload UI & attachment rendering

- **Goal:** Let users attach and view files in the chat interface.
- **Files:** `apps/web/src/components/chat/FileUploadButton.tsx`,
  attachment rendering in `MessageList.tsx` from M7.
- **Database/API changes:** None (consumes M22).
- **Frontend changes:** Drag-and-drop + button upload, inline image
  preview, generic file-link rendering for non-image attachments, upload
  progress indicator.
- **Tests:** Component tests for upload states (pending/success/error) and
  rendering by mime type.
- **Documentation:** None.
- **Acceptance criteria:** Uploading an image shows an inline preview in
  the message; uploading a non-image file shows a download link; verified
  live in browser.
- **Estimated LOC:** 450
- **Estimated effort:** 3 days
- **Dependencies:** M22
- **Risk level:** Low

### M24 — Tool definitions & execution (schema/service/API)

- **Goal:** Workspace-defined custom tools the AI can invoke, with a full
  audit trail.
- **Files:** schema `Tool`, `ToolCall` (scaffolded in PR #38 — finish),
  `apps/backend/src/services/tool.service.ts`,
  `apps/backend/src/routes/tools.ts`.
- **Database changes:** `ToolDefinition`/`ToolExecution` finalized (or
  `Tool`/`ToolCall` per PR #38's naming — reconcile naming with the
  architecture doc during implementation and document the final names).
- **API changes:** Register tool, list tools, execute-tool endpoints
  (architecture §2); execution is queued via M4, not synchronous.
- **Frontend changes:** None yet.
- **Tests:** Schema-validation test for tool `inputSchema` (reject invalid
  JSON Schema at registration, not at execution time); execution audit-
  trail test (every call — success or failure — produces a `ToolCall` row);
  sandboxing test (a tool cannot access another workspace's credentials).
- **Documentation:** `docs/security.md` — tool execution sandboxing and
  credential-isolation section (this is the highest-privilege surface in
  Release 3 — a misconfigured tool could act as an SSRF vector).
- **Acceptance criteria:** Every tool execution — regardless of outcome —
  is recorded with input, output/error, and executor; a tool's
  `providerConfig` (credentials) is never returned in any API response,
  including to workspace admins.
- **Estimated LOC:** 750
- **Estimated effort:** 5 days
- **Dependencies:** M4, M22
- **Risk level:** High — arbitrary tool execution is the largest security
  surface added in Release 3 (credential handling, SSRF via
  webhook-provider tools, and injection of tool output back into the model
  context all need explicit mitigation, not just an audit log).

### M25 — Frontend: tool management & result rendering

- **Goal:** Let workspace admins register tools and let users see tool
  calls/results inline in chat.
- **Files:** `apps/web/src/app/(dashboard)/settings/tools/page.tsx`,
  tool-call rendering in `MessageList.tsx`.
- **Database/API changes:** None (consumes M24).
- **Frontend changes:** Tool registration form (JSON Schema editor or
  structured form), tool-call card in the message stream (input → output,
  collapsible, error state distinct from success).
- **Tests:** Component tests for registration form validation and
  tool-call rendering states.
- **Documentation:** None.
- **Acceptance criteria:** A failed tool call is visually distinct from a
  successful one and shows the error message, not a silent gap in the
  conversation.
- **Estimated LOC:** 550
- **Estimated effort:** 3 days
- **Dependencies:** M24
- **Risk level:** Medium — rendering arbitrary tool output safely (no
  unescaped HTML injection from tool results) needs the same care as any
  other untrusted-content rendering path.

---

## Phase 7 — History, Export & Analytics

### M26 — Export & version history (schema/service)

- **Goal:** Conversation export (Markdown/JSON/PDF) and message-edit
  version snapshots.
- **Files:** schema `ConversationVersion` (scaffolded in PR #38 — finish),
  `apps/backend/src/services/export.service.ts`,
  `apps/backend/src/queue/workers/exportConversation.worker.ts`.
- **Database changes:** `ConversationVersion` finalized (diff-friendly
  snapshot format).
- **API changes:** `POST .../export` (async, queued, emails/links result
  per architecture §4 worker spec); `GET .../versions`.
- **Frontend changes:** None yet.
- **Tests:** Export-format tests (Markdown/JSON round-trip fidelity);
  version-snapshot-on-edit test.
- **Documentation:** `docs/api.md` — export/versions section.
- **Acceptance criteria:** Exporting a conversation with branches produces
  a coherent, readable Markdown file (branches rendered as clearly labeled
  sections, not interleaved); export of a large (1000+ message) conversation
  completes without timing out the request (async via queue).
- **Estimated LOC:** 600
- **Estimated effort:** 4 days
- **Dependencies:** M8 (branches must exist to design branch-aware export)
- **Risk level:** Medium — branch-aware export formatting is genuinely
  fiddly to get right and easy to under-test.

### M27 — Frontend: version history & export UI

- **Goal:** User-facing history/diff view and export trigger.
- **Files:** `apps/web/src/components/chat/VersionHistory.tsx`,
  export button in the conversation menu.
- **Database/API changes:** None (consumes M26).
- **Frontend changes:** Version list with diff view between two versions,
  export format picker + progress/download-ready notification.
- **Tests:** Component tests for diff rendering and export trigger states.
- **Documentation:** None.
- **Acceptance criteria:** Diff view highlights only the changed spans
  between two versions, not a full-text replace; export completion
  triggers a visible notification/download link.
- **Estimated LOC:** 500
- **Estimated effort:** 3 days
- **Dependencies:** M26
- **Risk level:** Low

### M28 — Analytics dashboard (ledger, breakdowns, charts)

- **Goal:** Workspace-level usage/cost analytics beyond the basic summary
  from M14.
- **Files:** `apps/backend/src/routes/usageAnalytics.ts` (extends
  `usage.service.ts` from M13 with aggregation queries),
  `apps/web/src/app/(dashboard)/settings/usage/analytics/page.tsx`.
- **Database changes:** None (aggregation over existing tables); consider
  a materialized/cached rollup if query cost is high (Redis cache per
  architecture §7, TTL 1h).
- **API changes:** `GET .../usage/summary`, `GET .../usage/ledger`
  (architecture §2), both paginated.
- **Frontend changes:** Overview/Ledger/By-Model/By-Provider tabs, line
  chart (usage over time), pie chart (cost by provider), CSV export.
- **Tests:** Aggregation-correctness tests against seeded ledger data;
  pagination test on the ledger endpoint.
- **Documentation:** `docs/api.md` — analytics endpoints.
- **Acceptance criteria:** Dashboard totals reconcile exactly with the sum
  of underlying ledger entries for a seeded fixture (no rounding drift);
  ledger table paginates correctly past 100 entries.
- **Estimated LOC:** 750
- **Estimated effort:** 4 days
- **Dependencies:** M13, M14
- **Risk level:** Low — read-only aggregation over already-tested data;
  main risk is query performance at scale, not correctness.

---

## Phase 8 — Collaboration & Launch

### M29 — Real-time collaborative message editing

- **Goal:** Multiple users editing/observing the same conversation with
  live-synced changes, building on the presence channel from M21.
- **Files:** `apps/backend/src/realtime/collaboration.ts`,
  `apps/web/src/hooks/useCollaborativeEdit.ts`.
- **Database changes:** None beyond what M8/M26 already provide (edits
  still produce a version snapshot).
- **API changes:** WebSocket events (`edit_message`, `message_edited`) per
  architecture §5; no new REST endpoints.
- **Frontend changes:** Live-updating message content when another
  collaborator edits, conflict indicator if two edits race.
- **Tests:** Concurrent-edit test (two simulated clients editing the same
  message — assert last-write-wins is explicit and surfaced to both users,
  not silently dropped); WebSocket disconnect-mid-edit test.
- **Documentation:** `docs/architecture.md` — conflict-resolution strategy
  (explicitly document whether this release ships last-write-wins vs. a
  future CRDT/OT upgrade — the architecture doc leaves this open, so this
  milestone's implementation must make and document that choice).
- **Acceptance criteria:** Two users editing the same message never lose an
  edit silently — the losing edit either merges or shows a clear conflict
  state, verified with a scripted two-client test, not just manual QA.
- **Estimated LOC:** 700
- **Estimated effort:** 6 days
- **Dependencies:** M21
- **Risk level:** High — concurrent-editing correctness is the single
  hardest correctness problem in the entire release; explicitly called out
  as a risk in the source architecture document (WebSocket memory leak,
  presence lag) and is the natural place for that risk to materialize.

### M30 — Performance, E2E suite & launch hardening

- **Goal:** Close out the release: load-test the streaming/queue path,
  add the first Playwright E2E suite for Release 3's critical flows, and
  run the same production-readiness gate used for Release 1/2.
- **Files:** `apps/backend/tests/load/streaming.load.test.ts`,
  `test/e2e/chat.spec.ts`, `test/e2e/sharing.spec.ts`,
  `test/e2e/branching.spec.ts`, CI workflow updates
  (`.github/workflows/ci.yml` — add an E2E job).
- **Database changes:** Index review/tuning based on load-test findings
  (e.g., additional composite indexes if the query planner shows
  sequential scans under load).
- **API changes:** None expected; this milestone fixes issues found, it
  doesn't add surface.
- **Frontend changes:** Accessibility pass (ARIA labels/semantic HTML per
  `CLAUDE.md` code standards) across all Release 3 pages; error-state and
  loading-skeleton audit.
- **Tests:** Load test (target: 1K concurrent SSE connections, p99 token
  latency < 500ms per the architecture's success criteria); first
  Playwright E2E suite covering create-conversation → send message → see
  streamed response, branch creation, and share/accept flows.
- **Documentation:** `RELEASE_3_FINAL.md` (mirrors the existing
  `RELEASE_1_FINAL.md`/Release 2 pattern), updates to `docs/architecture.md`,
  `docs/api.md`, `docs/deployment.md` consolidating everything added across
  M1–M29, and a production rollout/rollback checklist.
- **Acceptance criteria:** All items in the architecture document's
  "Before M10 launch" success-criteria checklist are met: full verification
  pipeline green, no high/critical security findings, load test passing,
  SLA targets met, documentation complete, E2E suite passing in CI.
- **Estimated LOC:** 900 (mostly tests)
- **Estimated effort:** 6 days
- **Dependencies:** All milestones above
- **Risk level:** Medium — not risky to write, but this is the milestone
  most likely to *surface* risk accumulated earlier (load-test failures,
  flaky E2E tests, missed a11y issues), so effort here is inherently
  variable.

---

## Cross-Cutting Notes

- **Feature flags:** M15 (search), M17/M18 (semantic search), M21/M29
  (real-time) should each be gated behind an env-var flag
  (`ENABLE_SEMANTIC_SEARCH`, etc., per the architecture's DevOps section)
  so a milestone can ship to production disabled and be turned on
  independently of the deploy that introduced it — this is what lets later,
  riskier milestones (M17, M18, M29) land without blocking on their own
  perfection.
- **Security review checkpoints:** M19 (sharing/permissions) and M24
  (tool execution) are the two milestones that most warrant a dedicated
  security review pass before merging, given their access-control and
  credential-handling surface.
- **Naming reconciliation:** Where PR #38 has already scaffolded a model
  under a different name than this plan's source architecture doc (e.g.
  `Tool`/`ToolCall` vs. `ToolDefinition`/`ToolExecution`), the owning
  milestone (M24) is responsible for reconciling the name once, in
  documentation and code, rather than carrying both names forward.
- **CI stability:** Each new infrastructure dependency (M4 Redis, M15
  Elasticsearch, M17 Vector DB, M21 WebSocket) adds a service container to
  `.github/workflows/ci.yml`. Each such milestone should be merged and
  verified green in isolation before the next infra milestone starts, so a
  CI regression is always attributable to a single new dependency.
