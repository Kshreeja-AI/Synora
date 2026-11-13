# NEEDS_FOUNDER_UIUX

Items the UI/UX transformation session could not decide or act on because
they sit outside its scope. Names and descriptions only — no secret values.

Session start: 2026-11-12 ~23:45 local. Branch: `feature/ui-transformation-2026-11-12`
(local only, never pushed by this session).

---

## 1. Out-of-scope changes were already in the working tree when this session started

**Status: FOUND, NOT AUTHORED BY THIS SESSION, NOT TOUCHED, NOT COMMITTED.**

At session start the tree held 73 modified/deleted files plus 5 untracked
paths, all uncommitted, with modification times between 22:55 and 23:41 on
2026-11-12. Most of it is UI work. These parts are not UI and fall inside the
"never touch" list:

| File | What the uncommitted change does | Why it is out of scope |
|---|---|---|
| `apps/backend/src/routes/auth.ts` | Adds a new public endpoint `GET /api/auth/registration-status` | Named file; new backend endpoint / API contract change |
| `apps/backend/src/routes/__tests__/registrationGate.test.ts` | Test for that endpoint | Goes with the above |
| `apps/backend/src/app.ts` | Makes the trusted proxy hop count configurable through a new env name `TRUST_PROXY_HOPS` (1–5, default 1) | Backend security control; new deployment env name |
| `apps/web/next.config.js` | Adds fallback rewrites proxying `/api/*` and `/socket.io/*` from the website origin to the backend | Routing/infra change tied to the session-cookie fix |
| `apps/web/src/lib/api/client.ts` | Browser requests become same-origin (empty base URL); adds `getPublicApiUrl()` | Cookie/session handling behaviour |
| `apps/web/src/lib/api/registration.ts` (untracked) | Client for the new registration-status endpoint | Depends on the new endpoint |
| `apps/web/src/components/auth/RegistrationNotice.tsx` (untracked) | Shows open/invite-only notice on the register page | Depends on the new endpoint |
| `apps/web/src/app/auth/register/page.tsx` | Imports `RegistrationNotice` | Depends on the new endpoint |
| `apps/web/src/components/workflows/TriggerPanel.tsx` | Uses `getPublicApiUrl()` for the webhook address | Depends on the `client.ts` change |

These look like the cookie-bug fix that a separate session owns. This session
leaves all nine files exactly as found: no edits, no commits, no reverts.

**Founder decision needed:** who commits these, and on which branch. Note that
`TRUST_PROXY_HOPS` would have to be set on the backend host for the proxy
design to rate-limit per visitor rather than per website host — that is a
deployment configuration change and was not made.

A recovery snapshot of the whole pre-session diff exists outside the repo
(session scratchpad, `pre-session.patch` plus copies of the untracked files).
It is temporary storage, not a backup.

## 2. The colour palette in `tokens.css` had already been changed

**Status: FOUND, NOT AUTHORED BY THIS SESSION.**

The brief says not to overwrite the palette in
`packages/design-system/src/styles/tokens.css`. Against the last commit, the
uncommitted file already replaces the violet accent (`252 92% 68%`) with a
blue one (`214 92% 66%`), shifts neutrals from grey to navy, makes
`--primary-foreground` and `--success-foreground` dark in the dark theme, and
adds `--shadow-*` tokens. This session treats the file as found as the
palette of record and will only add tokens, never change existing values.

**Founder decision needed:** confirm the blue/navy palette is the intended
one. If violet should be restored, say so before the UI work is committed —
contrast choices made in this session assume the palette as found.

## 3. `animations.ts` and its hooks were already deleted

**Status: FOUND.** `apps/web/src/lib/animations.ts`,
`hooks/useMotionPreference.ts`, `hooks/useScrollReveal.ts` and
`tests/animations.test.ts` are staged for deletion. The brief says to prefer
`animations.ts` for motion; it no longer exists in the tree. Nothing imports
it or `framer-motion` (0 imports). Motion today is Tailwind keyframes in the
shared preset plus an untracked `components/marketing/Reveal.tsx`.

`framer-motion` is still declared in `apps/web/package.json` and is unused.
Removing a dependency changes the lockfile; left for a founder call.

## 4. The "570 hardcoded colours" figure does not match the tree

**Status: MEASURED, see final report for the reconciled numbers.** The audit
script (`tmp-scripts/uiux-audit.sh`) counts 171 instances in 18 non-test
files in the working tree as found. The gap is partly work already done
before this session and partly a different counting rule; this session
reports its own measured numbers and does not claim 570.

## 6. Billing, usage, studio media and invite pages can never load data

**Status: FOUND BY READING CODE, NOT FIXED (session/token handling is out of
scope), NOT VERIFIED against a running backend.**

`apps/web/src/lib/auth/token-storage.ts` was reduced to stubs when tokens
moved to HttpOnly cookies: `getAccessToken()` now always returns `null`.
Several callers still use it as an "is signed in" gate:

| Caller | Effect of the gate always being false |
|---|---|
| `hooks/useBilling.ts` (6 queries) | Plans, subscription, credits, ledger, usage and invoices are never requested. `/dashboard/billing`, `/dashboard/settings/billing` and `/dashboard/usage` always show their empty state. |
| `hooks/useMedia.ts` (4 queries) | Studio media lists/details are never requested. |
| `app/invite/[token]/page.tsx` | Always treats the visitor as signed out, even when signed in. |

The unit tests for these pages mock `getAccessToken` to return a token, so
they pass while the real pages cannot work.

Separately, both billing pages read the workspace id from `useParams().id`,
but their routes have no `[id]` segment, so the id is always empty. That
part is plain UI wiring and this session fixes it (uses the current
workspace, as the knowledge pages do). The token gate is left alone.

**Founder decision needed:** have the session that owns the cookie/auth fix
remove these gates (the queries can simply run; a 401 already redirects to
login through the app shell), or authorise this session to do it.

## 5. No local backend, database or env files

**Status: ENVIRONMENT.** Nothing listens on 3000/3001/5432 and there are no
`.env.local` files (only `.env.example`, which this session does not read).
Pages behind login cannot be exercised against a real API here. Visual QA of
authenticated pages uses network stubs in the browser; that shows layout and
states, not real data flow, and is reported as such.
