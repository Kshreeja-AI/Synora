# NEEDS_FOUNDER — 2026-11-07

No secret values appear in this file. Variable NAMES only.

## 1. Database (blocks the deploy) — STOP RULE: needs an account/credential I do not have
Root cause of the failing deploys: the service's `DATABASE_URL` points at the Supabase
direct host `db.<project-ref>.supabase.co:5432` and the backend's `prisma.$connect()` fails with
`Can't reach database server`. The Supabase project `Synora` is ACTIVE_HEALTHY, so the
database is up; Render cannot reach it from there. (Likely cause, NOT verified: Supabase's direct
host is IPv6-only unless the paid IPv4 add-on is on, and Render has no IPv6 egress.)

Do ONE of these in the Render dashboard (synora-api -> Environment):
- Create a free Neon Postgres (no card) and set `DATABASE_URL` to its pooled connection string; or
- Set `DATABASE_URL` to the Supabase **pooler** (IPv4) connection string for project `Synora`.
  Caution: that project may hold real data. Migrations run against it would change it.

Then run `prisma migrate deploy` against it (Render shell, or a one-off locally with the URL in your own shell).

## 2. Push to GitHub — STOP RULE: no credentials in this WSL session
`git fetch`/`git push` fail: `could not read Username for 'https://github.com'`. No `gh`, no credential helper.
Local commit ready: `0c7e6d0` on branch `build/capabilities-2026-11`.
Backup of all uncommitted work: branch `backup/pre-launch-20261107-1959` (commit `fc7354d`).
Render builds the `SYNORA` branch, so the assistant endpoint is NOT deployable until this is pushed.
Remote difference was not inspected (fetch failed); do a fast-forward-only push or open a PR.

## 3. Secrets — I did not write these (a value passed to a tool call would appear in the transcript)
`JWT_SECRET`, `NEXTAUTH_SECRET`, `TOOL_SECRET_MASTER_KEY` and `DATABASE_URL` are already present in the
Render environment (boot log shows them read from env). I cannot see whether they are development values.
If they are, replace each with `openssl rand -base64 32` output in the dashboard.

## 4. Assistant provider key (free tier)
Set ONE in the Render dashboard: `GROQ_API_KEY` or `OPENROUTER_API_KEY`.
Also consider `AI_PROVIDER` (set to that provider's id) so a paid key can never be picked first.

## 5. Spend caps — the task's "cap = 0" is rejected by the backend itself
Setting `AI_GLOBAL_MAX_COST_PER_DAY_CENTS=0` / `AI_GLOBAL_MAX_TOKENS_PER_DAY=0` made boot abort:
`Configuration failed validation: ai.globalMaxCostPerDayCents: Number must be greater than 0` (same for tokens).
So both were reset to empty (= unset) on Render. With them unset, boot works and the assistant answers 503
`assistant-not-configured` (the endpoint requires at least one positive cap before it will spend anything).
To go live: set `AI_GLOBAL_MAX_TOKENS_PER_DAY` to a positive number (for example 200000) — your decision, it is a spend limit.

## 6. Redis
No `REDIS_URL`. The app boots without it (workers log ECONNREFUSED and boot continues) but the log is very noisy.
Per-user spend caps are unavailable without Redis.

## Not touched (stop rules)
DNS / trysynora.com, Hostinger VPS, any paid plan, force push.
