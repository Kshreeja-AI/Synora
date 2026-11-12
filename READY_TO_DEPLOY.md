# Synora Pre-Deployment Status: READY_TO_DEPLOY

Rewritten 2026-11-12 from the `launch/master-run-2026-11-11` session's own
evidence only (see `LAUNCH_LOG.md` for every command and result this is
based on). The previous version of this file made claims ("Upstash Redis
provisioned", "Working Tree: Clean, fully synced") that this session could
not confirm and in one case (Redis) found to be false. Treat that version as
superseded.

Status words used below: IMPLEMENTED, TESTED, LOCALLY VERIFIED, INTEGRATION
VERIFIED, PRODUCTION VERIFIED, NOT VERIFIED, BLOCKED.

## A. VERDICT: READY FOR FOUNDER STEPS

The API backend (`synora-api` on Render) is live, healthy, and its public,
unauthenticated surface (`/api/public/assistant`) is PRODUCTION VERIFIED
end-to-end today, including real AI generations grounded in the published
facts. **The authenticated web app (login, dashboard) is BLOCKED** by a
confirmed cross-site cookie problem described below — this is not a guess,
it was checked in code and in the live CORS behaviour this session. Nothing
about this run makes the logged-in product usable yet; it makes the
public-facing assistant demonstrably usable and tells you exactly what
stands between here and a working login.

Branch: `launch/master-run-2026-11-11` (local commits only, not pushed —
push is a denied command for this session). LAUNCH_COMMIT (already on
`origin/SYNORA`, CI-green, and the one commit both Render and Vercel are
configured against) = **7685485**.

## B. FOUNDER STEPS

Numbered in the order to do them. Steps 1–2 are read-only reconnaissance;
steps 3–5 are small config changes; step 6 is a thing to deliberately NOT do
yet.

### 1. Read the live Render deployment state (read-only)
- **WHAT:** Confirm the service's branch, autoDeploy setting, the live
  deploy's commit, and which env var NAMES exist (not values).
- **WHY:** This session's own attempts to read this (API dry-run, 3 tries;
  Render MCP deliberately not used per your prior instruction not to retry
  it) all came back NOT VERIFIED. The dashboard is the fallback.
- **WHERE:** Render dashboard → workspace `tea-dbgc87nb9u1s73csbdk0` →
  service `synora-api` (`srv-dbgcbs8u01pc73ao3jkg`) → Events/Deploys tab,
  then Environment tab.
- **EXACTLY:** Open the service, look at the latest successful deploy's
  commit SHA, and note the Environment tab's variable names.
- **EXPECTED:** commit = `7685485`; branch = `SYNORA`; autoDeploy = `no`
  (this was true as of Nov 8 — confirm it is still true).
- **WHAT NOT TO DO:** Do not click "Manual Deploy", "Clear build cache &
  deploy", or change any environment variable yet — that is steps 3–4, and
  only after you've seen what's there.

### 2. Run the vault-to-Render sync dry run yourself
- **WHAT:** `synora-render-push --dry-run`.
- **WHY:** This session ran it three times (twice in an earlier session,
  once in this one) and it timed out every time; per your instruction it
  was not debugged. It is the only tool (besides the dashboard) that shows
  which secret names are out of sync between your local vault and Render.
- **WHERE:** Your own terminal, in this repo.
- **EXACTLY:** `! synora-render-push --dry-run`
- **EXPECTED:** A list of variable NAMES that differ, no values printed.
- **WHAT NOT TO DO:** Do not run it without `--dry-run`. If it times out
  for you too, that's useful information on its own — don't debug it
  mid-launch, just note it and use the dashboard instead.

### 3. Add the missing Vercel domain to CORS_ORIGINS
- **WHAT:** Add `https://synora-kshreeja.vercel.app` to the API's
  `CORS_ORIGINS` list on Render.
- **WHY:** This session sent live CORS preflights to
  `/api/auth/login` from both of the project's production domains. The API
  currently answers with `access-control-allow-origin` for
  `synora-fawn.vercel.app` and for the portfolio's own origin, but **not**
  for `synora-kshreeja.vercel.app` — so the app is unreachable by browsers
  from that domain regardless of anything else in this document.
- **WHERE:** Render dashboard → `synora-api` → Environment →
  `CORS_ORIGINS`.
- **EXACTLY:** Edit the value to a comma-separated list containing both
  domains you intend to serve from, e.g. append
  `,https://synora-kshreeja.vercel.app` to whatever is already there.
- **EXPECTED:** A fresh preflight from that origin then echoes back an
  `access-control-allow-origin` header matching it.
- **WHAT NOT TO DO:** Do not add `*` (wildcard) or any `localhost` entry —
  the live config correctly has neither right now, and adding either would
  reopen a finding this session confirmed is currently closed.

### 4. Close the open /metrics endpoint
- **WHAT:** Set `METRICS_TOKEN` to a random value.
- **WHY:** This session confirmed `/metrics` returns HTTP 200 with no
  authentication at all — 21.5 KB of internal route/queue data readable by
  anyone on the internet.
- **WHERE:** Your vault, then Render.
- **EXACTLY:** `! synora-secret-set METRICS_TOKEN --gen` then
  `! synora-render-push` (or set it directly on Render if the push command
  is still timing out).
- **EXPECTED:** `/metrics` then returns HTTP 401 without a bearer token,
  and 200 with `Authorization: Bearer <that token>`.
- **WHAT NOT TO DO:** Don't paste the token anywhere public. Any scraper
  (Prometheus, etc.) needs it added as a bearer token in its own config.

### 5. Confirm your own email is actually on REGISTRATION_ALLOWLIST
- **WHAT:** Check (and if needed, set) the allowlist to include the email
  you'll register with.
- **WHY:** This session confirmed the invite gate is live and working — a
  throwaway, non-listed email was refused with 403 — but cannot see the
  list's contents (names only, never values, per the secrets rules).
- **WHERE:** Your local vault.
- **EXACTLY:** `! synora-secret-set REGISTRATION_ALLOWLIST` (comma
  separated if more than one), then `! synora-render-push`.
- **EXPECTED:** Registering with that email now reaches the
  "already registered / create the account" path instead of 403 — but see
  step 6 before you try it from the actual website.
- **WHAT NOT TO DO:** Don't add anyone else's email yet; this is a closed
  beta by design.

### 6. Do NOT attempt to log in to the web app yet — keep Vercel protection ON
- **WHAT:** Leave Vercel's Deployment Protection switched on, and don't
  announce or try the hosted web app as something that works end-to-end.
- **WHY:** This session confirmed, by reading the code (not guessing) and
  by confirming no proxy exists anywhere in `apps/web`, that the web app
  (`*.vercel.app`) and the API (`onrender.com`) are genuinely different
  sites with no same-origin bridge between them. The session's/CSRF cookies
  are set `SameSite=Strict`. A browser will not send or persist those
  cookies across that boundary. **Concretely: even once steps 1–5 are done,
  logging in through the actual website will not keep you logged in, and
  every mutating request outside `/api/auth` will come back 403.** This is
  a structural problem, not a missing config value — no env var fixes it.
- **WHERE:** n/a — this is something to hold off on, not a place to click.
- **EXACTLY:** Leave Settings → Deployment Protection as it is.
- **EXPECTED:** The public assistant widget (if embedded on the portfolio
  site) keeps working regardless — it never uses cookies. The dashboard
  login will not.
- **WHAT NOT TO DO:** Don't turn off Deployment Protection, and don't tell
  anyone else the product is ready to use for real accounts yet.

**PROPOSAL (too large for a launch-run code fix, not something this
session did):** the cross-site cookie problem needs either (a) a same-origin
proxy — a Next.js rewrite on the web app that forwards `/api/*` to the
Render API, so the browser only ever talks to one origin — or (b) both web
and API served from the same parent domain with cookies scoped to it. Either
is real development work for a future session, not a config toggle.

## C. ROLLBACK

- **Render:** This run never triggered a Render deploy (never ran
  `synora-render-push` without `--dry-run`, and Render dashboard access was
  deliberately not retried). Whatever is live on Render right now predates
  this run and was not changed by it. Before you do anything in step 1 that
  could change state, note the current live deploy's id from the dashboard
  — that becomes your rollback target if a later action misbehaves. The
  Nov 8 log recorded `branch=SYNORA`, `autoDeploy=no` as the baseline.
- **Vercel:** Current and only production deployment is
  `dpl_CpHU6KXwHbutskavnDdU9dw4BmeW`, built from branch `SYNORA` at commit
  `7685485`. There is no earlier Vercel production deployment to roll back
  to — this is the first one.

## D. NOT VERIFIED

- Render: live deploy's exact commit, autoDeploy setting, branch, deploy
  history, and full environment variable list (three dry-run timeouts;
  Render MCP deliberately not used this run per standing instruction).
- `FRONTEND_URL` / `BACKEND_URL` exact values (confirmed non-loopback only,
  because the boot-time gate would otherwise have refused to start).
- `MAIL_TRANSPORT` and SMTP configuration (all SMTP_* vault entries absent;
  presumed still `console`, not independently confirmed).
- Exact contents of `REGISTRATION_ALLOWLIST` and `CORS_ORIGINS` beyond what
  this session's behavioural probes showed.
- Vercel Deployment Protection's current on/off state (not re-probed this
  session; carried over from an earlier claim).
- Whether the CD Pipeline failure (legacy GHCR image-tag path, see
  LAUNCH_LOG.md) has any bearing on Render's own build — classified as
  unrelated to Render, but Render's own build of `LAUNCH_COMMIT` was never
  directly observed.

## RISKS

1. **`/metrics` is open to the public internet** with no token — see step 4.
2. **The logged-in web app does not work as currently deployed** — the
   cross-site cookie problem (section B, step 6) is confirmed, not
   suspected, and is the single biggest risk in this document.
3. **`CORS_ORIGINS` is missing one of the two live Vercel production
   domains** (`synora-kshreeja.vercel.app`) — see step 3.
4. **The October `assertNoLocalhostInProduction` loopback-bypass bug is
   still present in code** (a CORS list with one real domain and one
   loopback entry would pass the gate). It is dormant today — the live
   list has no loopback entry — but a future config change could silently
   reintroduce the exact failure mode that gate was built to catch.
5. **The legacy CD Pipeline (GHCR/VPS path) is broken** at Docker image-tag
   validation (mixed-case repo name) and has been for a while. It does not
   affect the Render deployment path, but it does mean CI shows a permanent
   red CD run for every push to SYNORA, which could mask a real failure in
   the same run in the future.
