# Release 1 Launch Readiness

**Status:** ✅ Release 1 complete — all 8 blockers (R1-a through R1-h) verified
**Branch:** `claude/synora-ai-platform-h5q0k2`
**Scope:** per `RELEASE_ROADMAP.md` — a real, launchable SaaS for real paying
customers: sign up, authenticate securely, get real AI-generated value from
an API key, deployed reproducibly with no data loss or secret leakage.

This document is the founder's deliverable: exact env vars, keys, deploy and
migration commands, and a checklist proving no further code step remains
before launch. Everything below is the operational surface — no application
code needs to change to go live; only environment configuration.

---

## 1. Release 1 checklist — every blocker, verified

| ID | Item | Status | Detail |
|---|---|---|---|
| R1-a | Login email-enumeration timing fix | ✅ | `docs/production/R1-a_EMAIL_ENUMERATION.md` |
| R1-b | Input validation on every mutating route (400, never 500) | ✅ | `docs/production/R1-b_INPUT_VALIDATION.md` |
| R1-c | Refresh tokens + real logout invalidation | ✅ | `docs/production/R1-c_REFRESH_TOKENS.md` |
| R1-d | Per-account login lockout | ✅ | `docs/production/R1-d_ACCOUNT_LOCKOUT.md` |
| R1-e | Provider-agnostic AI text/code generation (10 providers) | ✅ | `docs/production/R1-e_AI_PROVIDER_ABSTRACTION.md` |
| R1-f | Production Dockerfile + runnable bundle | ✅ | `docs/production/R1-f_DOCKERFILE.md` |
| R1-g | Blocking CI secret + dependency-vulnerability scans | ✅ | `docs/production/R1-g_SUPPLY_CHAIN_SECURITY.md` |
| R1-h | This document | ✅ | — |

Every item above has its own doc with: what was wrong, what changed, real
tests (against live Postgres, no mocks at the integration layer), a
production-boot verification over real HTTP, and a security/architecture/
performance review. This document does not repeat that detail — it only
assembles what an operator needs to actually deploy.

**Full-stack verification at time of writing:** backend type-check ✅ · lint
0 errors ✅ · 273 backend tests + 1 web test ✅ (live Postgres 16, no mocks
at the route/DB boundary) · full monorepo build 5/5 ✅ · Docker image builds
and the container's `/health` responds 200 in CI ✅ · CI pipeline (test,
docker, security jobs) green ✅.

---

## 2. Environment variables — the exact list

### 2.1 Required in staging/production (boot fails without these)

The app calls `secretsManager.validateRequired()` at startup and **refuses
to boot** (fail-closed, not fail-open) if any of these are missing in a
`staging` or `production` `APP_STAGE`:

| Variable | Purpose | How to generate |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Provided by your managed Postgres (RDS/Neon/Supabase/Railway) |
| `JWT_SECRET` | Signs access/refresh JWTs | `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` | Session/cookie encryption (web app) | `openssl rand -base64 32` |

### 2.2 Required for real AI generation (at least one provider)

None of these are required for the app to **boot** — `POST /api/ai/generate`
simply returns a clean, logged error (`NoProviderConfiguredError`) until one
is set. Set exactly one provider's key (or several — the first configured,
in the priority order below, is auto-selected) to activate real generation
with **no code change and no redeploy of new code**, only a config/secret
update and process restart:

**Priority order (first configured wins unless `AI_PROVIDER` is set explicitly):**

1. **Anthropic Claude** (Release 1 default) — `ANTHROPIC_API_KEY` (optional: `ANTHROPIC_MODEL`, default `claude-sonnet-5`)
2. **OpenAI** — `OPENAI_API_KEY` (optional: `OPENAI_MODEL`, default `gpt-4o`)
3. **Google Gemini** — `GOOGLE_AI_API_KEY` (optional: `GEMINI_MODEL`, default `gemini-1.5-pro`)
4. **xAI Grok** — `XAI_API_KEY` (optional: `XAI_MODEL`, default `grok-2-latest`)
5. **OpenRouter** — `OPENROUTER_API_KEY` (optional: `OPENROUTER_MODEL`, default `anthropic/claude-3.5-sonnet`)
6. **DeepSeek** — `DEEPSEEK_API_KEY` (optional: `DEEPSEEK_MODEL`, default `deepseek-chat`)
7. **Together AI** — `TOGETHER_API_KEY` (optional: `TOGETHER_MODEL`, default `meta-llama/Llama-3.3-70B-Instruct-Turbo`)
8. **Azure OpenAI** — `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT` (all three required together; optional `AZURE_OPENAI_API_VERSION`, default `2024-10-21`)
9. **AWS Bedrock** — `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `BEDROCK_REGION` (all three required together — `BEDROCK_REGION` has no default, deliberately, since the AWS credential vars alone are too common in AWS-hosted infrastructure for unrelated reasons to safely auto-activate a paid AI provider; optional `BEDROCK_MODEL_ID`, default a Claude 3.5 Sonnet Bedrock model)
10. **Ollama** (self-hosted, no API key) — `OLLAMA_BASE_URL` (required, no default — e.g. `http://localhost:11434`; optional `OLLAMA_MODEL`, default `llama3.1`)

To force a specific provider regardless of what else is configured, set
`AI_PROVIDER` to its id (`anthropic`, `openai`, `gemini`, `xai`,
`openrouter`, `deepseek`, `together`, `azure-openai`, `bedrock`, `ollama`).

### 2.3 Everything else (has a working default — override only if needed)

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Standard Node environment flag |
| `APP_STAGE` | `development` | `development \| testing \| qa \| staging \| production` — drives rate-limit strictness, log level, etc. |
| `PORT` | `3001` | Backend listen port |
| `NEXTAUTH_URL` | `http://localhost:3000` | Web app's own URL |
| `BACKEND_URL` | `http://localhost:3001` | Backend's own URL |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin allowlist |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Frontend's API base URL |
| `MAX_FAILED_LOGIN_ATTEMPTS` | `5` | Login lockout threshold (R1-d) |
| `LOCKOUT_DURATION_MINUTES` | `15` | Login lockout duration (R1-d) |
| `OFFLINE_MODE`, `MOCK_MODE`, `ENTERPRISE_MODE`, `GOVERNMENT_MODE`, `SELF_HOSTED_MODE` | `false` | Operating-mode flags — see `docs/operations/ENVIRONMENT_MANAGEMENT.md` |

The full, current, authoritative list of every variable (with inline
comments) is `.env.example` at the repo root — copy it, do not retype it.

### 2.4 Not required for Release 1

- `SNYK_TOKEN` — CI-only (best-effort, non-blocking security scan); irrelevant to running the app.
- `REPLICATE_API_KEY` — reserved for image generation, which is Release 2+ (R2-d). Not wired to any route yet.

---

## 3. Deploy commands

### 3.1 Build the production image

```bash
docker build -t synora-backend:latest -f Dockerfile .
```

Multi-stage build (`Dockerfile`): installs the full pnpm workspace, runs
`prisma generate` + `tsc`/`tsup`, prunes dev dependencies
(`CI=true pnpm prune --prod` — non-interactive in Docker's non-TTY build
environment), then ships a minimal runtime stage that runs as the
non-root `node` user.

### 3.2 Run database migrations (before starting the app, every deploy)

```bash
DATABASE_URL="<your-production-database-url>" \
  pnpm --filter @synora/database db:migrate
```

This runs `prisma migrate deploy` — applies any pending migrations
idempotently; safe to run on every deploy, including when there is nothing
new to apply.

### 3.3 Run the container

```bash
docker run -d --name synora-backend \
  -e NODE_ENV=production \
  -e APP_STAGE=production \
  -e PORT=3001 \
  -e DATABASE_URL="<your-production-database-url>" \
  -e JWT_SECRET="<generated-with-openssl-rand-base64-32>" \
  -e NEXTAUTH_SECRET="<generated-with-openssl-rand-base64-32>" \
  -e ANTHROPIC_API_KEY="<your-real-anthropic-key>" \
  -p 3001:3001 \
  synora-backend:latest
```

Add any other AI provider's env vars from §2.2 as needed; omit
`ANTHROPIC_API_KEY` entirely if you'd rather activate a different provider
first — the app boots fine either way, and `/api/ai/generate` reports a
clean, actionable error until at least one is set.

### 3.4 Verify the deploy

```bash
curl -f http://<host>:3001/health   # liveness — should always be 200 if the process is up
curl -f http://<host>:3001/ready    # readiness — 200 only once the database is reachable
```

`HEALTHCHECK` is also baked into the image (30s interval, 3 retries) for
orchestrators that read Docker's own health status.

### 3.5 Managed Postgres satisfies backup/DR for Release 1

Per `RELEASE_ROADMAP.md` (R2-g), Release 1 relies on a **managed** Postgres
provider (RDS, Neon, Supabase, Railway, etc.) for automated backups and
point-in-time recovery — this is a deployment choice, not application code.
Confirm your chosen provider has PITR/automated backups enabled before
launch; owning the backup job in-app is a Release 2 upgrade (R2-g).

---

## 4. What is explicitly out of scope for Release 1 (by design, not oversight)

Per `RELEASE_ROADMAP.md`'s founder-overridable decisions — say the word and
these move up, but the default is:

- **MFA** — built on `recover/mfa`, not yet reintegrated; Release 2 (R2-a). A SaaS can launch without mandatory MFA (Stripe, Linear, Notion all did).
- **CSRF + cookie auth** — Release 1 uses bearer tokens in the `Authorization` header, which are not CSRF-vulnerable; CSRF protection is correctly coupled to a future cookie-auth migration (R2-b).
- **Image/video/audio generation** — Release 1 ships text/code generation only (fast enough to serve synchronously, no queue needed); media generation needs an async job queue + object storage (R2-d, R3-c).
- **Redis-backed shared state** — Release 1 runs single-instance, where the current DB-backed lockout/rate-limit state is already correct; Redis is needed only at ≥2 instances (R2-c).

None of these block a real, secure, revenue-generating launch of the core
product.

---

## 5. No code step remains

Everything above this line is environment configuration and deploy
commands. There is no further application code to write, no migration to
author, and no test to add before Release 1 can serve real customers — the
next action is provisioning real infrastructure (managed Postgres, a
container host, real API keys) and setting the environment variables in
§2.
