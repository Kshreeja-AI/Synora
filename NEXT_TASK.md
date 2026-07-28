# NEXT TASK — Release 2, Milestone 7: Media Generation, Asset Manager, Async Queue

**Maintenance rule:** this file always contains ONLY the exact next
development task. When a task completes (milestone gate passed: lint,
typecheck, tests, build all green → commit → push → green CI), replace
this file's content with the task named under "Next task after this one".

**Status:** M6 (Billing) is COMPLETE and MERGED. Release 2 production gates all
green. M7 is ready to begin.

---

## Goal

Extend the Synora platform with a real media generation capability (image, video,
audio) powered by the existing 10-provider AI abstraction. Implement an async job
queue via Redis for long-running generation tasks. Build a real asset manager with
multipart upload support, storage integration, and gallery UI. Unify media and
documents in a workspace-scoped content hierarchy with proper permissions.

## Scope

1. **Redis integration** — managed Redis client, connection pooling, Upstash/Redis Cloud configuration
2. **Async job queue** — Bull (Node.js queue library) for media generation tasks, retry logic, failure handling
3. **Real media generation** — extend `src/ai/*` with image/video/audio generation capabilities using existing provider abstraction
   - `POST /api/workspaces/:id/images/generate` (was placeholder, now real)
   - `POST /api/workspaces/:id/videos/generate` (new)
   - `POST /api/workspaces/:id/audio/generate` (new)
   - All async: client receives `jobId`, polls for status via `GET /api/workspaces/:id/media/:jobId`
4. **Gallery UI** — new design-system `MediaGrid` component, `apps/web/src/app/dashboard/gallery/page.tsx`
5. **Database schema** — extend GeneratedImage/Video/Audio with job tracking (jobId, status PENDING/PROCESSING/COMPLETE/FAILED, errorMessage)
6. **Storage integration** — generated media stored via existing storage abstraction, public URLs served via `/media/:mediaId`
7. **Usage tracking integration** — each generation call triggers `recordUsage()` (M6 credit system), deducts from workspace credits
8. **Tests** — job queue (enqueue, process, fail), provider media capabilities, media routes, storage integration, usage tracking
9. **Documentation** — architecture.md (async queue section), api.md (media endpoints), database.md (job tracking schema), security.md (storage URLs)

## Architecture Decisions

### Async Job Queue Pattern (New)

Use Bull (Node.js queue library) on Redis for long-running media generation tasks:
- **Queue name**: `media-generation` (namespaced with `NODE_ENV` as prefix: `dev_media-generation`, `prod_media-generation`)
- **Job data**: `{ workspaceId, userId, capability ('image'|'video'|'audio'), prompt, model?, metadata? }`
- **Job result**: `{ mediaId, mediaType, url, duration?, width?, height? }`
- **Retry**: exponential backoff (attempt 1: immediate, 2: 10s, 3: 1m, 4: 10m); fail after 5 attempts
- **Consumer**: separate worker process (can be the same Node instance or a dedicated queue consumer) that polls the queue, calls `generateMedia()`, persists result to DB, marks complete
- **Client polling**: frontend polls `GET /api/workspaces/:id/media/:jobId` every 1s initially, backoff to 5s if still pending (max 30s total wait before UI shows spinner state)
- **Error handling**: job failure updates `GeneratedMedia` row with `status='FAILED'` + `errorMessage`, no retry visible to user (retry is internal), 404 if user queries after job expires from Redis (24h TTL)

### Media Generation Capabilities (Extend Existing AI Abstraction)

The `src/ai/*` provider abstraction gains three new methods on `AIProvider` interface:
- `generateImage(prompt: string, options?: { width?, height?, model? }): Promise<{ url, width, height }>`
- `generateVideo(prompt: string, options?: { duration?, model? }): Promise<{ url, duration }>`
- `generateAudio(prompt: string, options?: { voice?, model? }): Promise<{ url, duration }>`

Each provider descriptor declares which media types it supports. Anthropic defaults to placeholder URLs (dev). OpenAI (via Vision + Whisper) supports images + audio. Ollama (with local models like Stable Diffusion) can support images. Others default to placeholder URLs.

### Workspace as Content Unit (Established Pattern)

All generated media belongs to a workspace, never a user directly. Media generation routes are workspace-scoped: `/api/workspaces/:id/images/generate`, etc. The `GeneratedImage`/`Video`/`Audio` schema already has `workspaceId` FK (added in M5 audit). Permissions checked via `requireMembership()` (VIEWER can view, MEMBER+ can generate, OWNER+ can delete others' media).

### Usage Tracking Integration (From M6)

Each media generation call must call `credit.service.ts#recordUsage()` with:
- `workspaceId`
- `capability` matching the AICapability enum (e.g., 'image-generation', 'video-generation', 'audio-generation')
- `quantity` (1 for now; future: token-based pricing)
- `userId` (the user who triggered the generation)
- Throws `InsufficientCreditsError` if workspace balance would go negative

This is the first real call site for M6's `recordUsage()` helper — M7 ships the plumbing.

## Database Schema

**Extend existing models:**

- `GeneratedImage`: add `jobId` (UUID), `status` (PENDING/PROCESSING/COMPLETE/FAILED), `errorMessage?`, `createdAt`, `updatedAt`
- `GeneratedVideo`: add `jobId` (UUID), `status` (PENDING/PROCESSING/COMPLETE/FAILED), `errorMessage?`, `createdAt`, `updatedAt`
- `GeneratedAudio`: add `jobId` (UUID), `status` (PENDING/PROCESSING/COMPLETE/FAILED), `errorMessage?`, `createdAt`, `updatedAt`

**Migration:** one migration file `packages/database/prisma/migrations/<ts>_add_media_job_tracking/migration.sql` — adds jobId + status + errorMessage columns to the three media models, creates an index on `(workspaceId, jobId)` for fast polling.

**No new models needed** — the M6 billing schema (`Plan`, `Subscription`, `Invoice`, `PaymentMethod`, `WorkspaceCredits`, `CreditLedgerEntry`, `UsageRecord`, `ProcessedWebhookEvent`) already exists and includes `UsageRecord` table for tracking calls to `recordUsage()`. M7's first call site to that plumbing is in media generation.

## Services (2 New Files)

### `apps/backend/src/services/mediaQueue.service.ts`

Manages the Bull queue for media generation:

- `initializeQueues()` — called at app startup; creates `media-generation` queue with workers
- `enqueueMediaGeneration(workspaceId, userId, capability, prompt, options?)` — enqueues a job, returns `jobId`
- `getJobStatus(jobId): Promise<{jobId, status, mediaId?, errorMessage?}>` — polls job status
- `processMediaJob(job)` — worker function (runs asynchronously) that:
  1. Inserts `GeneratedMedia` row with `status='PROCESSING'`
  2. Calls `generateMedia(capability, prompt, options)` (new unified facade in `src/ai/`)
  3. On success: updates row with `status='COMPLETE'`, stores result URL via `storage` abstraction
  4. On failure: updates row with `status='FAILED'`, logs error + updates `errorMessage`
  5. Calls `credit.service.recordUsage()` to deduct from workspace balance

### `apps/backend/src/services/media.service.ts`

High-level media operations (can be called from routes or other services):

- `generateImage(actorId, workspaceId, prompt, options?)` — enqueues via mediaQueue, returns `{jobId, mediaId}`
- `generateVideo(actorId, workspaceId, prompt, options?)` — same
- `generateAudio(actorId, workspaceId, prompt, options?)` — same
- `getMediaStatus(actorId, workspaceId, mediaId)` — returns `GeneratedMedia` row + job status
- `listWorkspaceMedia(actorId, workspaceId, {type?, limit, offset})` — list all generated media for workspace
- `deleteMedia(actorId, workspaceId, mediaId)` — MEMBER+ can delete; EDITOR can only delete own; calls `storage.deleteMedia()`

## Routes (1 New File)

### `apps/backend/src/routes/media.ts`

Mounted at `app.use('/api/workspaces', mediaRoutes)`, all `authMiddleware` + zod validation + try/catch:

| Method | Path | Permission | Service | Notes |
|---|---|---|---|---|
| POST | `/:id/images/generate` `{prompt, width?, height?, model?}` | MEMBER+ | `generateImage` | Async; returns jobId + mediaId |
| POST | `/:id/videos/generate` `{prompt, duration?, model?}` | MEMBER+ | `generateVideo` | Async; returns jobId + mediaId |
| POST | `/:id/audio/generate` `{prompt, voice?, model?}` | MEMBER+ | `generateAudio` | Async; returns jobId + mediaId |
| GET | `/:id/media/:mediaId` | VIEWER+ | `getMediaStatus` | Polls job status; 404 if expired |
| GET | `/:id/media` `?type={image\|video\|audio}&limit=&offset=` | VIEWER+ | `listWorkspaceMedia` | Paginated list |
| DELETE | `/:id/media/:mediaId` | MEMBER+ | `deleteMedia` | Only own media; OWNER can delete any |

## Frontend

### Design System Addition

**`packages/design-system/src/components/MediaGrid.tsx`** — responsive grid of media cards (image/video/audio thumbnails), with hover play-button overlay for videos, delete action for owners.

### API Clients (`apps/web/src/lib/api/`)

- `media.ts` — `generateImage`, `generateVideo`, `generateAudio`, `getMediaStatus`, `listWorkspaceMedia`, `deleteMedia`
- `types.ts` extended — `GeneratedMediaSummary` union type (image | video | audio), `JobStatus`

### Hooks (`apps/web/src/hooks/`)

- `useMediaGeneration.ts` — `useQuery` for media status polling, `useMutation` for generation + polling, backoff strategy
- `useWorkspaceMedia.ts` — `useQuery` for workspace media list with pagination

### Pages

**`apps/web/src/app/dashboard/gallery/page.tsx`** — full-page gallery:
1. Top section: generation forms (tabs for image/video/audio) with prompt input + options, submit button, in-progress spinner during generation
2. Gallery section: `MediaGrid` with paginated list of workspace media, delete buttons (owner only), click-to-view modal

**Gallery modal**: large preview (image full-size, video player with controls, audio player), metadata (prompt, created date, size, model used), copy-to-clipboard URL button, download button (via storage public URL), delete button.

## Tests

**Backend layers** (integration tests via Supertest + real Postgres + mocked Bull queue):

1. **`services/__tests__/media.service.test.ts`** — enqueue operations, status polling, permission boundaries (MEMBER+ can generate, delete own; EDITOR can delete others; VIEWER cannot generate)
2. **`services/__tests__/mediaQueue.service.test.ts`** — job enqueue/dequeue, worker processing (success + failure paths), retry backoff, credit deduction call
3. **`ai/generateMedia.test.ts`** (new facade method) — all provider media capabilities (anthropic placeholder, openai real, bedrock real, ollama real, others placeholder), graceful degradation when capability unsupported
4. **`routes/__tests__/media.test.ts`** — full app + real Postgres, MEMBER+/EDITOR/VIEWER boundaries, workspace membership 404, job status polling, media list pagination, successful generation → status COMPLETE, failed generation → status FAILED + errorMessage

**Frontend** (new pages + API client tests):
- `apps/web/src/lib/api/media.test.ts` — generation mutation + polling flow, list query with pagination
- `apps/web/src/hooks/useMediaGeneration.test.ts` — backoff polling behavior, completion detection
- `apps/web/src/app/dashboard/gallery/page.test.tsx` — gallery renders media grid, generation form tabs work, delete owner-only, modal previews

## Security Requirements

- Workspace-scoped reads/writes require membership (404 for non-members, never 403)
- Generated media URLs are served via storage abstraction (local FS or cloud); never raw Stripe/AI provider URLs
- No new secrets introduced; existing AI provider secrets used only for real generation
- Media generation calls must pass MEMBER+ permission check
- Async jobs store in Redis with 24h expiry (prevent stale job lookups)

## Documentation Updates

- `docs/architecture.md` — new `## Async Job Queue Pattern` section (Bull on Redis, retry strategy, error handling)
- `docs/api.md` — new `## Media Generation Endpoints` section (generation requests are async, polling pattern)
- `docs/database.md` — new `GeneratedImage/Video/Audio` job tracking columns (jobId, status, errorMessage)
- `.env.example` — add `REDIS_URL` (required in staging/prod, placeholder in dev)
- `CURRENT_STATE.md`, `NEXT_TASK.md` (at M7 close) — updated

## Testing Requirements (Verification Gates)

All must pass before commit:

- `pnpm run lint` — ESLint clean
- `pnpm run type-check` — TypeScript strict mode, no errors
- `pnpm run test` — all tests passing (650+), no skipped tests
- `pnpm run build` — production build succeeds
- `docker build -t synora:latest .` — Docker image builds
- `pnpm audit --prod --audit-level=high` — no high/critical vulns
- Migration validation — `pnpm run db:migrate` succeeds locally (fresh Postgres)
- Redis connection — verify Redis can be reached (Upstash test or local docker-compose)

## Acceptance Criteria

- ✅ User (MEMBER+) can request image/video/audio generation with a prompt
- ✅ Request returns `jobId` + `mediaId` immediately (async)
- ✅ Frontend polls `GET /api/workspaces/:id/media/:jobId` every 1s, detects completion
- ✅ On completion, media displays in gallery with thumbnail + metadata
- ✅ Generation call deducts credits from workspace (M6 integration)
- ✅ Failed generation (bad prompt, provider error, insufficient credits) sets `status=FAILED` + `errorMessage`
- ✅ Gallery page displays all workspace media, paginated
- ✅ Owner can delete any media; MEMBER can only delete own
- ✅ Storage abstraction handles saving generated media (local FS or cloud provider)
- ✅ All endpoints enforce workspace membership (404 for non-members)
- ✅ MediaGrid component renders thumbnails, hover actions, responsive layout
- ✅ Generation modal shows in-progress spinner, completion preview, error message on failure
- ✅ All tests pass (backend + frontend)
- ✅ All documentation updated and consistent

## Definition of Done

1. All files created/modified per Architecture section above
2. Redis client configured and tested locally (docker-compose or Upstash test)
3. Schema migration applied and tested locally (fresh Postgres)
4. All tests passing (lint, typecheck, test, build green)
5. Docker image builds successfully with Redis URL env var
6. Security scan passes (no new vulns)
7. Dependency audit passes (no high/critical)
8. All documentation updated
9. Commit with conventional message, push to designated branch
10. CI green (test, security, docker) on push
11. `CURRENT_STATE.md`, `NEXT_TASK.md`, `SYNORA_BRAIN.md` updated with M7 close notes

## Risks & Mitigation

- **Queue consumer reliability**: Bull workers can crash; use a persistent Redis Sentinel or managed Redis (Upstash) with built-in failover
- **Long job runtimes**: media generation can take 30s–2m; frontend must handle timeout gracefully (show user "still processing" after 30s)
- **Storage quota**: generated media can fill disk quickly; implement TTL (auto-delete after 30 days) or quota enforcement per workspace
- **Provider rate limits**: OpenAI/Anthropic/etc. have rate limits; queue backpressure and exponential backoff mitigate
- **Redis connection loss**: wrap queue initialization in try/catch; fall back to synchronous generation if queue unavailable (not ideal but graceful degradation)

## Things That Must Not Change

From `SYNORA_BRAIN.md` §14 (Non-Negotiable Principles):
- Auth invariants (hash-at-rest, rotation, pinned HS256)
- Provider-agnostic patterns (must extend, not rewrite)
- Workspace as org unit (not user-scoped media)
- Milestone gate (lint → typecheck → test → build → CI → commit)
- Design tokens (no hardcoded colors)
- Secrets discipline (SecretsManager only, never process.env at call sites)

## Estimated Effort

3–4 focused engineer-days (M) — Redis setup + Bull queue + media routes + frontend gallery + tests + docs

## Next Task After This One

**M8 — AI Playground & Generation History** (per `RELEASE_2_PLAN.md` scope): interactive playground with model/provider selector, real-time generation streaming (text), generation history with metadata, prompt library, variant generation from previous outputs. Details will be written into this file when M7 closes.
