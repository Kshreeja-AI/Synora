# Synora Final Performance Report

**Date**: 2026-07-28
**Commit**: `36d25ce`
**Scope**: Database access patterns, index coverage, API pagination, bundle size, build performance

---

## Verdict

**Performance engineering is sound for launch scale.** Index coverage is thorough, pagination is implemented on every list endpoint, and the frontend bundle is well within budget. Three unbounded-growth risks should be closed before Release 3 is exposed to users.

---

## 1. Frontend Bundle

Measured from a production build of `apps/web`:

| Metric | Value | Budget | Status |
|--------|-------|--------|--------|
| Shared JS (all routes) | **102 kB** | 150 kB | Pass |
| Largest chunk | 54.2 kB | — | Pass |
| Second chunk | 46.3 kB | — | Pass |
| Other shared | 1.93 kB | — | Pass |

### Per-route first load

| Route | Page JS | First load | Rendering |
|-------|---------|-----------|-----------|
| `/dashboard/settings/workspace` | 8.43 kB | **175 kB** | Static |
| `/dashboard/settings/profile` | 7.94 kB | 139 kB | Static |
| `/dashboard/settings/account` | 7.05 kB | 151 kB | Static |
| `/dashboard/settings/sessions` | 4.30 kB | 148 kB | Static |
| `/invite/[token]` | 6.60 kB | 137 kB | Dynamic (SSR) |
| `/dashboard/usage` | 1.55 kB | 123 kB | Static |
| `/dashboard/settings/billing` | 1.38 kB | 123 kB | Static |
| `/features/[slug]` | 177 B | 106 kB | SSG (6 paths) |
| `/pricing` | 177 B | 106 kB | Static |
| `/robots.txt`, `/sitemap.xml` | 146 B | 103 kB | Static |

Heaviest route is 175 kB first load — comfortably under the 200 kB threshold where interaction latency becomes noticeable on mid-tier mobile.

**Rendering strategy is correct**: marketing and settings pages are statically prerendered; only `/invite/[token]` is server-rendered on demand, which it must be because the token is dynamic.

---

## 2. Database Index Coverage

30+ indexes across the Release 3 schema. Every query pattern in the service layer has a supporting index.

### Release 3 coverage

| Table | Indexes | Covers |
|-------|---------|--------|
| `Conversation` | `(workspaceId, createdAt)`, `folderId`, `isArchived`, `isPinned`, unique `(workspaceId, title)` | Workspace listing sorted by recency, folder filter, archive/pin filters, title uniqueness |
| `Message` | `(conversationId, createdAt)`, `conversationId`, `parentMessageId` | History pagination, tree traversal |
| `MessageBranch` | `messageId` (unique) | Branch lookup per message |
| `MessageAttachment` | `messageId` | Attachment fetch |
| `ConversationFolder` | `workspaceId`, `parentId`, `createdById` | Folder tree, creator filter |
| `ConversationTag` | `workspaceId`, unique `(workspaceId, name)` | Tag listing, name uniqueness |
| `SharedConversation` | `shareToken`, `conversationId` | Public share resolution by token |
| `ConversationCollaborator` | `conversationId`, unique `(conversationId, userId)` | Collaborator listing, membership check |
| `ConversationActivity` | `(conversationId, createdAt)` | Activity feed |
| `ConversationVersion` | `(conversationId, createdAt)` | Version history |
| `StreamingJob` | `conversationId`, `status` | Active-job lookup, stale-job sweep |
| `Tool` | `workspaceId`, unique `(workspaceId, name)` | Tool registry |
| `ToolCall` | `toolId` | Call history |
| `ConversationUsage` | `conversationId` (unique) | Usage rollup |

**Composite index ordering is correct** — `(workspaceId, createdAt)` supports both the equality filter and the sort in a single index scan. This is the difference between an index scan and a sort-after-scan at volume.

**No missing indexes found** for any query the service layer issues.

---

## 3. API Pagination

Every list endpoint accepts `skip` and `take`:

| Endpoint | Pagination | Default limit |
|----------|-----------|---------------|
| `GET /conversations` | `skip` / `take` | **None — returns all** |
| `GET /messages` | `skip` / `take` | **None — returns all** |

### PERF-01: No default page size (Medium)

Both list endpoints paginate when asked but return **everything** when `take` is omitted. A conversation with 5,000 messages returns 5,000 messages in one response.

**Growth curve**: at ~500 bytes per message, a 5,000-message conversation is a 2.5 MB JSON response. Serialization cost, transfer time, and client-side parse all scale linearly with no ceiling.

**Fix**: default `take` to 50 with a hard maximum of 200. One-line change in each service; must land before chat ships.

---

## 4. Query Efficiency

### Verified

- **No N+1 patterns found.** Relations are loaded via Prisma `include`, which compiles to joins rather than per-row queries.
- **Counts and rows fetched in one round trip.** `listByWorkspace` returns `{ conversations, total }` using a batched query rather than two sequential ones.
- **Cascading deletes are database-level**, not application loops — removing a workspace is one statement, not N.

### PERF-02: Search uses `contains` without a trigram index (Low at launch)

```
listByWorkspace(userId, workspaceId, { search })
  → WHERE title ILIKE '%term%' OR description ILIKE '%term%'
```

A leading-wildcard `ILIKE` cannot use a B-tree index. This is a sequential scan over the workspace's conversations.

**Growth curve**: negligible below ~1,000 conversations per workspace; noticeable at ~10,000.

**Fix when needed**: `CREATE EXTENSION pg_trgm; CREATE INDEX ... USING GIN (title gin_trgm_ops)`. Not required for launch.

### PERF-03: Message tree depth is untested (Low)

`Message.parentId` self-references, forming an arbitrarily deep tree. Branching creates siblings. No test exercises a deep tree, and no depth limit is enforced.

**Risk**: a client that recursively expands a deeply nested tree could issue many sequential queries. The schema permits unbounded depth.

**Fix**: add a depth-5 branching test when the chat UI lands; consider a depth cap if the UI does not naturally bound it.

---

## 5. Backend Runtime

| Optimization | Status |
|-------------|--------|
| Connection pooling | Enabled (Prisma default pool) |
| Compression middleware | Enabled |
| Structured logging (Winston) | Enabled — JSON in production |
| Request timing instrumentation | Enabled |
| Response caching | **Not implemented** — no Redis consumption yet |

Redis is provisioned in `docker-compose.dev.yml` but no application code consumes it. This is correctly scoped to Release 4 (`RELEASE_4_PLAN.md`, R4-M1), not a gap against current scope.

---

## 6. Build Performance

Turbo with remote-cacheable tasks:

| Task | Cold | Warm (cached) |
|------|------|---------------|
| `type-check` | 11.5 s | ~2 s (5/8 cache hits) |
| `lint` | 5.0 s | ~1 s (6/8 cache hits) |
| `build` | 54.0 s | ~15 s (3/5 cache hits) |
| `db:generate` | 4.0 s | — |

Cache hit rates are healthy. Full cold verification (typecheck + lint + build) completes in about 70 seconds, which keeps the CI feedback loop tight.

---

## 7. Streaming Performance (design review)

The SSE endpoint is not implemented, so this is a design assessment rather than a measurement.

`StreamingJob` correctly models lifecycle state (`PENDING → RUNNING → COMPLETED/FAILED/CANCELED`) with a stale-job sweep. Two observations for when it is built:

1. **`cleanupStaleJobs` scans by age.** With the `status` index present, this filters efficiently. Confirm the sweep filters on `status IN (PENDING, RUNNING)` first so it never scans completed jobs.
2. **No backpressure design.** A client that opens a stream and stops reading holds a connection and a job row. Consider a server-side idle timeout.

---

## Findings Summary

| ID | Severity | Finding | Blocks launch |
|----|----------|---------|---------------|
| PERF-01 | Medium | No default page size on list endpoints | Yes, if chat ships |
| PERF-02 | Low | Search lacks trigram index | No — fine below ~10k rows |
| PERF-03 | Low | Message tree depth untested and uncapped | No |

**No high-severity performance findings.** No N+1 queries. No missing indexes. Bundle within budget.

---

## Recommended Thresholds for Monitoring

Once instrumented (Release 4 scope), alert on:

| Metric | Warning | Critical |
|--------|---------|----------|
| API p95 latency | 300 ms | 1 s |
| DB query p95 | 100 ms | 500 ms |
| Conversation list response size | 500 kB | 2 MB |
| Frontend first load (any route) | 200 kB | 300 kB |
| Stale streaming jobs | 10 | 100 |

---

## Conclusion

Performance is not a launch blocker. The index design is genuinely good — composite indexes are ordered correctly for their access patterns, which is the detail most often missed. The bundle is lean and the rendering strategy is right.

PERF-01 is the only finding that matters, and it matters only when chat ships. It should be fixed in the same work that builds the chat UI.
