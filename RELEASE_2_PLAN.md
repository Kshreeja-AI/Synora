# Release 2 Plan — Production Hardening

**Status:** Not started
**Depends on:** Release 1 (complete — see `RELEASE_ROADMAP.md`, `RELEASE_1_VERIFICATION_REPORT.md`)
**Basis:** `RELEASE_ROADMAP.md`'s existing R2 task register (R2-a through R2-h), organized here into objectives, priorities, milestones, and sequencing.

---

## 1. Objective

Release 1 proved the product can launch and serve real customers safely on
a single instance. Release 2 makes that safe at the next tier of maturity:
mandatory-capable auth hardening (MFA, CSRF), horizontal scalability
(Redis-backed shared state), full media generation (not just text/code),
automated deployment and recovery, and the observability to know when
something breaks before a customer reports it.

Release 2 does **not** re-litigate Release 1's founder-overridable
decisions unless told to — MFA/CSRF were deliberately deferred (not
skipped) because R1 uses bearer tokens, which aren't CSRF-vulnerable, and
because mandatory MFA is not a launch blocker for a first customer cohort.
Both are already built on `recover/mfa` and `recover/csrf`; this release's
job is landing them, not designing them from scratch.

---

## 2. Priorities (ranked, with rationale)

### P1 — Security hardening (do first)
**R2-a (MFA reintegration), R2-b (CSRF + cookie auth).** These are the two
items explicitly named as founder-overridable in the R1 roadmap — the
longer they stay deferred, the more the codebase drifts from the
`recover/*` branches they need to rebase onto, and every week without them
is a week of real exposure to account-takeover-via-credential-reuse (no
MFA) once the customer base is large enough to be a real target. Landing
them early, while the rebase is still cheap, is the highest-leverage use
of Release 2 time.

### P2 — Scale readiness (do once P1 lands, before real multi-instance traffic)
**R2-c (Redis-backed shared state).** R1's account-lockout and rate-limit
state is correctly DB-backed for a single instance; the moment the app
runs on ≥2 instances (which CSRF+cookie-auth's session model and any real
production traffic growth will eventually require), that state needs to
be shared. This also unblocks R2-d's job queue, which needs Redis anyway.

### P3 — Product completeness (media generation)
**R2-d (async job queue + image/video/audio generation).** The single
largest deferred product feature from Release 1 — R1 shipped text/code
generation only because it's fast enough to serve synchronously; media
generation is a real, expected capability of an "AI platform for
creators" and depends on R2-c's Redis plus R3's object storage (pull the
minimum object-storage slice forward into R2 rather than waiting for all
of Release 3 — see Milestone 4 below).

### P4 — Operational maturity (do in parallel with P2/P3, lower risk each)
**R2-e (CD pipeline), R2-f (metrics/alerting/tracing), R2-g (automated
backup + rehearsed restore).** None of these block new functionality —
R1 already deploys manually and relies on a managed Postgres provider's
own backup/PITR — but all three reduce operational risk and toil as usage
grows. Good candidates to parallelize with a second engineer, or to
interleave between P1–P3 milestones.

### P5 — Quality closeout
**R2-h (remaining security Highs + full E2E/security regression suite in
CI).** Cheapest items already fold into R1's own work; what's left is
genuinely lower-urgency hardening, best done last so the E2E suite
exercises the *final* R2 feature set (MFA, CSRF, media) rather than
needing rework mid-release.

---

## 3. Milestones

| # | Milestone | Contains | Exit criteria |
|---|---|---|---|
| **M1** | Auth hardening live | R2-a, R2-b | MFA enroll/verify/recovery E2E green on current base; CSRF token required on every cookie-auth mutation; bearer-token path still works behind a flag until cookie migration is fully rolled out |
| **M2** | Horizontal-scale ready | R2-c | Two app instances share lockout/rate-limit state correctly (verified by running 2 instances against one Redis and one Postgres, driving the same lockout scenario R1-d's tests already cover) |
| **M3** | Media generation live | R2-d + minimum object-storage slice pulled forward from R3-c | `POST /api/images/generate` (and video/audio equivalents) return 202, enqueue a job, and the worker completes it with the result durably stored and retrievable — API stays responsive throughout |
| **M4** | Deploy + ops maturity | R2-e, R2-f, R2-g | A tag reaches staging then production through CD with no manual step; `/metrics` is scrapeable and at least one alert has been proven to fire; a restore drill has been executed and the runbook documented |
| **M5** | Release 2 closeout | R2-h | Every remaining security High has a regression test proving it's fixed; Playwright E2E covers the full auth flow including MFA and CSRF; CI green end to end |

Milestones M2–M4 have no hard ordering dependency on each other once M1
lands (R2-c is only a hard dependency for R2-d, not for R2-e/f/g) — they
can run in parallel if more than one engineer is available.

---

## 4. Estimated effort

Using the existing roadmap's S ≤0.5d / M 0.5–2d / L 2–5d / XL >5d scale:

| Milestone | Tasks | Effort (sum of ranges) |
|---|---|---|
| M1 | R2-a (L), R2-b (L) | 4–10 days |
| M2 | R2-c (M) | 0.5–2 days |
| M3 | R2-d (L) + object-storage slice (M, pulled forward from R3-c) | 2.5–7 days |
| M4 | R2-e (L), R2-f (M), R2-g (M) | 3–9 days |
| M5 | R2-h (L) | 2–5 days |
| **Total** | | **~12–33 engineer-days**, single engineer, sequential |

Parallelizing M2–M4 across a second engineer once M1 lands could compress
the wall-clock total meaningfully, since those three milestones have no
inter-dependencies once Redis (M2) exists.

---

## 5. Dependencies

### Inter-task (within Release 2)
- R2-d (media queue) **requires** R2-c (Redis) — cannot start M3 until M2's Redis is provisioned and R2-c is merged.
- R2-b (CSRF) **requires** its own cookie-session auth migration, which is a larger architectural change than R2-a's MFA rebase — budget for this being the milestone most likely to slip.

### Infrastructure (external, must be provisioned before the corresponding task starts)
- **Redis** — a managed instance (ElastiCache, Upstash, Redis Cloud, etc.) must exist before R2-c starts.
- **Object storage** — an S3-compatible bucket (S3, R2, Spaces, etc.) must exist before R2-d's media results have anywhere durable to land; this is the R3-c slice pulled forward into M3.
- **CD platform** — R2-e assumes a CI/CD platform capable of staged deploys with an approval gate (GitHub Actions environments, or an external CD tool); confirm which before scoping R2-e in detail.
- **Metrics/alerting backend** — R2-f's `/metrics` endpoint needs somewhere to scrape it (Prometheus, Datadog, the managed platform's own metrics); confirm the target before implementing the endpoint's format.

### Code (already exists, needs rebasing not rebuilding)
- `recover/mfa` branch — full MFA implementation (TOTP service, challenge/setup/recovery-code services, routes, 4 frontend components, `useMFASetup` hook, RFC 4226/6238 test vectors, DB migration). R2-a's job is rebasing this onto Release 1's current base (new Prisma singleton, refresh-token schema, `app.ts` structure changed since this branch was cut), not reimplementing it.
- `recover/csrf` branch — CSRF middleware, client hook, DB migration, integration tests, docs. R2-b's job is coupling this to the cookie-auth migration it was always meant to ship alongside.

### Founder decisions carried over from Release 1
Both decisions flagged in `RELEASE_ROADMAP.md` (MFA/CSRF in R2 not R1; R1
AI is text/code-first) are assumed still in effect. If priorities have
changed since Release 1 shipped, re-confirm before starting M1 or M3.
