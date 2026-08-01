# M2 Implementation Plan — Universal Conversation Engine

**Status:** Design only. No implementation code is written as part of
this document. This is the complete engineering plan M2's actual
implementation must follow; deviating from it during implementation
should be a deliberate, documented decision, not drift.

**Relationship to `RELEASE3_IMPLEMENTATION_PLAN.md`:** that document's
finer-grained M2 ("Conversation service & API"), M3 ("Message service &
API"), part of M8 (state/lifecycle), M13 ("Usage & cost accounting"), and
part of M16 ("search API") are consolidated here into one coherent
milestone at the founder's direction. Where this plan's scope differs
from that document, this plan is authoritative for M2; the other
document's later milestones (branching, folders, prompts/templates,
full-text/semantic search, sharing, files, tools) are unaffected and
still apply as written.

**What M2 explicitly does NOT include** (per instruction — backend only):
no UI, no React, no SSE/WebSocket transport, no Redis-backed job queue,
no full-text/semantic search infrastructure, no tool invocation, no
memory integration. Each of those has a "future compatibility" note below
explaining exactly how M2's design keeps the door open for it without
requiring a rewrite — none of them are stubbed, half-built, or TODO'd
inside M2 itself.

---

## 1. Database Impact

M1 established `Conversation` and `Message`'s core shape and left it
correct for M2 to build on. M2 adds three narrowly-scoped things, each
justified below rather than speculative:

### 1.1 `Conversation.lastMessageAt`

```prisma
lastMessageAt DateTime?
```
+ index `@@index([workspaceId, lastMessageAt])`.

**Why:** "Conversation ordering" (a named M2 requirement) most commonly
means "most recently active first" — the standard chat-list order. Without
a denormalized field, that sort requires a correlated subquery or a
`GROUP BY` join against `Message` on every list call. Written once, by the
message-creation path, whenever a message is created; read many times, on
every conversation list call. Classic case for denormalization, and it's
additive — no existing row or query changes shape.

### 1.2 `StreamingJob` gains three fields

```prisma
messageId  String?
attempt    Int     @default(0)
lastError  String?
```

**Why:** `StreamingJob` (from M1's PR #38 scaffolding) already models
"a generation is in flight for this conversation" with a status enum
(`PENDING/RUNNING/COMPLETED/FAILED/CANCELED`), but has no way to say
*which* resulting message it produced, how many attempts have been made,
or why the last attempt failed — all three are required for "retry
support" and "error recovery" to be real, inspectable behavior rather
than an opaque pass/fail. `messageId` is nullable because it is only set
once generation succeeds and the assistant `Message` row is created (see
§9); it is never a foreign key to a message that doesn't exist yet.

### 1.3 No other schema change

Everything else M2 needs already exists and was audited in M1:
`ConversationUsage` (token accounting target), `ConversationTag`
(tagging), `AuditLog` (workspace-wide audit trail, already used by
Release 2's project/folder/asset/member lifecycle — M2 reuses it rather
than inventing a parallel mechanism), and `Message.deletedAt` (message
soft-delete, added in M1's final audit specifically so M2 wouldn't need
this exact migration).

**Explicitly not added:** a `Message.status` enum
(`PENDING/STREAMING/COMPLETE/ERROR`), even though early architecture
notes mention one. Rejected in favor of the design in §9: an assistant
`Message` row is only ever created once its content is final. A
generation "in flight" is represented entirely by `StreamingJob`, which
already exists for exactly that purpose. This avoids two different
models trying to represent the same "is this thing done yet" state.

---

## 2. Service & Repository Boundaries

**Repository pattern:** this codebase has no repository abstraction layer
anywhere — every existing service (`conversation.service.ts`,
`asset.service.ts`, `workspace.service.ts`, all of Release 2's billing
services) calls `prisma.<model>` directly. Introducing a repository layer
for M2 only would be a new, inconsistent pattern next to forty existing
services that don't use one. **Decision: no repository layer.** Prisma's
generated model delegates are the repository boundary — thin,
type-safe, and already exactly what every other service in this codebase
treats as its data-access layer. `M2_ARCHITECTURE_REVIEW.md` should
specifically re-examine whether this decision holds, not accept it
silently.

**Services** (new unless marked *existing*):

| Service | Responsibility |
|---|---|
| `conversation.service.ts` *(existing, extended)* | CRUD, archive/restore, pin/unpin, tag attach, list with search/sort/filter. Owns nothing about generation. |
| `message.service.ts` *(existing, extended)* | CRUD for already-final messages (user messages, and assistant messages once generation completes). Owns nothing about calling the AI provider. |
| `conversationGeneration.service.ts` *(new)* | The one place that: builds prompt context from message history, resolves the provider via `conversation.provider`, calls `generateText`, retries on failure, creates the `StreamingJob` row and drives its state machine, creates the final assistant `Message` on success, and triggers token accounting. |
| `conversationUsage.service.ts` *(new)* | Token/cost accounting only: given a completed generation's token counts and provider/model, upserts `ConversationUsage`. Deliberately not named `usage.service.ts` to avoid any future collision with Release 2's workspace-level billing usage records (`UsageRecord`, `CreditLedgerEntry`), which this does not touch or replace. |
| `permissions.ts` *(existing)* | Already has every chat permission M2 needs (`conversation:create`, `conversation:manage`, `message:send`, `message:manage`) from the prior Release 3 Foundation Audit. No change needed. |
| `audit.service.ts` *(existing)* | `recordAuditEvent` reused as-is for conversation lifecycle events. No change needed. |

`conversationGeneration.service.ts` is deliberately its own file rather
than folded into `message.service.ts` — message CRUD and "orchestrate a
retrying call to an external AI provider with its own state machine" are
different responsibilities with different failure modes and different
test doubles (message CRUD tests hit only Prisma; generation tests mock
the AI provider). Splitting them now is what keeps `message.service.ts`
simple enough to still have zero technical debt after M2, and is exactly
the kind of "service responsibility" boundary a senior review should be
able to point at and agree with.

---

## 3. API Routes

All under the existing `/api/workspaces/:workspaceId/conversations` and
nested paths already mounted in `app.ts`. Routes marked *(existing)*
already exist from PR #38's scaffolding and are extended; unmarked routes
are new.

```
POST   /conversations                              create
GET    /conversations                               list (search, sort, filter, paginate)
GET    /conversations/:id                            get metadata
PATCH  /conversations/:id                            update (title, description, tags)
POST   /conversations/:id/archive
POST   /conversations/:id/restore
POST   /conversations/:id/pin
POST   /conversations/:id/unpin
DELETE /conversations/:id                            soft delete
GET    /conversations/:id/usage                       token/cost accounting readout

GET    /conversations/:id/messages                    list (paginated)
POST   /conversations/:id/messages                    create user message → synchronously drives generation
GET    /conversations/:id/messages/:messageId
DELETE /conversations/:id/messages/:messageId          soft delete (sets deletedAt)
```

**`GET /conversations` is the search API.** Rather than a separate
`/conversations/search` endpoint, search is a query parameter
(`?q=...`) on the existing list endpoint — `conversation.service.ts`
already implements this exact `OR`-across-title/description pattern from
M1's audit of the existing scaffolding. A dedicated endpoint would be a
second code path doing the same thing.

**Sort/order** via `?sortBy=lastMessageAt|createdAt|updatedAt|title` and
`?sortDirection=asc|desc`, defaulting to `lastMessageAt desc` (most
recently active first — the standard chat-list default). This is what
"Conversation ordering" means in this plan: a documented, validated sort
contract on the list endpoint, not a new schema field for manual
drag-to-reorder (nothing in the requirements asks for user-controlled
manual ordering, and inventing that now would be scope creep).

**`POST /conversations/:id/messages` is synchronous.** It creates the
user message, then calls `conversationGeneration.service.ts` inline,
which retries internally (§7) before the HTTP response is sent, and
returns `{ userMessage, assistantMessage, usage }` on success or a
structured error (with the `StreamingJob` id, so a client can inspect
what was attempted) if every retry is exhausted. No polling endpoint, no
job-status endpoint, is added in M2 — see §12 for why, and what changes
when async/SSE transport is built later.

All routes validate input with Zod (matching `routes/ai.ts`'s existing
pattern) and enforce workspace membership + the relevant `Permission`
before touching data — no route trusts a client-supplied workspace or
user relationship.

---

## 4. Provider Abstraction

**Gap found and closed by this plan (not yet implemented — this is what
implementation must do):** `ai/index.ts`'s `generateText()` resolves a
provider via `resolveTextGenerationProvider()`, which only ever consults
the global `AI_PROVIDER` config/env var or auto-detection — there is no
way today to say "use *this specific* provider for *this* call,"
independent of the process-wide setting. But `Conversation.provider` is a
required field, already audited as meaningful, free-form, and
provider-agnostic. Honoring it requires `resolveProvider` to accept an
optional explicit-provider override that takes priority over both the env
var and auto-detection:

```typescript
// ai/resolver.ts — additive, optional parameter, fully backward compatible
export async function resolveProvider(
  capability: AICapability,
  options?: { explicitProviderId?: string }
): Promise<TextGenerationProvider>
```

`conversationGeneration.service.ts` is the only caller that ever passes
`options.explicitProviderId` (set to `conversation.provider`); every
existing caller (`/api/ai/generate`, and anything else using
`resolveTextGenerationProvider()`) is unaffected — that function keeps
calling `resolveProvider(capability)` with no second argument, identical
to today.

**Validation at creation:** `conversation.service.ts.create()` gains a
check — `conversation.provider` must name a descriptor that exists in
`PROVIDER_REGISTRY` (`getProviderDescriptor`) *and* is currently
configured (`descriptor.isConfigured()`), or creation is rejected with a
clear validation error. Rejected alternative: validating `model` against
a fixed per-provider list — there is no such list anywhere in this
codebase (models are free-form config strings by design), and inventing
one would contradict the provider-agnostic philosophy this exact audit
has enforced elsewhere.

---

## 5. Conversation State Machine

```
        create
          │
          ▼
      ┌───────┐   archive    ┌──────────┐
      │ACTIVE │ ───────────► │ ARCHIVED │
      │       │ ◄─────────── │          │
      └───┬───┘   restore    └────┬─────┘
          │                       │
          │        delete         │
          └──────────┬────────────┘
                      ▼
                  ┌────────┐
                  │DELETED │  (terminal — no API restores from here)
                  └────────┘
```

Backed by the existing `ConversationStatus` enum + `isArchived` boolean
(both from M1). Every transition is enforced in `conversation.service.ts`
as an explicit, named method (`archive`, `restore`, `delete`) — never a
generic `PATCH { status }` that lets a caller jump straight to `DELETED`
or resurrect a deleted conversation. `delete` is reachable from both
`ACTIVE` and `ARCHIVED`; nothing reaches `DELETED` from a `DELETED` state
(idempotent no-op, not an error, matching the rest of this codebase's
delete-is-idempotent convention seen in `StorageProvider.delete`).

## 6. Message Lifecycle

```
User submits content
        │
        ▼
Message(role=USER) created — final, immediately (§9 rationale)
        │
        ▼
conversationGeneration.service.ts invoked synchronously
        │
        ▼
   ┌─────────────────────────────┐
   │ StreamingJob(PENDING)        │
   │  → RUNNING → attempt++       │
   │  → call provider.generateText│
   └───────────┬─────────────────┘
               │
      success  │  failure
      ┌────────┴────────┐
      ▼                 ▼
Message(role=ASSISTANT) attempt < max?
created, final     ┌────┴────┐
      │             yes       no
      ▼             │         │
StreamingJob         ▼         ▼
 = COMPLETED   retry (§7)  StreamingJob
      │                     = FAILED,
      ▼                     lastError set
ConversationUsage            │
 upserted (§8)                ▼
      │                  Message.deletedAt
      ▼                  is irrelevant — no
Conversation             assistant Message
.lastMessageAt            row was ever created
 updated
```

A `Message` row, once created, is immutable content-wise except for
`deletedAt` (soft delete). There is no "editing" a message's content in
M2 — that is Release 3's message-edit/regenerate flow (a later
milestone, per `RELEASE3_IMPLEMENTATION_PLAN.md` M9), and is explicitly
out of scope here.

## 7. Retry Strategy

- **Trigger:** any `AIProviderError` thrown by `generateText()`.
- **Policy:** bounded retry, 2 retries (3 total attempts), exponential
  backoff (500ms, then 1500ms) between attempts, tracked via
  `StreamingJob.attempt`.
- **Scope decision:** M2 does not build a transient-vs-permanent error
  taxonomy (e.g., distinguishing a rate-limit from an invalid-API-key
  error) — `AIProviderError` carries no such classification today, and
  inventing one now, for a codebase with ten providers each surfacing
  errors differently, is real scope creep for this milestone. A blanket
  bounded retry is the correct, defensible default; refining it into
  per-error-class policy is noted under §12 as a future improvement, not
  a gap silently left unhandled.
- **Where it lives:** entirely inside `conversationGeneration.service.ts`,
  synchronous with the HTTP request (§12 explains why there is no
  worker/queue in M2). A failed final attempt does not throw an unhandled
  error up to the route — it resolves to a structured failure result the
  route turns into a clear 502-class API error naming the `StreamingJob`
  id.

## 8. Token Accounting

`TextGenerationResult.usage` (already exists in `ai/types.ts` since
Release 1) carries `inputTokens`/`outputTokens` from whichever provider
served the call. On a successful generation,
`conversationUsage.service.ts`:

1. Looks up a per-model cost table (`ai/pricing.ts`, new — a small,
   hardcoded `Record<string, { inputPer1k: number; outputPer1k: number }>`
   keyed by model name, covering the models each provider defaults to
   today; an unrecognized model falls back to `estimatedCost` staying at
   its current value rather than throwing — a missing price should never
   block a real conversation from working).
2. Upserts `ConversationUsage` (create-if-absent, else increment)
   atomically via a single `prisma.conversationUsage.upsert` — no
   read-then-write race between concurrent generations in the same
   conversation.

This is aggregate-only (one row per conversation), matching what M2's
requirement list actually asks for ("Token accounting"), not a full
usage ledger/analytics dashboard (`RELEASE3_IMPLEMENTATION_PLAN.md`'s
M28) — that reads per-event history this milestone doesn't create.

## 9. Why Assistant Messages Are Only Created On Success

Considered and rejected: creating a `PENDING` assistant `Message`
placeholder immediately, updating it in place once generation finishes
(the original architecture note's implied design, via a `Message.status`
enum). Rejected because:
- It requires a schema field (`Message.status`) whose only reason to
  exist is representing "generation in flight" — a concept
  `StreamingJob` already owns. Two models representing one state is a
  future consistency bug waiting to happen (which one is authoritative
  if they ever disagree?).
- Without a streaming transport in M2 (§12), no client ever observes the
  "PENDING" state anyway — the HTTP response only returns once
  generation is finished (success or exhausted-retry). A placeholder row
  nobody can see mid-flight is pure overhead.
- On exhausted retries, "no assistant message exists" is a cleaner,
  more obviously-correct data shape than "an assistant message exists,
  content is empty, status is ERROR" — the former can't be
  accidentally rendered as a real (empty) reply by a careless future
  caller.

## 10. Audit Logs

Every state-changing conversation action calls the existing
`recordAuditEvent(workspaceId, actorId, action, 'CONVERSATION', conversationId, metadata)`
(from `audit.service.ts`, already used by Release 2's
project/folder/asset/member lifecycle) for: `conversation_created`,
`conversation_archived`, `conversation_restored`,
`conversation_deleted`, `conversation_pinned`, `conversation_unpinned`.
Message send/delete are **not** audited via `AuditLog` — that table is
for permission-sensitive, relatively low-volume workspace administration
events; logging every chat message there would make a workspace's audit
trail unusable (thousands of "message sent" rows drowning out the events
an admin actually needs). `ConversationActivity` (a separate,
already-existing, higher-volume, conversation-scoped model) is reserved
for that purpose in a later, collaboration-focused milestone — M2
explicitly does not write to it, to avoid two audit mechanisms
half-populated by two different milestones.

## 11. Security

- **Workspace isolation:** every route re-verifies `WorkspaceMember`
  existence and the relevant `Permission` — no route trusts a
  conversation's `workspaceId` implicitly matches the URL's
  `:workspaceId` without checking (`conversation.workspaceId !==
  params.workspaceId` is treated as "not found," matching this
  codebase's established 404-not-403 convention for cross-tenant access
  attempts).
- **Validation:** all route bodies validated with Zod before reaching any
  service; `provider`/`model` validated as described in §4; `tagNames`
  validated as a bounded-length array of bounded-length strings (prevents
  a pathological request from creating thousands of tag rows in one
  call).
- **No secret leakage:** provider API keys never appear in any
  Conversation/Message/StreamingJob response — they were never stored on
  these models to begin with (confirmed in M1's audit); nothing in M2
  changes that.

## 12. Future Compatibility

- **Streaming transport (SSE/WebSocket):** today's synchronous
  request/response becomes: `POST .../messages` returns immediately after
  creating the user message and enqueuing generation; a separate `GET
  .../stream` endpoint (not built in M2) emits `StreamingJob` status
  transitions and tokens as they arrive. `StreamingJob`'s
  `messageId`/`attempt`/`lastError` fields added in this plan are exactly
  what that future endpoint needs to report progress — no further schema
  change required when it's built.
- **Async worker/queue (Redis):** `conversationGeneration.service.ts`'s
  retry loop runs inline today. Moving it to a queued worker later is a
  change to *who calls* `conversationGeneration.service.ts` (a worker
  process instead of the route handler) — the service's internal retry
  state machine and its `StreamingJob` bookkeeping do not change.
- **Tool invocation:** not built in M2. `conversationGeneration.service.ts`
  is structured as a single call to `generateText()` specifically so that
  a later milestone can insert a tool-call loop around that one call site
  without restructuring the retry/state-machine/token-accounting logic
  around it.
- **Memory integration:** not built in M2. `AIMemory`'s workspace-only
  scoping was flagged as an open product question in the prior Release 3
  Foundation Audit; M2 does not read or write it, so that question
  remains fully open for whichever milestone resolves it.
- **Message editing/regeneration/branching:** M2's "a message, once
  created, is immutable content-wise" rule (§6) is intentionally the
  simplest correct rule for a milestone with no branching yet. M8
  (branching) already has its own schema (`MessageBranch`) that attaches
  without touching `Message` itself.

## 13. Performance

- List/search endpoints use targeted `select`s (no full message-content
  joins on the conversation list, matching M1's audit note that
  `Conversation.messages` should not be eagerly loaded in list views).
- `Conversation.lastMessageAt` (§1.1) avoids a correlated subquery for the
  default, most-common sort.
- Pagination (`skip`/`take`, already present in `conversation.service.ts`
  and `message.service.ts` from M1's scaffolding) is mandatory on both
  list endpoints — no unbounded "return everything" path exists.
- The retry backoff (§7) is bounded (max ~2s of added latency across 2
  retries) specifically so a failing provider cannot make a single HTTP
  request hang indefinitely.

## 14. Caching

Explicitly none in M2. No Redis or other cache infrastructure exists in
this codebase yet (`docker-compose.dev.yml` provisions Redis for future
use only, per `CLAUDE.md`). Serving conversation lists/gets uncached is
correct-by-default; adding a cache-aside layer (short TTL, invalidated on
every write) is a natural addition once Redis lands as its own milestone
(`RELEASE3_IMPLEMENTATION_PLAN.md` M4) — not before, and not half-built
here.

## 15. Testing Plan

- **`conversation.service.ts`:** create (incl. provider validation
  reject/accept), list (search/sort/filter/paginate), get, update,
  archive/restore state-machine transitions (incl. rejecting
  archive-from-DELETED), pin/unpin, delete idempotency, tag attach.
- **`message.service.ts`:** create/list/get, soft delete (asserts
  `deletedAt` set, row still queryable directly, excluded from default
  list), workspace-isolation rejection.
- **`conversationGeneration.service.ts`:** success on first attempt;
  success after 1 retry (mock `generateText` to fail once, succeed
  second); exhausted retries (mock 3 consecutive failures → `StreamingJob`
  `FAILED` with `lastError` set, no assistant `Message` row created,
  `ConversationUsage` unchanged); explicit-provider override reaches
  `resolveProvider` with the conversation's `provider` field.
- **`conversationUsage.service.ts`:** first-usage insert vs. subsequent
  upsert-increment; unknown-model fallback doesn't throw.
- **Route/integration tests (Supertest):** every endpoint in §3, including
  a cross-workspace access attempt returning 404, and Zod-rejection cases
  for malformed bodies.
- **No test depends on wall-clock timing beyond what `vi.useFakeTimers()`
  can control** — the retry backoff must not make the test suite
  measurably slower.

## 16. Documentation Plan

- `docs/api.md`: every route in §3, request/response shapes, error shape
  on exhausted retry.
- `docs/database.md`: update the existing M1 Conversation/Message entries
  for `lastMessageAt`; add a `StreamingJob` entry (new — it existed in
  schema before this plan but was never documented, an M1 audit gap this
  plan corrects going into implementation) covering the three new fields
  and their relationship to retry.
- `docs/architecture.md`: a short new subsection describing the
  generation flow diagram in §6, and the "why synchronous, not
  queued/streamed, in M2" decision from §12 — so a future reader doesn't
  mistake the current design for an oversight.

## 17. Acceptance Criteria

- [ ] A conversation cannot be created with an unregistered or
      unconfigured `provider`.
- [ ] Sending a user message synchronously returns a real assistant reply
      generated through the existing provider abstraction, honoring the
      conversation's specific `provider`/`model`, not just whatever
      `AI_PROVIDER` happens to be globally set to.
- [ ] A transient provider failure is retried up to 2 times with backoff
      before being reported as failed; a successful retry is
      indistinguishable to the caller from first-attempt success except
      for `StreamingJob.attempt`.
- [ ] Exhausting all retries never creates a phantom assistant `Message`
      row, and leaves `StreamingJob` in `FAILED` with a populated
      `lastError`.
- [ ] `ConversationUsage` accurately reflects cumulative token counts and
      estimated cost after any number of successful generations,
      verified by a test asserting the exact numeric increment.
- [ ] Archive/restore/delete only permit the transitions in §5's diagram
      — no route can move a conversation directly to an illegal state.
- [ ] Listing conversations supports search (`q`), tag filter, and sort
      (`lastMessageAt` default), all paginated, all workspace-scoped.
- [ ] No route returns data for, or allows mutation of, a conversation
      belonging to a workspace the requesting user is not a member of —
      verified by an explicit cross-workspace test per route.
- [ ] Every lifecycle action produces exactly one `AuditLog` row with the
      correct `action`/`targetId`; message send/delete produce none.
- [ ] `pnpm run lint`, `type-check`, `test:coverage`, and `build` are all
      clean with zero new warnings beyond the pre-existing
      `no-explicit-any` test-mock baseline; all 8 CI gates
      (lint/typecheck/tests/coverage/build/docker/security/dependency
      audit) are green on the implementation commit before it is
      considered done.
