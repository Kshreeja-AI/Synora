# Synora Pre-Deployment Status: READY_TO_DEPLOY

Rewritten 2026-11-12 from the `launch/master-run-2026-11-11` session's own
evidence only (see `LAUNCH_LOG.md` for every command and result this is
based on, including a correction pass this same session caught its own
overstated findings on — see LAUNCH_LOG.md's "Correction pass" entry). The
previous version of this file made claims ("Upstash Redis provisioned",
"Working Tree: Clean, fully synced") that this session could not confirm
and has no independent evidence for either way (Render access was not
used). Treat that version as superseded by this one, not necessarily wrong.

Status words used below: IMPLEMENTED, TESTED, LOCALLY VERIFIED, INTEGRATION
VERIFIED, PRODUCTION VERIFIED, NOT VERIFIED, BLOCKED.

## A. VERDICT: READY FOR FOUNDER STEPS — public assistant LIVE; logged-in web app LIKELY BLOCKED, unverified

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
  commit SHA, and in the Environment tab specifically check for these
  NAMES (presence only, don't read values here): `REGISTRATION_ALLOWLIST`,
  `REGISTRATION_MODE`, `QUEUE_ENABLED`, `REDIS_URL`, `METRICS_TOKEN`,
  `MAIL_TRANSPORT`, `CORS_ORIGINS`, `AI_GLOBAL_MAX_COST_PER_DAY_CENTS`,
  `AI_GLOBAL_MAX_TOKENS_PER_DAY`. This one read settles several open
  "NOT VERIFIED" items at once: whether Redis/the queue is really absent,
  whether `METRICS_TOKEN` already exists, and whether the allowlist is
  the name the vault calls it.
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
  **This result gates steps 4–6**: only run the real (non-`--dry-run`)
  push later if this list shows only the names you expect to change and
  nothing else surprising.
- **WHAT NOT TO DO:** Do not run it without `--dry-run`. If it times out
  for you too, that's useful information on its own — don't debug it
  mid-launch, just note it and use the dashboard directly for steps 4–6
  instead of the vault-push path.

### 3. Your assumption that Vercel Authentication protects the live site is WRONG — decide what to do
- **WHAT:** The master prompt behind this run assumed "Vercel Authentication
  is ON, so the public gets a Vercel login page" and said to leave it that
  way until login is verified. Read directly from Vercel (`get_project`),
  that assumption does not hold for the domain that is actually live.
  Decide whether to fix that now or accept it for the beta.
- **WHY:** `ssoProtection: {enabled: true, deploymentType:
  "all_except_custom_domains"}`. In plain terms: SSO protection is on, but
  it is configured to skip any domain registered through Vercel's domain
  management — and `synora-fawn.vercel.app` (the project's one real
  production domain, the one `CORS_ORIGINS` allows and the one with the
  correct CSP) is exactly such a domain. So `fawn` has had NO protection
  wall this whole time; only the two auto-generated aliases
  (`synora-kshreeja.vercel.app` and the git-branch alias) redirect to
  Vercel's SSO. This session found no record of anyone choosing that
  scope on purpose — it may be a default nobody reviewed. Either way, the
  practical result right now: anyone can load the real login/app page at
  `fawn` today (they can't get past the invite gate to register without
  an allowlisted email, and — see step 7 — login may not work yet anyway,
  but the page itself is not hidden).
- **WHERE:** Vercel dashboard → synora project → Settings → Deployment
  Protection.
- **EXACTLY:** If you want it the way you originally assumed — protected
  until login works — change the scope so it also covers `fawn` (e.g. set
  it to protect all deployments, not just "all except custom domains"), or
  add password protection / a trusted-IP allowlist specifically. If you'd
  rather the production URL just be public (common for a real product),
  leave it as-is and update your own mental model instead. (Whether your
  Vercel plan includes password protection / IP allowlisting is NOT
  VERIFIED — check before assuming it's available.)
- **EXPECTED:** Whichever you choose, re-check with
  `curl -I https://synora-fawn.vercel.app/` afterward — a 200 means still
  public, a redirect to `vercel.com/sso-api` means now protected.
- **WHAT NOT TO DO:** Don't assume this is already handled because an
  earlier document said "Vercel Authentication is ON" — for the domain
  people will actually visit, it is not.

### 4. Close the open /metrics endpoint
- **WHAT:** Set `METRICS_TOKEN` to a random value.
- **WHY:** This session confirmed `/metrics` returns HTTP 200 with no
  authentication at all — 21.5 KB of internal route/queue data readable by
  anyone on the internet.
- **WHERE:** Your vault, then Render — OR skip the vault entirely and just
  type a random string straight into the Render dashboard.
- **EXACTLY, vault path (only if step 2's dry-run came back clean — see
  its WHAT NOT TO DO):** `! synora-secret-set --gen METRICS_TOKEN`, then
  **do not push yet** — queue this change and do step 5's change too,
  then push both together once (see step 6). If `synora-render-push`
  keeps timing out (it has, three times, across this run), use
  `! synora-secret-set --copy METRICS_TOKEN` to copy the value to your
  clipboard instead. **Simpler path:** skip the vault, open Render
  dashboard → synora-api → Environment → add `METRICS_TOKEN` and paste in
  any long random string you generate yourself (e.g. your password
  manager) — the vault is a convenience, not a requirement.
- **EXPECTED:** `/metrics` then returns HTTP 401 without a bearer token,
  and 200 with `Authorization: Bearer <that token>`.
- **WHAT NOT TO DO:** Don't paste the token anywhere public. Any scraper
  (Prometheus, etc.) needs it added as a bearer token in its own config.

### 5. Confirm your own email is actually on REGISTRATION_ALLOWLIST
- **WHAT:** Check (and if needed, set) the allowlist to include the email
  you'll register with.
- **WHY:** This session confirmed the invite gate is live and working — a
  throwaway, non-listed email was refused with 403 — but cannot see the
  list's contents (names only, never values, per the secrets rules), and
  step 1's dashboard read tells you whether the name even exists there.
- **WHERE:** Your local vault, or directly in the Render dashboard.
- **EXACTLY:** `! synora-secret-set REGISTRATION_ALLOWLIST` (comma
  separated if more than one) — **don't push yet**, see step 6. Or set it
  directly on Render if you'd rather skip the vault.
- **EXPECTED:** Registering with that email now reaches the
  "already registered / create the account" path instead of 403 — but see
  step 7 before you try it from the actual website.
- **WHAT NOT TO DO:** Don't add anyone else's email yet; this is a closed
  beta by design. Also: `/auth/register` is rate-limited to 3 attempts per
  hour per IP, and this session already used 1 of those 3 today running
  its negative test (a refused `@example.invalid` address) — possibly from
  the same IP you'll register from. If your own registration gets rate-
  limited, that's why; wait rather than retrying repeatedly.

### 6. Push both changes together, once, then confirm they took effect
- **WHAT:** Apply steps 4 and 5's changes to Render in a single push, then
  confirm Render actually restarted with them.
- **WHY:** `synora-render-push` syncs the WHOLE vault to Render, one
  variable at a time — a diff nobody has reviewed this run, so it's safer
  to run it once with both changes queued than to run it twice. Separately,
  `autoDeploy=no` governs git-push deploys only; whether saving an env var
  in the dashboard auto-restarts the service was not confirmed this
  session — don't assume it happened.
- **WHERE:** Your terminal, then Render dashboard → synora-api.
- **EXACTLY:** `! synora-render-push` (only after step 2's `--dry-run`
  came back showing nothing unexpected — if it didn't, or you skipped the
  vault entirely in steps 4–5, set both values directly on Render instead
  and skip this command). If the dashboard offers to deploy immediately
  when you save, you can let it, or save without deploying and trigger
  one deploy afterward — either way, deploy ONCE after both changes are
  in, not once per change. If nothing redeploys within a minute or two,
  click "Manual Deploy" → "Deploy latest commit" yourself. If step 1 found
  the live commit was NOT `7685485`, this is also where that gets fixed.
- **EXPECTED:** A new deploy appears, finishes, and `curl .../metrics`
  afterward returns 401 without a token.
- **WHAT NOT TO DO:** Don't run `synora-render-push` without having seen
  a clean `--dry-run` first. Don't deploy a different commit than
  `7685485` unless you've deliberately decided to.

### 7. Try logging in yourself, and expect it not to stick — this is the real test
- **WHAT:** After steps 1–6, open the live web app and go through
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
  - **Second, independent reason step 4 below might fail even if login
    somehow does work**, traced through two files: `message.service.ts`'s
    `enqueueGeneration()` always hands the AI response off to a
    Redis-backed job queue with no synchronous fallback, and its own code
    comment says it will not throw or surface an error if that fails;
    separately, `index.ts` only starts the worker that would process that
    job `if (config.queue.enabled)` — with `QUEUE_ENABLED=false` (several
    signals point to this being set on Render; not a direct Render read),
    no worker starts at all, so even a job that enqueues successfully is
    never picked up. Either way: chat may accept your message and simply
    never answer, with nothing in the UI telling you why.
- **WHERE:** `https://synora-fawn.vercel.app` in a real browser — this is
  the one real public domain (see step 3); no SSO wall stands between you
  and the actual app. **Do not test on `synora-kshreeja.vercel.app`**: if
  you're logged into Vercel in that browser, you'll pass its SSO check and
  reach the app, but every API call will then fail CORS (that domain is
  not in `CORS_ORIGINS`) — a different failure that would wrongly look
  like confirmation of this document's prediction.
- **EXACTLY:** 1) Open the URL. 2) Register with your allowlisted email
  (step 5). 3) Log in. 4) Send one chat message or open any page that
  needs auth. 5) Refresh the page or open a new tab to the same URL and
  check whether you're still logged in. 6) Explicitly log out and confirm
  you're actually logged out (a cookie problem can make this ambiguous
  too — check that protected pages redirect you to login afterward).
- **EXPECTED (prediction, not yet observed):** Steps 1–3 likely succeed.
  Step 4 may accept the message but never show a reply (Redis/queue
  theory above) even if the session somehow survives. The refresh in
  step 5 likely shows you logged out again, or a 403 on the first real
  mutation. If instead everything works, this session's reasoning was
  wrong somewhere — tell the release engineer either way, because that's
  new information this session didn't have.
- **WHAT NOT TO DO:** Don't conclude the product is broken OR working from
  this document alone — steps 1–6 plus this manual check is what actually
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
- Vercel Deployment Protection is now VERIFIED, not NOT VERIFIED — see
  step 3 for the full picture (`ssoProtection` on, scoped to exempt the
  real domain).
- Whether authenticated chat message generation works at all without
  Redis — `message.service.ts` was read (see step 7), but no actual
  message was sent through a logged-in session.
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
2. **Login is very unlikely to persist a session, and chat may silently
   never reply even if it does.** Two independent, code-level findings:
   (a) the API's auth cookies are `SameSite=Strict` with no `Domain`
   attribute, and no proxy exists anywhere to make the web app and API one
   origin — a login POST is predicted to succeed but the cookie won't come
   back on the next request; (b) sending a chat message always hands the
   response off to a Redis-backed queue with no fallback and no error
   surfaced if that fails. Neither was confirmed with an actual logged-in
   session (see step 7's 6-step manual check). This is the single biggest
   risk in this document — the core authenticated flow is unlikely to
   work end-to-end. (Whether the public domain should be reachable at
   all right now is a separate question — see step 3.)
3. **The portfolio widget's origin can make cookie-bearing requests to the
   full authenticated API, not just the public assistant endpoint** — a
   live preflight to `/api/auth/login` from `keshav-kumar-singh.vercel.app`
   returned an allow-origin header on the app-wide, credentialed CORS
   config, in addition to being correctly allowed on the public assistant
   route's own separate, non-credentialed CORS. Not a demonstrated
   exploit, just broader scope than the portfolio widget needs — worth
   tightening `CORS_ORIGINS` to exclude it if the portfolio only ever
   calls `/api/public/assistant`.
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
