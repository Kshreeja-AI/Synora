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
facts. **The authenticated web app (login, dashboard) is very likely
BLOCKED** by a cross-site cookie problem — strongly supported by this
session's evidence (no proxy in the code, live cookie attributes checked,
identical code pattern for the real auth cookies) but NOT confirmed with an
actual login, because this session held no valid account and was told to
register nobody. Treat it as "almost certainly broken, verify in one real
login attempt" rather than "proven broken." Nothing about this run makes the
logged-in product usable yet; it makes the public-facing assistant
demonstrably usable, narrows the login problem to one specific and testable
cause, and tells you exactly what to check next (step 7).

Branch: `launch/master-run-2026-11-11` (local commits only, not pushed —
push is a denied command for this session). LAUNCH_COMMIT (already on
`origin/SYNORA`, CI-green, and the one commit both Render and Vercel are
configured against) = **7685485**.

## B. FOUNDER STEPS

Numbered in the order to do them. Steps 1–2 are read-only reconnaissance;
step 3 is a non-action (an earlier finding withdrawn, kept for the record);
steps 4–5 are small config changes; step 6 makes sure they actually took
effect; step 7 is the one real test that actually answers whether login
works.

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
  (this was true as of Nov 8 — confirm it is still true). **Write down the
  current live deploy's id** — that's your rollback target for everything
  below.
- **If the live commit is NOT `7685485`:** don't chase that down mid-launch
  — just note it, do steps 2–6 anyway, and use "Manual Deploy → Deploy
  latest commit" (branch SYNORA) once at the end, in step 6, to bring it
  current.
- **WHAT NOT TO DO:** Do not click "Manual Deploy", "Clear build cache &
  deploy", or change any environment variable yet — that is steps 4–5, and
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

### 3. No action needed — CORS and the public domain are already correct
- This session initially flagged `synora-kshreeja.vercel.app` as "missing"
  from `CORS_ORIGINS`, then checked further and found that domain is
  **not a real public URL at all** — it redirects (HTTP 302) to
  `vercel.com/sso-api`, Vercel's own Deployment Protection/SSO wall. The
  project's one actual attached domain (per `list_project_domains`) is
  `synora-fawn.vercel.app`, which returns the real app (HTTP 200, correct
  CSP pointing at the Render API) with **no** SSO wall at all. `CORS_ORIGINS`
  already correctly allows `fawn` and excludes the SSO-gated alias. Nothing
  to change here. (Earlier internal drafts of this document said otherwise
  — that was corrected before this version was committed.)
- **Consequence worth knowing:** because `synora-fawn.vercel.app` has no
  Vercel Authentication wall, the real login/dashboard page is already
  publicly loadable by anyone today — see step 7.

### 4. Close the open /metrics endpoint
- **WHAT:** Set `METRICS_TOKEN` to a random value.
- **WHY:** This session confirmed `/metrics` returns HTTP 200 with no
  authentication at all — 21.5 KB of internal route/queue data readable by
  anyone on the internet.
- **WHERE:** Your vault, then Render.
- **EXACTLY:** `! synora-secret-set --gen METRICS_TOKEN` then
  `! synora-render-push` — but that push command has timed out three times
  across this run's sessions and was not debugged (per standing
  instruction not to retry/debug it). If it times out for you too, use
  `! synora-secret-set --copy METRICS_TOKEN` to copy the generated value to
  your clipboard, then paste it directly into Render dashboard → synora-api
  → Environment → add `METRICS_TOKEN`.
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
  step 7 before you try it from the actual website.
- **WHAT NOT TO DO:** Don't add anyone else's email yet; this is a closed
  beta by design.

### 6. Make sure the changes above actually take effect
- **WHAT:** After steps 4–5, make sure Render has actually restarted the
  service with the new `METRICS_TOKEN` and (if you changed it)
  `REGISTRATION_ALLOWLIST` values.
- **WHY:** `autoDeploy=no` governs git-push deploys only. Saving an
  environment variable in the Render dashboard usually triggers Render to
  redeploy on its own — but this session has no way to confirm that
  behaviour (Render access was deliberately not used). Don't assume it
  happened.
- **WHERE:** Render dashboard → synora-api.
- **EXACTLY:** After saving env changes, check the Events/Deploys tab for a
  new deploy. If none started within a minute or two, click
  "Manual Deploy" → "Deploy latest commit" yourself. If step 1 found the
  live commit was NOT `7685485`, this is also where that gets fixed.
- **EXPECTED:** A new deploy appears, finishes, and `curl .../metrics`
  afterward returns 401 without a token (confirms `METRICS_TOKEN` is live).
- **WHAT NOT TO DO:** Don't deploy a different commit than `7685485` unless
  you've deliberately decided to.

### 7. Try logging in yourself, and expect it not to stick — this is the real test
- **WHAT:** After steps 1–5, open the live web app and go through
  registration/login once, watching specifically for whether you stay
  logged in.
- **WHY:** This session found strong evidence of a problem but — correctly
  — stopped short of creating or logging into a real account. Here's
  exactly what was and wasn't checked, so you know how much to trust this:
  - VERIFIED: there is no same-origin proxy anywhere in `apps/web` (no
    `rewrites()`, no `vercel.json`, no proxying API route) between the web
    app and the Render API — they are genuinely different sites.
  - VERIFIED LIVE: a GET to the API today returned a cookie
    (`Set-Cookie: X-CSRF-Token=...; Secure; SameSite=Strict`, attributes
    only, no value read or logged) with no `Domain` attribute — scoped to
    the API's own host, not shareable with the web app's domain.
  - VERIFIED BY CODE, not by an actual login: `authSession.ts` sets the
    real `accessToken`/`refreshToken` cookies with the identical
    `sameSite: 'strict'`, no-`Domain`, `httpOnly: true` pattern.
  - NOT VERIFIED: an actual login in a browser. Putting the above
    together predicts the login response will succeed (200, user data
    back) but the cookie won't be sent on the NEXT request to the API, so
    the app will look logged-out again right away — but this session
    never confirmed that in a real browser, because doing so needs a real
    account and this session was told to register nobody.
  - **Also newly relevant:** `synora-fawn.vercel.app` (the real production
    domain) has no Vercel Authentication wall at all — the login page is
    already visible to anyone who loads the URL today.
- **WHERE:** `https://synora-fawn.vercel.app` in a real browser.
- **EXACTLY:** 1) Open the URL. 2) Register with your allowlisted email
  (step 5). 3) Log in. 4) Send one chat message or open any page that
  needs auth. 5) Refresh the page or open a new tab to the same URL and
  check whether you're still logged in.
- **EXPECTED (prediction, not yet observed):** Steps 1–3 likely succeed.
  Step 4 or the refresh in step 5 likely shows you logged out again, or a
  403 on the first real mutation. If instead everything works, this
  session's reasoning was wrong somewhere — tell the release engineer
  either way, because that's new information this session didn't have.
- **WHAT NOT TO DO:** Don't conclude the product is broken OR working from
  this document alone — steps 1–5 plus this manual check is what actually
  tells you.

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
- ~~Vercel Deployment Protection's current on/off state~~ **NOW VERIFIED**:
  `synora-fawn.vercel.app` (the real public domain) has NO protection —
  HTTP 200, real app HTML, no SSO redirect. The earlier claimed fact that
  "Vercel Authentication is ON" does not hold for the domain that matters.
- Whether the CD Pipeline failure (legacy GHCR image-tag path, see
  LAUNCH_LOG.md) has any bearing on Render's own build — classified as
  unrelated to Render, but Render's own build of `LAUNCH_COMMIT` was never
  directly observed.
- Render log contents from the live service (error-line counts,
  secret-pattern-match counts) — needs Render access this run didn't use.
- The secrets registry proper (`apps/backend/src/secrets/registry.ts`) —
  this session's own permission settings deny `Read(**/secrets/**)`, which
  also covers this source file (not just the vault). The Phase 3 table was
  built from `envCatalog.ts`, `productionGates.ts`, `configLoader.ts`, and
  `synora-secret-set --status` instead. Worth noting: that deny pattern is
  broader than probably intended (it blocks reading the registry's *source
  code*, not just secret *values*) — flagging it here rather than routing
  around it.
- Which specific provider in the free-tier chain (groq / cloudflare /
  openrouter) actually answered either of this session's two live
  generations — the route doesn't expose that, and it wasn't logged.
- Whether `CORS_ORIGINS` contains any loopback origin other than
  `localhost:3000` (only that one was probed).
- **One instruction, if lifted, would close most of the Render-side items
  above in minutes**: this run deliberately did not retry the Render MCP
  (per the founder's-assistant note) even though it reportedly connected
  successfully this session. A future run allowed to use it read-only
  could confirm the live commit, branch, autoDeploy, env names, and recent
  logs directly, instead of relying on the dashboard or on behavioural
  inference the way this document does.

## RISKS

1. **`/metrics` is open to the public internet** with no token — see step 4.
2. **The real public web app (`synora-fawn.vercel.app`) has no Vercel
   Authentication wall and is very unlikely to keep anyone logged in.**
   Verified today: the domain serves the real app with HTTP 200 (no SSO
   gate); separately, the API's cookies are `SameSite=Strict` with no
   `Domain` attribute, and no proxy exists anywhere to make the two sites
   one origin. Net effect: anyone can load the login page right now, and a
   login attempt is expected to not persist a session — see step 7's
   5-step manual check for what to actually observe. This is the single
   biggest risk in this document.
3. **The October `assertNoLocalhostInProduction` loopback-bypass bug is
   still present in code** (a CORS list with one real domain and one
   loopback entry would pass the gate). It is dormant today — the live
   list has no loopback entry — but a future config change could silently
   reintroduce the exact failure mode that gate was built to catch.
4. **The legacy CD Pipeline (GHCR/VPS path) is broken** at Docker image-tag
   validation (mixed-case repo name) and has been for a while. It does not
   affect the Render deployment path, but it does mean CI shows a permanent
   red CD run for every push to SYNORA, which could mask a real failure in
   the same run in the future.
