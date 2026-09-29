# Synora — Release 1 Launch Checklist

**Canonical.** This file replaced a Release 3 checklist dated 2026-07-28 whose
numbers (919/919 tests) and green ticks no longer described anything that
exists. A checklist that is wrong is worse than none: it is read as evidence.

Last verified: **2026-08-12**, on the founder's laptop, against commit `64afa7f`
plus 80 staged, uncommitted files.

Deployment procedure lives in `SYNORA_OPERATIONS.md` §7. This file is the
gate: what must be true, who does it, and how anyone would know.

---

## Status vocabulary

Used strictly. No item says "ready".

| Status | Means |
|---|---|
| `IMPLEMENTED` | The code exists and is wired. Nothing has been run through it. |
| `ENABLED` | Configuration is present, so the path will be selected at runtime. |
| `VERIFIED` | It was actually executed and observed to work. |
| `EXPERIMENTAL` | Runs, but has not been validated against anything independent. |
| `RESEARCH_ONLY` | Described for the record. No executable path. |
| `BLOCKED` | Cannot proceed until something outside the code changes. |
| `NOT_IMPLEMENTED` | No adapter or code path exists. A code change, not a credential. |
| `NOT_VERIFIED` | Implemented and/or enabled, but never executed. **Not a failure — an absence of evidence.** |

`ENABLED` is not `VERIFIED`. A key being present is not a key working — the
provider health check found exactly that on 2026-08-12 (see A-7).

---

## A. SAFE TO DO BEFORE DEPLOYMENT

Nothing here touches production, spends money, or needs a credential the
founder does not already hold.

| # | Item | Status |
|---|---|---|
| **A-1** | **Full test suite** | `VERIFIED` |
| | *Purpose* — prove the code does what its tests claim before anything is shipped. |
| | *Action* — `cd apps/backend && npx vitest run`, then `cd apps/web && npx vitest run`. **Sequentially.** |
| | *Party* — Claude · *Mode* — automated · *Prereq* — a reachable PostgreSQL for the backend route tests |
| | *Verification* — backend 3321/3321 (292 files); web 752/752 (108 files) |
| | *Rollback* — none needed; read-only |
| | *Note* — running both suites CONCURRENTLY on this laptop produces false failures. `getByRole(…, { name })` computes an accessibility tree, and under CPU contention it exceeds vitest's 5000ms per-test budget. Two different web tests failed this way on 2026-08-12; both passed clean sequentially. **Do not "fix" this with a timeout.** |
| **A-2** | **Typecheck** | `VERIFIED` |
| | *Purpose* — catch contract breaks tests miss. *Action* — `pnpm run type-check`. *Party* — Claude · automated |
| | *Verification* — 8/8 packages · *Rollback* — n/a |
| **A-3** | **Lint** | `VERIFIED` |
| | *Action* — `cd apps/backend && npx eslint src --ext .ts`. *Verification* — 0 errors (213 pre-existing `any` warnings) |
| **A-4** | **Dependency audit** | `VERIFIED` |
| | *Action* — `pnpm audit --audit-level low`. *Verification* — no known vulnerabilities · *Rollback* — n/a |
| **A-5** | **Security guardrails** | `VERIFIED` |
| | *Purpose* — tracked secrets, placeholder credentials, vendor coupling, exposed ports. |
| | *Action* — `node scripts/guardrails.mjs`. *Verification* — 8/8 · *Prereq* — none |
| **A-6** | **Capability report** | `VERIFIED` |
| | *Purpose* — what Synora can actually do, from the live registries rather than from memory. |
| | *Action* — `pnpm --filter @synora/backend capabilities:report` · automated, offline, free |
| | *Verification* — prints a state per capability; see §17 matrix |
| **A-7** | **Provider health check** | `VERIFIED` (the check ran; one provider FAILED) |
| | *Purpose* — turn CONFIGURED into VALID/INVALID before a user does it for you. |
| | *Action* — `pnpm --filter @synora/backend providers:health`. Cheapest authenticated call per provider; no generation, no tokens. |
| | *Verification* — 2026-08-12: `ollama` **VALID**, `self-hosted` **INVALID (HTTP 401)** |
| | *Rollback* — read-only |
| **A-8** | **Text smoke test** | `VERIFIED` |
| | *Purpose* — one real generation through resolver → adapter → model → spend guard. The only thing that separates ENABLED from VERIFIED. |
| | *Action* — `pnpm --filter @synora/backend smoke:text`. Refuses automatically if the resolved provider is metered, unless `--allow-paid`. |
| | *Verification* — 2026-08-12 via Ollama `qwen3:4b`: in 15 / out 229 tokens, 43.5s, response `"OK"`, normalised shape OK |
| **A-9** | **Local Docker stack** | `VERIFIED` |
| | *Action* — `docker compose -f docker-compose.production.yml up -d`. *Verification* — postgres, redis, app, web all healthy |
| | *Rollback* — `docker compose -f docker-compose.production.yml down` (containers only; **never** `-v`, which would delete the data volume) |
| | *Warning* — `docker-compose.dev.yml` and `docker-compose.production.yml` share the compose project name and service keys. Running the dev file REPLACES the production containers. This happened on 2026-08-11 and was recovered; the volume was never touched. |
| **A-10** | **Migrations reproduce the schema** | `VERIFIED` |
| | *Action* — CI asserts it; locally `prisma migrate deploy`. *Verification* — 41 migrations apply cleanly to an empty database |
| | *Rollback* — restore from backup; **never** hand-edit a migration |
| **A-11** | **Control Center** | `IMPLEMENTED` |
| | *Action* — `cd tools/synora-control-center && npm install && npm run compile`, then F5 in VS Code |
| | *Party* — founder · manual · *Verification* — the panel opens and buttons produce real output |
| | *Note* — outside the pnpm workspace by design; cannot affect install, tests, build or CI |

---

## B. REQUIRES FOUNDER APPROVAL

Outward-facing or irreversible. Claude will not do these unprompted.

| # | Item | Status |
|---|---|---|
| **B-1** | **Commit the 80 staged files** | `BLOCKED` — awaiting approval |
| | *Purpose* — nothing can be deployed that exists only in a working tree. |
| | *Action* — `git commit` on `claude/synora-ai-platform-h5q0k2` |
| | *Party* — founder decides; Claude may execute · *Prereq* — A-1…A-8 green, diff reviewed |
| | *Verification* — `git log -1` shows the commit; `git status` clean |
| | *Rollback* — `git reset --soft HEAD~1` (keeps every change staged) |
| | *Note* — the files were staged by the IDE, not by Claude. |
| **B-2** | **Push the branch** | `BLOCKED` — awaiting approval |
| | *Purpose* — the VPS clones from GitHub. Code on a laptop cannot deploy. |
| | *Action* — `git push -u origin claude/synora-ai-platform-h5q0k2` |
| | *Party* — founder approves; Claude may execute · *Prereq* — B-1 |
| | *Verification* — `git branch -r --contains HEAD` is non-empty |
| | *Rollback* — the branch is not the default branch; deleting the remote branch is safe. **Never force-push.** |
| **B-3** | **Install the deploy SSH key on the VPS** | `BLOCKED` — founder only |
| | *Purpose* — the only way to reach the server. Public keys are not secrets. |
| | *Action* — `type $env:USERPROFILE\.ssh\synora_deploy.pub`, then hPanel → VPS `srv1891213` → SSH Keys → Add |
| | *Party* — **founder** · manual · *Prereq* — none |
| | *Verification* — `ssh -i ~/.ssh/synora_deploy root@200.234.32.93 'echo ok'` returns `ok` |
| | *Rollback* — delete the key in hPanel. Fully reversible. |
| | *Why not a password* — pasting one into a chat would put a live credential in a transcript. |
| **B-4** | **Fix the text provider** | `BLOCKED` — founder decision |
| | *Purpose* — `AI_PROVIDER=self-hosted` is forced and that endpoint returns 401. Text fails on the first real request. |
| | *Action* — EITHER re-issue `SELF_HOSTED_TEXT_API_KEY` via `scripts/set-secrets.ps1`, OR set `AI_PROVIDER=ollama` (free, already verified) |
| | *Party* — founder · manual · *Verification* — A-7 shows VALID, then A-8 passes |
| | *Rollback* — revert the one variable |
| **B-5** | **DNS cutover** | `BLOCKED` — not yet, and not needed to start |
| | *Purpose* — point `trysynora.com` at the VPS so TLS can be issued. |
| | *Party* — **founder** · manual · *Prereq* — the stack running and healthy on the VPS |
| | *Verification* — `dig trysynora.com` returns the VPS address from multiple resolvers |
| | *Rollback* — **re-point the domain to Hostinger hosting via hPanel.** NOT "restore these two A records": Hostinger serves a rotating address pool, and previously-recorded IPs no longer exist. |
| **B-6** | **Off-host backup** | `BLOCKED` — mandatory before real user data |
| | *Purpose* — a backup on the same machine as the database is not a backup. |
| | *Party* — founder · *Prereq* — costs money (see D-1) |

---

## C. REQUIRES CLOUD / API CREDENTIALS

Nothing here blocks launch. Each is a capability that stays off until a key exists.

| Capability | Variable (name only) | Status without it |
|---|---|---|
| Frontier text | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_API_KEY` | `IMPLEMENTED`, `NOT_VERIFIED` — local Ollama covers launch |
| Open-weight text via cloud | `OPENROUTER_API_KEY` + `OPENROUTER_MODEL`, `GROQ_API_KEY`, `TOGETHER_API_KEY` | `IMPLEMENTED`, `NOT_VERIFIED` |
| Image | `OPENAI_API_KEY` + `OPENAI_IMAGE_MODEL` | `IMPLEMENTED`, `NOT_VERIFIED` |
| Video | `REPLICATE_API_KEY` + `REPLICATE_VIDEO_MODEL` | `IMPLEMENTED`, `NOT_VERIFIED` |
| Text-to-speech | `OPENAI_API_KEY` + `OPENAI_TTS_MODEL` | `IMPLEMENTED`, `NOT_VERIFIED` |
| Embeddings (cloud) | `VOYAGE_API_KEY` / `COHERE_API_KEY` | `IMPLEMENTED`, `NOT_VERIFIED` |
| Quantum cloud | `IBM_QUANTUM_API_TOKEN` | `IMPLEMENTED`, `NOT_VERIFIED` — local simulator needs nothing |

*Verification for every row* — set the variable, run A-7, then the capability's
own smoke path. *Rollback* — unset the variable; the capability returns to
`IMPLEMENTED`.

**Every one of these is metered.** `AI_GLOBAL_MAX_COST_PER_DAY_CENTS` must be
set before the first paid key, and staging/production refuse to boot otherwise.

**Free and local, needing no account:** `VECTORDB_PGVECTOR_ENABLED=true`
(reuses the existing PostgreSQL) and `EMBEDDINGS_OLLAMA_BASE_URL` (needs Ollama
restarted with `--embeddings`, or a ~275 MB embedding model pulled — a founder
decision about disk and bandwidth, never automatic).

---

## D. REQUIRES PAID INFRASTRUCTURE

| # | Item | Status |
|---|---|---|
| **D-1** | Off-host backup storage (object storage or a second host) | `BLOCKED` — mandatory before real user data |
| **D-2** | Paid QPU execution — `QUANTUM_PAID_QPU_ENABLED` + a non-zero per-execution ceiling | `BLOCKED` by design. Not a launch item. Three independent gates default to refusing. |
| **D-3** | GPU host for local image/video/large text models | `NOT_IMPLEMENTED` — no local image or video runtime exists at any price on this laptop |
| **D-4** | Paid text/image/video provider accounts | Optional; see C |

*Rollback for all* — none is load-bearing for Release 1. Not purchasing them
leaves Synora exactly as it is today.

---

## E. POST-LAUNCH TASKS

| # | Item | Status |
|---|---|---|
| **E-1** | Confirm TLS renews automatically (Caddy) after ~60 days | `NOT_VERIFIED` — unverifiable before DNS exists |
| **E-2** | Prove a real restore from an off-host backup, not just that a backup file exists | `NOT_VERIFIED` |
| **E-3** | Watch `AiGlobalSpendDay` for the first week once any paid key is live | `NOT_VERIFIED` |
| **E-4** | Durable knowledge stores — two Prisma models are specified in `knowledge/ports.ts`; ingestion progress does not survive a restart until they exist | `NOT_IMPLEMENTED` |
| **E-5** | Verify RAG end to end with a real embedding provider | `NOT_VERIFIED` — pipeline unit-tested, never run with a real embedder |
| **E-6** | Re-run A-7 weekly — credentials expire, and the first person to notice should not be a customer | `NOT_VERIFIED` |
| **E-7** | Move stale point-in-time reports out of `docs/` into `docs/archive/` | `NOT_IMPLEMENTED` |

---

## The gate

Release 1 may deploy when **A-1…A-10 are `VERIFIED`** and **B-1, B-2, B-3, B-4
are resolved**. B-5 (DNS) comes after the stack is healthy on the VPS, not
before. C and D block no part of launch.

As of 2026-08-12: **A is green. B-1 through B-4 are open.** Synora is not
deployable today, and the reason is four founder actions, not code.
