# Release 3 Foundation Audit

**Scope:** Verify that Synora's existing abstractions (AI provider layer,
storage, permissions, server bootstrap, database schema) can support the
19 Release 3 capability areas without requiring a rewrite once feature
work begins. This is **not** a Release 3 implementation pass — no
conversation/streaming/search/collaboration *feature* was added. Only the
existing foundation was inspected, and refactored where a concrete,
present-day gap would otherwise force rework later.

**Method:** Direct code reading of the backend's provider-abstraction
layers (`ai/`, `storage/`, `mail/`), the permission/audit system
(`services/permissions.ts`, `services/audit.service.ts`), the server
bootstrap (`app.ts`, `server.ts`), and the Prisma schema — including the
Release 3 chat schema and services already scaffolded on this branch by
PR #38 (conversations, messages, branches, folders, templates, sharing).
Every finding below is backed by a specific file and line, not a general
impression.

---

## Summary by Concern Area

| Area | Foundation readiness | Action taken |
|---|---|---|
| Conversation system | Schema + CRUD services already exist (PR #38) | Permission-check consistency fixed (see below) |
| Streaming | Job-lifecycle bookkeeping exists; no actual token pipe | None — correctly deferred to implementation (see "Deferred") |
| Providers | Solid provider-agnostic pattern, but request shape was single-turn only | **Fixed**: conversation history support added |
| Models | Per-provider config fields, consistent pattern | None needed |
| Memory | Schema exists (`AIMemory`) but scoped 1-per-workspace | Flagged, not changed (see "Deferred") — scoping is a product decision |
| Embeddings | Capability reserved in the type enum; descriptor type was hard-coded against it | **Fixed**: descriptor made generic |
| Tool calling | No request-shape support yet | None — correctly deferred (see "Deferred") |
| File uploads | Provider abstraction requires full in-memory buffer, no presigned-URL path | Flagged, not changed (see "Deferred") |
| Search | Does not exist yet | None — Release 3 feature work, not foundation |
| Prompt library | Schema + service + routes already exist (PR #38) | Permission-check consistency fixed |
| Templates | Schema + service + routes already exist (PR #38) | Permission-check consistency fixed |
| Sharing | Schema + service + routes already exist (PR #38) | Permission-check consistency fixed |
| Collaboration | `ConversationCollaborator` model exists; no real-time transport | **Fixed**: server now retains its `http.Server` handle |
| Version history | Schema exists (`ConversationVersion`), no service wired yet | None — Release 3 feature work |
| Branching | Schema + service + routes already exist (PR #38) | Permission-check consistency fixed |
| Workspace chat | Workspace-scoping pattern is solid and consistently applied | None needed |
| Knowledge | Overlaps Prompt/Template above | Same fixes apply |
| Agent execution | `Tool`/`ToolCall` schema exists but had no audit trail (no actor, no conversation link) | **Fixed**: schema extended |

Four concrete refactors were made. Everything else in the table above is
either already sound, or is real Release 3 feature work that correctly
has nothing to build against yet (search, real embeddings/vector store,
actual token streaming, file storage backends, WebSocket server).

---

## Weaknesses Found and Fixed

### 1. The AI provider abstraction could not represent a conversation

**File:** `apps/backend/src/ai/types.ts`, `shared.ts`, and the four
provider implementations that don't delegate to a shared adapter
(`anthropic.provider.ts`, `bedrock.provider.ts`, `gemini.provider.ts`,
`openaiCompatible.provider.ts` — the other six providers, `openai`,
`together`, `deepseek`, `openrouter`, `xai`, `azure`, all reuse
`OpenAICompatibleTextProvider`, so fixing it there covers them).

**The problem:** `TextGenerationRequest` had exactly one content field —
`prompt: string` — which every provider wrapped in a single
`{ role: 'user', content: request.prompt }` turn before calling its SDK.
There was no way to pass prior turns. Release 3's very first backend
milestone (generating an assistant reply from a stored message history)
would have hit this immediately, and the only ways around it inside the
old interface were: (a) flatten history into one string and hope the
model parses it correctly — a real quality and prompt-injection risk, or
(b) change the interface's core shape under deadline pressure, once six-plus
provider files and the routes depending on `generateText()` already
existed and needed to keep working. Either path is the "future rewrite"
this task was meant to prevent.

**The fix:** `TextGenerationRequest` gained an optional
`messages?: readonly ConversationMessage[]` field representing prior
turns, oldest first, *not including* `prompt` (which remains the newest
user turn, unchanged in meaning). A new shared helper,
`resolveConversationTurns()`, returns the full turn sequence a provider
should send — `[...history, { role: 'user', content: request.prompt }]`
— with `system`-role entries filtered out (every provider's own
`resolveSystemPrompt()` already owns the one system instruction its wire
format allows; a `system` entry embedded in history would either be
rejected by the SDK or duplicate it).

Each of the four providers now builds its message array from
`resolveConversationTurns()` instead of a hardcoded single-turn array,
with the minimal per-SDK role mapping each already needed (Gemini maps
`assistant` → `model`; Anthropic, Bedrock, and the OpenAI-compatible
adapter use `user`/`assistant` natively).

**Backward compatibility:** When `messages` is omitted — every Release
1/2 caller today, including `/api/ai/generate` — `resolveConversationTurns()`
returns exactly `[{ role: 'user', content: request.prompt }]`, byte-identical
to what every provider constructed before this change. No existing test
asserted the literal shape of the constructed array (checked directly);
all provider tests still pass unchanged.

### 2. The AI provider descriptor type was hard-coded to text generation

**File:** `apps/backend/src/ai/types/descriptor.ts`

**The problem:** `AIProviderDescriptor.create()` returned
`Promise<TextGenerationProvider>` unconditionally. `AICapability` already
reserves `'embeddings'` and `'agent'` as future values (per the type's own
comment), but a future embeddings provider descriptor would not have been
able to satisfy this interface — its `create()` would need to return an
embedding-provider object, which is not a `TextGenerationProvider` and
has no `generateText()` method. The only ways to add it under the old
type were an unsafe cast or contorting the embedding provider into
fake-implementing `generateText()`. Both are exactly the kind of
workaround that becomes a rewrite the moment someone tries to do it
properly.

**The fix:** `AIProviderDescriptor` is now generic —
`AIProviderDescriptor<TProvider = TextGenerationProvider>` — defaulting
to exactly what every entry in today's `PROVIDER_REGISTRY` already is, so
nothing about the current registry, resolver, or any of the ten provider
files changes. When embeddings work begins, it declares its own
`AIProviderDescriptor<EmbeddingProvider>` and its own registry — the same
"one descriptor + one registry per capability family" pattern already
used for `storage` and `mail` — instead of forcing a second capability
into the text-generation registry.

### 3. Six chat services bypassed the centralized permission module

**Files:** `services/conversation.service.ts`, `message.service.ts`,
`branch.service.ts`, `conversationFolder.service.ts`,
`conversationTemplate.service.ts`, `promptTemplate.service.ts`,
`sharing.service.ts` (19 call sites total).

**The problem:** Every Release 1/2 service that enforces a
workspace-role permission does so through `services/permissions.ts`'s
`requirePermission(role, permission)` — a single, tested, auditable
source of truth (`asset.service.ts`, `folder.service.ts`,
`workspace.service.ts`, `project.service.ts`, `audit.service.ts`,
`invitation.service.ts` all do this). Every one of PR #38's chat
services instead reimplemented the same rule inline:
`if (!member || member.role === 'VIEWER') { throw new ForbiddenException(...) }`,
independently, 19 times, with 19 slightly different message strings. This
is exactly the "inconsistent... architecture violation" pattern the prior
Release 2 stabilization pass eliminated elsewhere in the codebase — it
resurfaced here because this code was scaffolded somewhat in isolation.
Left alone, every future Release 3 milestone (search permissions, tool
execution permissions, collaboration roles) would keep copying the same
ad-hoc pattern instead of extending one place, and the eventual cleanup
would touch far more call sites than it does today.

**The fix:** `Permission` gained nine chat-resource values
(`conversation:create`, `conversation:manage`, `message:send`,
`message:manage`, `branch:manage`, `conversation-folder:manage`,
`prompt:manage`, `template:manage`, `sharing:manage`), granted to every
role except `VIEWER` — this preserves the exact behavior the inline
checks enforced (nothing changes for any existing caller; a VIEWER is
still blocked, everyone else still passes). All 19 call sites now call
`requirePermission(member.role, '<permission>')` instead of the inline
check. Test coverage for the new permissions was added to
`permissions.test.ts` (VIEWER denied, MEMBER granted, matching the
existing test style).

This is intentionally the *same* access rule as before — the fix is
structural (one auditable place, one set of tests, room to later grant a
finer split like "MEMBER can chat but not manage sharing" without
touching six files), not a behavior change.

### 4. `ToolCall` had no audit trail — no actor, no conversation link

**Files:** `packages/database/prisma/schema.prisma`,
`packages/database/prisma/migrations/20260728_add_release_3_chat_foundation/migration.sql`

**The problem:** The `ToolCall` model (agent tool-execution history)
recorded `toolId`, `input`, `output`, `error`, and `createdAt` — but
nothing about *who* executed the call or *which conversation* it happened
in. Tool execution is the highest-privilege surface Release 3 adds (an
agent invoking arbitrary registered tools, potentially with external
credentials in `Tool.definition`); an audit trail that can't answer "who
ran this and in what context" is a security gap that would need a
schema migration and a backfill the moment it was noticed in review —
exactly the kind of foundation correction cheaper to make now, before any
tool-execution business logic exists to migrate.

**The fix:** Added `conversationId` (required, hard foreign key with
cascade delete, matching the existing `ConversationActivity` pattern —
every tool call happens within a conversation's agent loop) and
`executedBy` (required, soft reference with no FK — matching
`AuditLog.actorId`'s existing, deliberate convention, so the audit trail
survives the executing account being deleted later). Both the
`schema.prisma` model and its migration were updated together (the
migration was edited in place rather than appended as a second migration,
since `ToolCall` was introduced on this same unmerged branch and has no
deployed data anywhere to preserve).

### 5. `server.ts` discarded the handle real-time features need

**File:** `apps/backend/src/server.ts`

**The problem:** `app.listen(...)` was called without capturing its
return value. Express's `.listen()` creates and returns the underlying
Node `http.Server` — the exact object a future WebSocket layer needs
(`new WebSocketServer({ server })`, or a manual `upgrade` handler) for
presence and collaborative-editing (concern areas "Collaboration" and
part of "Sharing"). Without this, adding real-time support later would
require restructuring `bootstrap()`/`startServer()` again just to get
access to something that already existed and was simply being thrown
away.

**The fix:** `startServer()` now returns the `Server` instance instead of
`void`, and `bootstrap()` retains it. As a direct, low-risk consequence of
holding the handle, graceful shutdown now also closes the HTTP server
(stops accepting new connections) before disconnecting Prisma, rather
than disconnecting the database out from under in-flight requests — a
correctness improvement that came for free once the handle was captured.

---

## Deliberately Not Changed (Documented, Not Fixed)

These are real observations, not oversights — each is left alone because
fixing it now would mean guessing at a product/design decision that
hasn't been made yet, and guessing wrong would itself cause a rewrite.

- **`AIMemory` is scoped one-per-workspace** (`workspaceId @unique` in
  `schema.prisma`), a single unstructured `Json` blob shared by everyone
  in the workspace. If "memory" is meant to be per-user or
  per-conversation (the more common pattern for AI memory features), this
  will need re-scoping. Not changed because whether workspace-shared
  memory is intentional (a "team knowledge" model) or an oversight is a
  product decision, not an architectural defect — flagging it here so
  it's decided deliberately when memory work actually begins, not
  discovered mid-implementation.

- **`StorageProvider.upload()` requires the full file buffer in
  process memory** (`storage/types.ts`) — there is no presigned-URL
  method. The Release 3 architecture explicitly calls for direct
  client-to-storage uploads (up to 100MB files, bypassing the backend
  entirely) precisely to avoid this. The current Express body-parser
  limit (`10mb`, in `app.ts`) is already smaller than that target. Not
  changed because the right shape for a presigned-URL method depends on
  which object-storage provider is added first (S3 vs. GCS vs. Azure
  Blob have different presigning mechanics) — a decision that belongs to
  that milestone, not this audit.

- **Streaming and tool-calling are not yet in the AI request/response
  shape.** Unlike the conversation-history gap (a correctness fix to a
  capability that already ships), streaming and tool calling are new
  capabilities Release 1 never claimed to have. Half-adding a `stream`
  flag or a `tools` parameter with no caller to integration-test against
  risks getting the shape wrong and needing a second pass anyway — worse
  than deferring it cleanly to the milestone that actually builds the SSE
  pipeline and the tool-execution loop, where the shape can be validated
  against a real caller immediately.

- **Search, vector/embeddings infrastructure, a real queue (Redis is
  provisioned but unused), and a WebSocket server do not exist.** This is
  expected — none of these are part of today's "foundation," they are
  Release 3 feature milestones in their own right (see
  `RELEASE3_IMPLEMENTATION_PLAN.md`, M4/M15/M17/M21/M24). Building them
  now would be adding Release 3 features, which this task explicitly
  excluded.

- **Test coverage for the permission-denied path in the six refactored
  chat services** (conversation/message/branch/folder/template/sharing)
  does not exist — this was true before this audit too; the ad-hoc
  inline checks these replaced were themselves untested for the VIEWER
  case at the service-test level. The refactor is behavior-preserving
  (confirmed: no existing test asserts the old inline check's exact
  error-message text), so this is a pre-existing gap surfaced, not one
  introduced.

---

## Verification

- `pnpm exec tsc --noEmit` (backend): clean, no errors.
- `pnpm exec eslint` on every file touched: 0 errors, only pre-existing
  `no-explicit-any` warnings in test-mock code.
- `pnpm --filter @synora/backend build` (tsup): succeeds.
- `pnpm exec vitest run src/ai src/services/__tests__/permissions.test.ts`:
  76/76 tests pass, including all pre-existing AI provider tests
  unchanged and new chat-permission coverage.
- `prisma generate`: schema change applies cleanly, client regenerates
  with the new `ToolCall.conversationId`/`executedBy` fields.
- Full integration test suite (Postgres-backed) was not runnable in this
  environment (no Docker daemon available in this sandbox); CI will
  exercise it on push. The behavior-preservation argument above (no test
  references the old inline messages or asserts the old request shape)
  is based on direct source inspection, not a skipped assumption.

## Conclusion

Release 3 feature work — building conversations, streaming, search,
sharing, files, tools, and collaboration per
`RELEASE3_IMPLEMENTATION_PLAN.md` — can now proceed against these
abstractions without hitting a wall that forces revisiting them
mid-implementation. The four fixes above close the gaps that were
concrete and fixable without a product decision; the five deferred items
are flagged with enough detail that whoever picks up that milestone
knows exactly what decision is waiting for them.
