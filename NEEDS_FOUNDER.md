# NEEDS_FOUNDER — 2026-11-07 (last updated 2026-11-12)

No secret values appear in this file. Variable NAMES only.

## 1. Database (blocks the deploy) — SUPERSEDED, see section 7
This section described the Nov 7 state (direct Supabase host, IPv6 unreachable from Render).
It was resolved on Nov 8 (section 7 below) and re-confirmed this session (`migrate status` ->
up to date, `/ready` -> database ok). Kept only for history; no action needed.

## 2. Push to GitHub — SUPERSEDED, the commit reached GitHub by a different path
This described a Nov 7 WSL session with no git credentials. By Nov 8 the launch branch's commit
(`7685485`) was on `origin/SYNORA` — confirmed this session (`gh api .../activity`) to be a direct
**push** by account `Synoraagi`, not a push from this kind of session and not a merge-button click.
So the credential problem described here was worked around some other way, or from a different
session/machine with git credentials — NOT VERIFIED which. No action needed now; the commit is on
GitHub. Kept for history.

## 3. Secrets — I did not write these (a value passed to a tool call would appear in the transcript)
`JWT_SECRET`, `NEXTAUTH_SECRET`, `TOOL_SECRET_MASTER_KEY` and `DATABASE_URL` are already present in the
Render environment (boot log shows them read from env). I cannot see whether they are development values.
If they are, replace each with `openssl rand -base64 32` output in the dashboard.

## 4. Assistant provider key (free tier) — RESOLVED, re-confirmed 2026-11-12
Both `GROQ_API_KEY` and `OPENROUTER_API_KEY` show CONFIGURED in the vault, and this session got two
real 200-status generations from the live public assistant. No action needed.

## 5. Spend caps — RESOLVED 2026-11-12
Confirmed resolved: the public assistant returned real 200-status generations in this session's probes,
which only happens when `spendCapPermitsAnswers()` sees at least one positive global cap. A cap is set and
working on Render right now. No action needed. (History of the problem kept below for the record.)
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
2. **Registration gate is ACTIVE** (updated 2026-11-12): `REGISTRATION_ALLOWLIST` shows as CONFIGURED
   in the vault (names only; contents not visible to this session), and a live probe this session
   confirmed a non-listed email is refused with 403 "Registration is by invitation only." Whether
   YOUR email specifically is on that list is NOT VERIFIED by this session — confirm it yourself, or
   set it: `! synora-secret-set REGISTRATION_ALLOWLIST` (comma separated), then `! synora-render-push`
   (or `--copy` + paste into the Render dashboard directly, since render-push has timed out 3x this
   run). Login itself needs no email verification (confirmed by reading `routes/auth.ts`) — only the
   password check and, if MFA is enrolled, a second factor.
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
7. ~~Two production advisories stay open on purpose (major bumps): `zod` 3->4 and `nodemailer` (>=10.0.6)~~
   **RESOLVED 2026-11-12**: both majors are already bumped in `apps/backend/package.json`
   (`zod@^4.6.7`, `nodemailer@^10.1.4`). `pnpm audit --prod` returns 0 vulnerabilities at every
   severity, genuinely (no audit-ignore config found). This note was stale; no action needed.

## 10. New findings, 2026-11-12 master run (see LAUNCH_LOG.md "launch/master-run-2026-11-11" for full evidence)

1. **The logged-in web app is very unlikely to work as deployed.** Confirmed facts: (a) no proxy
   exists anywhere in `apps/web` between the web app (`*.vercel.app`) and the API (`onrender.com`) —
   they are genuinely different sites; (b) a live GET to the API today returned a cookie
   (`Set-Cookie: X-CSRF-Token=...; Secure; SameSite=Strict`, no `Domain` attribute, checked
   attributes-only, no value) which is scoped to the API's own host and cannot be sent back on a
   cross-site request; (c) `authSession.ts` sets the real login cookies (`accessToken`,
   `refreshToken`) with the identical options (`sameSite: 'strict'`, no `Domain`, `httpOnly: true`) —
   confirmed by reading the code, NOT by an actual login (this session has no valid account and did
   not create one). Putting (a)+(b)+(c) together: a login POST should still succeed and return a 200
   with the user's data, but the session cookie will not be sent back on the NEXT request to the API
   from the web app, so the user will appear logged out again immediately. This was not tested with a
   real account — do that yourself (see the 5-step check in READY_TO_DEPLOY.md) and tell the release
   engineer what you actually see, since this conclusion, however well-supported, was not observed
   end-to-end in a browser. Fix needs a same-origin proxy or a shared parent domain — real development
   work, out of scope for this launch run. The public assistant widget is unaffected (it uses no
   cookies).
2. ~~`CORS_ORIGINS` on Render is missing one of the two live Vercel production domains~~
   **WITHDRAWN, same session**: `synora-kshreeja.vercel.app` is not a real public domain at all —
   it redirects (302) to `vercel.com/sso-api`, Vercel's own protection. The project's one actual
   domain, `synora-fawn.vercel.app`, IS in `CORS_ORIGINS` and returns the real app (HTTP 200, no
   SSO). No action needed. (See point 2a below for what this DOES mean.)
2a. **This is Vercel's own deliberate configuration, not a gap**: `ssoProtection` is on but scoped
    (`deploymentType: "all_except_custom_domains"`) to exempt the one domain actually registered
    through domain management (`fawn`) while protecting the two auto-generated aliases. That's the
    normal way to have a public production URL. The only real decision for you (see READY_TO_DEPLOY.md
    step 3) is whether you want an EXTRA layer (password protection, IP allowlist — both currently off)
    during the invite-only beta, given the cookie problem in item 1 means the login form is reachable
    but may not be very useful yet either way.
2b. **Second, independent reason chat might not work even if login somehow does**: reading
    `message.service.ts`, every chat send hands the AI response to a Redis-backed queue with no
    fallback, and its own comment says it will not throw or surface an error if that fails — the
    message would just never get a reply, silently. Depends on the same Redis-absence evidence as
    item 4 below.
3. **`/metrics` is open to the public internet, no token required.** Set `METRICS_TOKEN` on Render.
4. **Contradiction about Redis, best evidence available without Render access**: `REDIS_URL` does
   not appear anywhere in `synora-secret-set --status`'s output (neither CONFIGURED nor MISSING —
   it's just not a name the vault tool tracks at all), and this document's own section 6 (written
   independently, Nov 7/8) already recorded `QUEUE_ENABLED=false` on Render. Both point the same way:
   no Redis. But neither is a direct read of Render's actual environment — that is still NOT VERIFIED
   (dry-run timed out 3x this run). Whether an earlier `READY_TO_DEPLOY.md`'s "Upstash provisioned"
   claim was ever true is therefore UNSUPPORTED by this session's evidence, not proven false — the
   founder dashboard read in step 1 of READY_TO_DEPLOY.md settles it.
5. **PR #47 / SYNORA merge mechanism, now confirmed**: GitHub's repo activity log shows the Nov 8
   event that advanced `SYNORA` to the current commit was a direct **push** (not a merge-button
   click) by the `Synoraagi` account. PR #47 (a draft) was then marked "merged" only because its
   head commit matched the new tip. Not reverted, per standing instruction.
