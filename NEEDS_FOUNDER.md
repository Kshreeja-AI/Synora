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

## 4. Leaked credential in git history — REVOKED (found 2026-11-08, gitleaks 8.30.1)
Status 2026-11-08: founder revoked it; API check returned HTTP 401. Fingerprints added to `.gitleaksignore`. Nothing further required except keeping the new token out of git.
No values here. A Supabase personal access token (`sbp_` prefix) is committed in `47d80c4`, which is on GitHub (origin/SYNORA):
- `SUPABASE_LOCAL_SETUP.sh` (line 50)
- `SUPABASE_REMOTE_INTEGRATION.md` (line 51)
Action: revoke it in Supabase (Account -> Access Tokens) and create a new one. History was NOT rewritten (no force push).
Other gitleaks hits are test fixtures / audit-doc samples: `apps/backend/tests/crypto/encryption.service.test.ts`,
`apps/backend/src/eos/__tests__/redaction.test.ts`, `apps/web/src/components/workflows/__tests__/TriggerPanel.test.tsx`,
`docs/security/AUTH_SYSTEM_SECURITY_AUDIT_v2.md`.
Also: the repo's `.gitleaks.toml` has an invalid `[[allowlists]]` block, so gitleaks refuses to load it.

## 7. DATABASE_URL — RESOLVED 2026-11-08 (history of the problem kept below)
Resolved: founder ran `synora-secret-set --db-password`. Shape valid, connection test OK, role bypasses RLS.
Because the `public` schema already held 4 empty tables (see section 8), the URL now carries `?schema=synora`.
Original problem, for the record:
Checked by script, no value printed. The stored value is 45 characters with no `postgresql://` scheme and no `@`, so it is
not a connection string (most likely only a password or some other string was pasted). Database tasks are BLOCKED until fixed;
all other work continues.
Fix:
1. Supabase dashboard -> project `Synora` (`phxfqibekkqacscagzuc`) -> Connect -> **Session pooler** (port 5432, IPv4).
2. The string must look like: `postgresql://postgres.phxfqibekkqacscagzuc:<PASSWORD>@<aws-...>.pooler.supabase.com:5432/postgres`
   - scheme `postgresql://`, user `postgres.phxfqibekkqacscagzuc`, host ends `pooler.supabase.com`, port `5432`.
   - No `[YOUR-PASSWORD]` placeholder left in it.
   - If the password has `@ # / ? : %` or spaces, percent-encode them (`@`->`%40`, `#`->`%23`, `/`->`%2F`, `?`->`%3F`, `:`->`%3A`, `%`->`%25`).
     Easiest: reset the DB password to letters and digits only, then no encoding is needed.
3. In the terminal: `! synora-secret-set DATABASE_URL` (hidden prompt), paste the whole URL.
4. Tell the release engineer; it re-runs the shape check and the connection test.

## 5. Secret vault (local, WSL)
`synora-secret-set NAME` (hidden prompt), `--gen NAME` (random), `--copy NAME` (to clipboard for pasting into the Render dashboard), `--status`.
Store: `~/.config/synora/vault.env` (mode 600, outside the repo).
`synora-secret-set --db-password` builds the pooler `DATABASE_URL` from a hidden password prompt. Plain values are trimmed first
(whitespace, `\r`, `\n`, trailing `/`) and `CLOUDFLARE_ACCOUNT_ID` must match `^[0-9a-f]{32}$`.
`synora-render-push [--dry-run]` syncs the vault + fixed config to Render, one variable at a time (never the bulk PUT), never deploys.

## 8. Database layout decision (made 2026-11-08, needs your awareness)
`prisma migrate deploy` refuses a non-empty `public` schema (P3005). `public` holds 4 pre-existing, EMPTY tables
(`conversations`, `messages`, `conversation_members`, `message_summaries`; 0 rows; not defined anywhere in this repo; no Supabase
migration record). They were NOT touched. All Synora tables (119 models + 1 implicit join table) live in schema **`synora`**,
reached through `DATABASE_URL=...?schema=synora`. 40/40 Prisma migrations applied; `migrate status`: up to date.
- To use `public` instead: you must approve dropping those 4 empty tables, then re-run migrations with the plain URL.
- `synora` is not exposed through Supabase's REST API (only `public` is), and the `ensure_rls` event trigger covers `public` only; the backend
  connects as `postgres`, which bypasses RLS.
- `synora._prisma_migrations` has one leftover unfinished row from an interrupted run (migration `20260805093136_project_decision_notes`
  was fully applied, then marked applied with `prisma migrate resolve --applied`). Prisma reports no problem; the row is cosmetic.

## 9. Things only you can do before the first real user
1. ~~Cloudflare Account ID was wrong~~ **RESOLVED 2026-11-08**: the 32-hex id is in the vault and on Render; `models/search` returns HTTP 200
   (INTEGRATION VERIFIED) and a real 400-token generation worked on `@cf/meta/llama-3.1-8b-instruct-fp8`.
2. **Nobody can register yet.** `REGISTRATION_MODE=invite` and `REGISTRATION_ALLOWLIST` is empty. Put your own email in it:
   `! synora-secret-set REGISTRATION_ALLOWLIST` (comma separated), then `! synora-render-push`.
3. **Email is not delivered** (`MAIL_TRANSPORT` defaults to `console`: verification links only appear in server logs). Not needed for you to log in. Needed to accept a
   workspace invitation. Free options without DNS: Brevo (free daily quota, single verified sender) or Gmail SMTP with an app password. Then set
   `MAIL_TRANSPORT=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_ADDRESS`.
4. **OpenRouter free models are currently unusable, by your own account setting.** Every `:free` model answers HTTP 404 "ZDR violation (account setting)":
   your OpenRouter account has zero-data-retention enforcement on, and free endpoints retain data. This is the privacy-safe behaviour and was not bypassed.
   So the live chain is effectively Groq -> Cloudflare; OpenRouter is last in `AI_FREE_TIER_CHAIN` (`groq,cloudflare,openrouter`) so it never delays an answer.
   If you want OpenRouter free models, you would have to relax that setting yourself; that is a privacy decision, not mine.
5. **Mistral** is excluded from the chain: its free Experiment plan may train on prompts. Add it only after opting out in Mistral's Admin Console and setting
   `FREE_TIER_TRAINING_OPTOUT_CONFIRMED=mistral`.
6. **Redis is absent:** `QUEUE_ENABLED=false` is set on Render, so background workers (streamed chat generation, file processing) are off. The public assistant does not need them.
7. **Two production advisories stay open on purpose** (major bumps): `zod` 3->4 and `nodemailer` (>=10.0.6; a minor bump to 9.1.x fixes only one of its two advisories).
