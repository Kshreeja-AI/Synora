# PERFORMANCE_REVIEW_v2.md

**Reviewer:** Senior Performance Engineer (independent review)
**Date:** 2026-07-21
**Scope:** Authentication system end to end — `routes/auth.ts`, `middleware/auth.ts`, SecretsManager hot path, MFA rate limiter, Prisma/Postgres, logging, rate limiting
**Method:** Full source read **plus empirical micro-benchmarks run against this repo's installed dependencies** (Node v22, `bcryptjs@2.x`, `jsonwebtoken@9`). Benchmark numbers below are measured, not estimated, on this environment; absolute values will shift with hardware but the ratios hold.

## Performance Score: 42 / 100

**One-line verdict:** The token path is fast and stateless (µs-scale JWT, memory-cached secrets) — but the login path runs **pure-JavaScript bcrypt on the event loop**, capping any single node at roughly **3–4 password verifications per second per core** with ~100ms latency stalls for every other request in flight, and the surrounding system (six Prisma clients, per-instance in-memory rate limits, an audit log line per authenticated request, a synchronous DB write per login) compounds it. Nothing here survives contact with 1,000 concurrently active users unmodified.

---

## Measured Baseline (this environment)

| Operation | Measured | Notes |
|---|---|---|
| `bcryptjs.hash`, cost 12 (register) | **366 ms** | Pure JS, main thread |
| `bcryptjs.compare`, cost 12 (login) | **273 ms** | Pure JS, main thread |
| Max event-loop stall during one hash | **97 ms** | "Async" bcryptjs yields between rounds, but coarsely |
| `jwt.sign` HS256 | 0.034 ms | Negligible |
| `jwt.verify` HS256 (valid) | 0.030 ms | Negligible |
| `jwt.verify` (wrong secret, throw/catch) | 0.043 ms | Exception path ~1.4× valid path |
| Pretty `JSON.stringify` of one audit payload | 0.0003 ms | Cheap per-op; the problem is volume (see §Logging) |

Derived request-path estimates (excluding network, cold pool):

| Endpoint | Dominant cost | Est. p50 |
|---|---|---|
| `POST /register` | bcrypt hash 366ms + 2 queries | ~380–420 ms |
| `POST /login` (valid email) | bcrypt compare 273ms + 2 queries + sign | ~290–330 ms |
| `POST /login` (unknown email) | 1 indexed query | ~3–8 ms |
| `GET /users/me` | verify 0.03ms + 1 PK query | ~2–6 ms |
| Any request, invalid token | verify-fail loop | ~0.1 ms |

---

## Findings by Area

### 1. Crypto cost — the defining bottleneck 🔴

`routes/auth.ts` uses **`bcryptjs`** — the pure-JavaScript implementation — at cost 12. Measured: 366ms hash, 273ms compare, executed on the main thread with up to 97ms uninterrupted event-loop stalls.

Consequences:
- **Throughput ceiling:** one Node process ≈ 3.6 password verifications/sec. Ten users logging in within the same second queue ~2.7s of main-thread crypto.
- **Collateral latency:** during each login, *every* other request on that process — including 5ms `/users/me` calls — inherits up to ~100ms of stall. Login traffic degrades the whole API's p99.
- **DoS amplification:** an attacker who knows any valid email can POST wrong passwords; each costs the server 273ms of CPU vs ~0ms for the attacker. ~4 rps of such traffic saturates a core. The global 100-req/window IP limiter barely blunts a distributed version of this.

**Fix (Phase 1):** switch to native `bcrypt` (libuv threadpool: off the event loop, ~2–3× faster) or `argon2` (argon2id, also threadpool). Set `UV_THREADPOOL_SIZE` ≥ CPU count. Keep cost 12. This one dependency swap raises login throughput ~10× per node and eliminates event-loop stalls. Add a per-account + per-IP login rate limit (see §Rate limiting) to close the amplification hole.

### 2. Database queries & indexes 🟡

The auth queries themselves are clean: `findUnique` on `email` (unique index) and PK lookups. Issues:

- **Synchronous write per login:** `prisma.user.update({ lastLoginAt })` sits on the login hot path — a WAL-generating row update that adds ~2–5ms and, at scale, real write load and row-version churn for a purely informational field. Fire-and-forget it (`.catch`), or funnel through a queue/batch.
- **Redundant index:** `User` declares both `email @unique` *and* `@@index([email])` — two indexes on the same column; every user write maintains both. Drop the explicit one.
- **MFA rate limiter reads the audit table per attempt:** `checkVerificationAttempt` = 1 `count` + 1 `findMany` against `MFAAuditLog` per verification. Correct as an audit source of truth, wrong as the primary counter under attack traffic (the moment you most need it to be cheap). Counters belong in Redis; the audit table stays the immutable record.
- **N+1:** none today (no auth endpoint loads relations in a loop). `GET /users/:id` includes `profile` in a single query — fine. Risk is latent in the unpaginated list endpoints elsewhere, not in auth.

### 3. Prisma & connection pool 🔴

Six `new PrismaClient()` instances (five route files + tests pattern). Each maintains its own pool (default `num_physical_cpus × 2 + 1`). On a 4-core box: ~9 connections × 6 clients = **up to 54 connections from one process**; two replicas ≈ 108 > Postgres's default `max_connections=100`. Scale-out produces `FATAL: sorry, too many clients` at exactly the wrong moment.

**Fix:** one shared client exported from `@synora/database` (one-hour change, already flagged in ARCHITECTURE_REVIEW_v2 §5–7), explicit `connection_limit` in `DATABASE_URL`, and PgBouncer (transaction mode) before the 3rd replica.

### 4. JWT verification & secrets hot path 🟢 mostly

- HS256 verify at 30µs supports >30k verifications/sec/core — not a bottleneck at any tier below 10M users.
- The rotation-aware `verifyToken` loops candidates newest-first with try/catch per miss. With K historical secret versions, an *invalid* token costs K × 43µs plus K exception unwinds. Fine for K ≤ 3; cap retained versions to the rotation grace window (2) so hostile garbage tokens can't multiply the work.
- `secretsManager.get('JWT_SECRET')` per request resolves from an in-memory `Map` — good — **but emits a winston `info` audit line on every read** (see next).

### 5. Logging on the hot path 🔴

Every authenticated request currently produces: 1 request-logger line + 1 `[secret-audit] read: JWT_SECRET` line, each pretty-printed (`JSON.stringify(args, null, 2)`) and written to a Console transport **plus two File transports** (`logs/error.log`, `logs/all.log`). Per-line cost is small (~µs formatting + write syscalls); the problems are:

- **Volume:** at 1k rps this is ~170M identical audit lines/day saying the backend read its own JWT secret — it drowns the *meaningful* audit events (placeholder access, rotation) that the design exists to capture.
- **File transports on containers** are an anti-pattern (unbounded disk growth, no rotation configured, lost on reschedule) and winston file writes back-pressure under burst.
- MFA services still call `console.log/error` directly, bypassing levels and transports entirely.

**Fix:** audit-log secret reads at most once per key per process lifetime (or sample + counter); single-line JSON to stdout only, ship via the platform; route MFA services through the injected logger.

### 6. Memory, GC & large allocations 🟡

- `express.json({ limit: '10mb' })` applies globally — a 10MB body is parseable *on the login route*. Body parsing is main-thread; a burst of large bodies is another event-loop attack. Scope big limits to the (future) upload/generation routes; auth needs 16KB.
- `express-rate-limit` MemoryStore grows one entry per unique IP per window — fine at small scale, unbounded churn under spoofed-source floods.
- `AlertingService` stores alerts in an unbounded in-process `Map` (flagged in the architecture review) — a slow leak once wired to real traffic.
- GC pressure is otherwise modest: JWT payloads are tiny; the dominant allocations are log-line objects (2/request — halved by the audit fix above). No large-object heap risks in auth itself.

### 7. Rate limiting 🔴

One global limiter: `100 requests / window / IP`, **in process memory**. Three problems: it resets on every deploy; each replica multiplies the attacker budget (N replicas = N × budget, and a load balancer spreads them for free); and there is **no per-account throttle on `/login`** — the endpoint whose unit cost is 273ms of your CPU. The security control and the performance control are the same control here, and it currently fails both ways at >1 replica.

**Fix:** Redis-backed store (`rate-limit-redis`) with: global IP limit (coarse), `/login` + `/register` tight IP limit (e.g. 10/min), and per-account failed-attempt counter (which the MFA lockout logic then reads from Redis instead of Postgres).

### 8. Caching & Redis opportunities 🟡

Nothing is cached today. Ranked by value:
1. **Rate-limit + lockout counters** (correctness at >1 replica, not just speed).
2. **Token revocation list** (enables logout invalidation — currently a security gap — at O(1) per request).
3. **`GET /users/me`** short-TTL (30–60s) cache keyed by user id: it's called by every page load; a PK query saved per page at 100k users is real DB headroom. Invalidate on profile mutation.
4. **JWT secret material**: already memory-cached; no Redis needed.
Skip HTTP-level caching for auth responses (all private); `Cache-Control: no-store` should be *added* for correctness.

### 9. Cold start 🟢

Boot = secrets validation (env reads, ms) + config parse (zod, ms) + Express wiring; Prisma connects lazily on first query (~50–150ms, ×6 clients today). Total cold start well under 1s — fine for VMs/containers, not currently serverless-shaped (module-scope singletons, file logging) and shouldn't try to be. **Fix:** after the client consolidation, `await db.$connect()` in bootstrap and surface it in `/ready` so the first user request doesn't pay the connect.

---

## Scalability by Tier

Assumptions: 1 login/user/day concentrated in a 2-hour peak; 20 authenticated API calls/user/day; 4-core nodes.

**100 users** — ~0.03 peak logins/sec. Works as-is. Only visible symptom: occasional 100–400ms p99 blips when a login coincides with other traffic (bcryptjs stalls). No action strictly required; do the Prisma singleton anyway.

**1,000 users** — ~0.3 peak logins/sec sustained, bursts of 5–10/sec (Monday 9am). Bursts queue 1.5–2.7s of main-thread crypto; p99 across the whole API degrades badly during them. **Required:** native bcrypt/argon2 (Phase 1). Everything else holds on one node.

**100,000 users** — ~30 peak logins/sec, ~700 authenticated reqs/sec. Needs 2–4 replicas → **in-memory rate limiting silently breaks (security regression, not just perf)** and 6-client pooling exhausts Postgres connections. **Required:** Redis rate limits + lockouts, Prisma singleton + PgBouncer, audit-log sampling (log volume at this tier is ~120M lines/day otherwise), `/users/me` cache, fire-and-forget `lastLoginAt`. JWT verify remains trivially cheap — statelessness is carrying you.

**1,000,000 users** — ~300 logins/sec peak (native bcrypt: ~25–30 nodes of threadpool crypto, or ~10 with argon2 tuned), ~7k reqs/sec. **Required:** dedicated auth worker pool or auth service extraction (the first justified microservice — CPU profile differs from the API's I/O profile); Postgres read replica for user lookups; `MFAAuditLog` time-partitioning + retention job (it's the fastest-growing table and its `cleanupOldLogs` delete will no longer finish in one transaction); revocation checks via Redis only.

**10,000,000 users** — ~3k logins/sec peak, ~70k reqs/sec. Token *verification* moves to the edge (the HS256 shared-secret design becomes the blocker — migrate to RS256/EdDSA so edge PoPs verify with public keys without holding the signing secret; this is the point where the current `HS256` choice, correct today, must be revisited). Regional auth cells, per-cell Postgres with global user directory, bcrypt cost re-evaluated against hardware, and the secrets-rotation grace-window design (already built!) becomes genuinely load-bearing for zero-downtime key rolls across cells.

---

## Optimization Roadmap

**Phase 1 — the 10× (1–2 days, do before any launch)**
1. `bcryptjs` → native `bcrypt` or `argon2id`; `UV_THREADPOOL_SIZE=cores`. *(10× login throughput, removes event-loop stalls)*
2. Prisma client singleton + `connection_limit`. *(Removes the scale-out landmine)*
3. Tight `/login`+`/register` limits and per-account counters (in-memory acceptable single-node; interface ready for Redis). *(Closes CPU-amplification DoS)*
4. Scope `express.json` body limits per route (16KB auth).

**Phase 2 — multi-node correctness (2–3 days, before the 2nd replica)**
5. Redis: rate-limit store, failed-login/lockout counters, revocation list.
6. Fire-and-forget `lastLoginAt`; drop redundant `User.email` index.
7. Audit-log sampling for hot secret reads; stdout-only single-line JSON; MFA services onto winston.

**Phase 3 — headroom (with first real load, ~1 week)**
8. `/users/me` short-TTL cache; `$connect()` in bootstrap + real `/ready`.
9. PgBouncer; `MFAAuditLog` partitioning + scheduled retention.
10. k6/autocannon load-test suite in CI with budgets: login p95 < 150ms (native bcrypt), `/me` p95 < 20ms, no event-loop lag > 20ms at 2× expected peak. *(This is also Phase A item A5 — the performance baseline should be these budgets, measured, in CI.)*

**Phase 4 — 1M+ (when trajectory demands)**
11. Auth service extraction with dedicated crypto workers; read replicas; RS256/EdDSA migration plan for edge verification.

---

## Score Rationale

| Dimension | Score | Why |
|---|---|---|
| Token path efficiency | 8/10 | µs-scale verify, memory-cached secrets; minor multi-version loop cost |
| Password path efficiency | 1/10 | Pure-JS bcrypt on the event loop; measured 273–366ms + 97ms stalls |
| Data layer | 4/10 | Clean queries, but 6 clients, hot-path write, redundant index, DB-as-counter |
| Horizontal scalability | 3/10 | In-memory rate limits and alerts break at replica #2 |
| Resource hygiene (logs/memory) | 4/10 | Per-request audit lines, file transports, unbounded maps, global 10MB bodies |
| Observability of performance | 4/10 | Good structured logging exists; no metrics, no budgets, A5 pending |
| **Overall** | **42/100** | Fine at 100 users, degraded at 1k, broken at 100k — with a 1–2 day Phase 1 that moves it to ~70 |

*Companion documents: AUTH_SYSTEM_SECURITY_AUDIT_v2.md (security, 28/100), ARCHITECTURE_REVIEW_v2.md (structure, 54/100). Phase 1 items 1–3 overlap with security criticals — one work stream closes both.*
