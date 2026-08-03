# M1 Final Audit — Release 3, Milestone 1

**Purpose:** A repository-wide, dimension-by-dimension audit of every file
M1 (chat data model foundation) touches, performed after
`M1_VERIFICATION_REPORT.md` confirmed all 8 CI gates green. Where this
audit found something short of production-grade, it was fixed as part of
this same pass — not deferred — and the fix is re-verified below. This
document is the closing record for M1: after it, the Conversation/Message
data model is intended to be immutable for the remainder of Release 3.

**Files in scope** (everything M1 is responsible for):
- `packages/database/prisma/schema.prisma` — `Conversation`, `Message`
  models, `ConversationStatus`, `MessageRole` enums.
- `packages/database/prisma/migrations/20260728_add_release_3_chat_foundation/migration.sql` — the SQL for those models.
- `apps/backend/src/db/__tests__/conversationSchema.test.ts` — schema
  integration tests.
- `docs/database.md` — Conversation/Message/enum documentation.

---

## Finding: `Message` had no soft-delete support — fixed

**Dimension:** database design / future extensibility / rollback safety.

The architecture design for Release 3 explicitly specifies message
deletion as a soft delete ("`DELETE .../messages/:messageId` — Soft
delete message"), but the `Message` model, as it stood after
`fb1c1b6`, had no field capable of representing "deleted" short of an
actual `DELETE` statement. M3 (message lifecycle) would have had to add
this column itself — a second migration for a model M1 was supposed to
have finished. This is exactly the class of gap this audit exists to
catch before it becomes a later milestone's problem.

**Fix:** added `deletedAt DateTime?` to `Message`, following the same
nullable-timestamp convention already established elsewhere in this
schema (`RefreshToken.revokedAt`, `WorkspaceInvitation.revokedAt`) rather
than introducing a new `isDeleted`-boolean pattern that would sit
inconsistently alongside it. Added a supporting index,
`(conversationId, deletedAt)`, for the "list non-deleted messages in this
conversation" query every future message-listing endpoint will run.
Updated the migration SQL, `docs/database.md`, and added two tests
confirming (a) it defaults to `null` and (b) setting it via `UPDATE`
never triggers the `parentId` self-relation's `ON DELETE CASCADE` — that
only fires on a real `DELETE`, so a future soft-delete implementation in
M3 is guaranteed not to accidentally cascade-remove a message's children.

This is the only finding in this audit that required a code change.
Every other dimension below was checked and confirmed already correct.

---

## Dimension-by-dimension review

### Architecture consistency
`Conversation` and `Message` follow the exact same shape as every
Release 1/2 workspace-scoped resource: a `workspaceId` (or
`conversationId`, one level down) foreign key with `onDelete: Cascade` to
its owning parent, a `@@index` on that FK as the first index declared,
service-layer access gated through `WorkspaceMember` lookups (verified
separately in the prior Release 3 Foundation Audit, which moved these
services onto the shared `requirePermission` module). No divergent
pattern was introduced.

### Database design
Sound. `Conversation.status` (enum) plus `isArchived`/`isPinned`
(booleans) mirrors the existing `Project`/`ConversationStatus`-style
pattern elsewhere in the schema — status enum for the deleted/archived
lifecycle, booleans for independent toggle-style UI state. `Message`'s
tree via self-referential `parentId` is the correct minimal structure for
both linear history (root → reply → reply) and future branching (M8: a
second child under the same parent) without any schema change when
branching lands — confirmed by inspecting `MessageBranch`, which already
attaches to a `Message` via `messageId`, not by altering `Message` itself.

### Foreign keys
- `Conversation.workspaceId → Workspace`, `Cascade`: correct — a
  conversation cannot outlive its workspace.
- `Conversation.folderId → ConversationFolder`, `SetNull`: correct — a
  folder being deleted should not delete the conversations in it (an
  organizational container, not an ownership boundary).
- `Message.conversationId → Conversation`, `Cascade`: correct — a message
  cannot outlive its conversation.
- `Message.parentId → Message` (self, `"MessageTree"`), `Cascade`:
  correct as the schema-level default for a genuine hard delete (removes
  an orphaned subtree rather than leaving dangling rows); irrelevant to
  the soft-delete path added above, which never issues a real `DELETE`.

No foreign key was found missing, misdirected, or using the wrong
`onDelete` action for what it models.

### Indexes
`Conversation`: `workspaceId`, `(workspaceId, createdAt)`, `isArchived`,
`isPinned` — covers the list/filter queries the architecture's
Conversation List API describes. `Message`: `conversationId`,
`(conversationId, createdAt)`, `(conversationId, deletedAt)` (added this
pass), `parentId` — covers timeline listing, soft-delete filtering, and
thread reconstruction. No redundant index was found (each serves a
distinct, real query shape); no missing index was found for any query
pattern in scope for M1.

### Constraints
Both models rely on `id` (CUID) as the sole uniqueness constraint plus
FK integrity — correctly so, since neither model has a natural key
(conversation titles and message content are not unique by nature, and
nothing in the architecture asks them to be).

### Naming
Consistent with the rest of the schema throughout:
camelCase fields, PascalCase enums (`ConversationStatus`, `MessageRole`
alongside existing `WorkspaceRole`, `NotificationType`), `*Id` suffix for
foreign keys, `deletedAt`/`createdAt`/`updatedAt` timestamp naming
matching every other model. No inconsistency found.

### Folder structure
`db/__tests__/conversationSchema.test.ts` sits beside the pre-existing
`db/__tests__/client.test.ts` — both are schema/client-level tests with
no service layer involved, correctly grouped together rather than under
`services/__tests__/` (which is reserved for service-layer tests) or
`routes/__tests__/` (route-layer). `docs/database.md` is the single,
already-established location for schema documentation — no new doc file
was needed or created.

### Provider abstraction
`Conversation.provider`/`.model` are untyped strings, not an enum tied to
a fixed provider list — verified with a dedicated test
(`stores provider/model as free-form strings...`) that creates a
conversation naming a provider id that doesn't exist in
`ai/registry.ts` and confirms the schema accepts it without complaint.
Adding, removing, or renaming an AI provider is exclusively a change to
`ai/providers/*` and `ai/registry.ts` (per the prior Release 3 Foundation
Audit) — never a schema migration.

### Future extensibility
`Conversation`'s relation list (`tags`, `collaborators`, `versions`,
`activity`, `shared`, `usage`, `toolCalls`, `folder`) already anticipates
every later milestone's model (M8 branching via `MessageBranch` attaching
to `Message`, M10 knowledge via `Prompt`/`Template`'s own tables, M12
folders, M13 usage, M19 sharing, M24 tools) without `Conversation` or
`Message` themselves needing to change shape when those milestones land —
each attaches via its own FK pointing at an existing, stable
`Conversation`/`Message` id. The `deletedAt` fix above closes the one gap
found where a later milestone (M3) would otherwise have forced a schema
change.

### Test quality
10 tests in `conversationSchema.test.ts`: defaults, provider-agnostic
typing (2 tests), message threading via `parentId`, all three
`MessageRole` values, three cascade-behavior tests (conversation→messages,
parent-message→children, workspace→conversations), workspace isolation,
and the two `deletedAt` tests added this pass. Every test operates
directly on `prisma.conversation`/`prisma.message` with no service layer
— correctly scoped to what M1 owns, not reaching ahead into M2/M3
business logic. No test asserts anything not yet true; no test is
disabled, skipped, or marked `.todo`.

### Documentation quality
`docs/database.md` now documents `Conversation`, `Message`,
`ConversationStatus`, and `MessageRole` in the same format as every
existing model/enum entry (prisma excerpt with inline field comments,
indexes called out separately, a short prose note for any non-obvious
behavior — deletion model, soft-delete semantics). Nothing overstates
what exists yet (the Conversation section explicitly says "no API or
frontend consumes these models yet").

### Migration correctness
`prisma generate` succeeds against the current schema (re-verified after
the `deletedAt` addition). The migration SQL was hand-edited to match the
schema exactly — `CREATE TABLE "Message"` now includes `"deletedAt"
TIMESTAMP(3)` (nullable, no default, matching a Prisma `DateTime?`), and
the new index statement matches Prisma's generated naming convention
(`Message_conversationId_deletedAt_idx`). `db:migrate` (`prisma migrate
deploy`) applying this migration against a real, fresh Postgres instance
is exercised by every CI run's "Run database migrations" step — the
authoritative check, not a local approximation, since this sandbox has no
Docker/Postgres available.

### Rollback safety
This repository's documented rollback policy (`docs/deployment.md`) is
explicit: there is no automated rollback, and undoing a migration means
hand-writing a new forward migration, not a generated `down.sql` — no
migration anywhere in this project has one, so M1 does not introduce an
inconsistent pattern by also not having one. Assessed against that
policy: this migration is a pure-addition migration (two new tables, two
new enums, no `ALTER`/`DROP` of any pre-existing column, table, or
constraint) and, as of this audit, has zero consumers outside this same
unmerged branch. If it ever needed to be undone, the reverse migration is
trivially safe to write (`DROP TABLE "Message"; DROP TABLE
"Conversation"; DROP TYPE ...`) precisely because nothing pre-existing
depends on these tables. This is close to the lowest-risk migration shape
achievable under the project's stated rollback model.

---

## Verification (re-run after the `deletedAt` fix)

- `pnpm exec tsc --noEmit` (backend): clean.
- `pnpm run lint` (all packages): 0 errors, 44 warnings — identical count
  to before this audit's fix, confirming no new lint debt was introduced;
  all 44 are pre-existing `no-explicit-any` in test-mock code untouched by
  M1.
- `pnpm run type-check` (all packages, including `@synora/database`):
  clean.
- `pnpm run build` (all packages): clean.
- `prisma generate`: succeeds, `Message.deletedAt` present on the
  generated client type.
- Full live-Postgres verification (`db:migrate` + `test:coverage` +
  `docker` + `security`) is pushed as a follow-up commit and awaited via
  CI per the standing instruction — this sandbox cannot run Postgres or
  Docker locally, so GitHub Actions is the authoritative check, not a
  substitute for one.

## Conclusion

One real gap was found (`Message` soft-delete support) and fixed at the
schema level, with matching migration, documentation, and test coverage.
Every other audited dimension — architecture consistency, FKs, indexes,
constraints, naming, folder structure, provider abstraction, future
extensibility, test quality, documentation quality, migration
correctness, rollback safety — was checked against concrete evidence (the
actual schema, the actual migration SQL, the actual repo-wide
conventions) and confirmed sound, not merely asserted. Milestone 1 is
considered closed pending this audit's commit passing all 8 CI gates.
