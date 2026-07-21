# DOCUMENTATION_AUDIT_v2.md

**Reviewer:** Independent documentation auditor
**Date:** 2026-07-21
**Scope:** Every markdown file in the repository (16 files, ~4,300 lines), cross-checked against the actual code in `apps/` and `packages/`
**Method:** Full read of every `.md` file, date/content diff against git history, link and structural inventory. No documentation written — audit only.

## Documentation Score: 36 / 100

**One-line verdict:** The documentation is well-written, detailed, and almost entirely **describing a different, more-finished system than the one that exists** — five of the six core `docs/*.md` files are dated 2026-01-13, six months stale, and describe technologies (TanStack Query, Zustand, shadcn/ui, Redis caching, S3 storage, NextAuth.js, speakeasy-based MFA, Docker deployment) that are absent from the actual codebase. Newer docs (secrets/config/A3, all dated 2026-07-20/21) are accurate to the code they describe, because they were written alongside it — the rot is concentrated exactly where the docs stopped being updated in lockstep with reality.

---

## Inventory (all 16 markdown files)

| File | Lines | Dated | Accuracy vs. code |
|---|---|---|---|
| `README.md` | 244 | 2026-01-13 | Stale — claims TanStack Query, Zustand, Docker deployment, none present |
| `CLAUDE.md` | 401 | 2026-01-13 | Stale — same claims, is the project's own instruction file |
| `docs/architecture.md` | 257 | 2026-01-13 | Stale — describes Redis, S3, NextAuth.js, AI Integration Layer; none exist |
| `docs/api.md` | 541 | 2026-01-13 | Partially accurate — endpoint list matches routes that exist, but `images.ts` is a placeholder generator the doc presents as functional |
| `docs/database.md` | 463 | 2026-01-13 | Stale — predates `MFAAuditLog` model entirely; no mention of the audit table added 2026-07-21 |
| `docs/deployment.md` | 480 | 2026-01-13 | **Actively wrong** — documents `docker build -t synora:latest .` against a Dockerfile that does not exist anywhere in the repository |
| `docs/security.md` | 467 | 2026-01-13 | **Actively wrong** — MFA section shows `speakeasy` code samples; `speakeasy` is not a dependency and no such code exists |
| `docs/operations/ENVIRONMENT_MANAGEMENT.md` | 205 | 2026-07-20 | Accurate |
| `docs/operations/ENVIRONMENT_MIGRATION_GUIDE.md` | 94 | 2026-07-20 | Accurate |
| `docs/security/SECRET_MANAGEMENT.md` | 329 | 2026-07-20 | Accurate |
| `docs/A3_MONITORING_ALERTING_REPORT.md` | 359 | 2026-07-21 | Accurate to the services it describes, but silent on the fact those services are unwired (see Testing/Architecture reviews) |
| `docs/pr-descriptions/*.md` (3 files) | 199 | 2026-07-20 | Accurate, historical PR bodies |
| `MODULE_CERTIFICATION_REPORT.md` | — | 2026-07-21 | **Contains fabricated claims** — see below |
| `ARCHITECTURE_REVIEW_v2.md` | — | 2026-07-21 | This review's own companion doc, accurate |
| `PERFORMANCE_REVIEW_v2.md` | — | 2026-07-21 | This review's own companion doc, accurate |

Two documents referenced by `MODULE_CERTIFICATION_REPORT.md` **do not exist anywhere in the repository or git history**: `docs/A1_RFC_TEST_VECTOR_VALIDATION_REPORT.md` and `docs/A2_AUDIT_LOGGING_REPORT.md`. Neither does `apps/backend/src/services/mfa/totp.service.ts`, the file `MODULE_CERTIFICATION_REPORT.md` cites as A1's deliverable. This is not staleness — it is a certification document asserting the existence of files that were never committed. See `MODULE_1_FINAL_CERTIFICATION.md` for the full implication.

---

## Duplicated Documentation

- **Environment variable documentation exists in four places** with overlapping but not identical content: `README.md` (Environment Variables section), `CLAUDE.md` (same section, near-verbatim), `.env.example` / `apps/backend/.env.example` / `apps/web/.env.example` (as comments), and `docs/operations/ENVIRONMENT_MANAGEMENT.md` (the authoritative, current one). A developer has no way to know which of the four is current without reading all four.
- **Security guidance is split** across `docs/security.md` (stale, 2026-01-13, generic OWASP advice) and `docs/security/SECRET_MANAGEMENT.md` (current, 2026-07-20, specific to the actual secrets subsystem) — same directory tree, contradictory currency.
- **Deployment instructions duplicated** between `README.md`'s quick-start and `docs/deployment.md`'s full guide, both stale, both describing a Docker workflow that doesn't exist.

## Outdated Docs

Covered in the inventory table above — five files dated 2026-01-13 have not been touched across at least six months of substantial changes: the entire secrets subsystem, the config/stage system, MFA audit/monitoring/rate-limiting/alerting, the CI pnpm migration, and the Prisma migration repair. `docs/database.md` in particular predates the schema it's supposed to document.

## Conflicting Docs

| Conflict | Doc A | Doc B | Reality |
|---|---|---|---|
| State management | `README.md`/`CLAUDE.md`: "TanStack Query + Zustand" | `docs/architecture.md`: same claim | Code: `useState` only, no such packages installed |
| MFA implementation | `docs/security.md`: `speakeasy`-based TOTP code sample | `docs/A3_MONITORING_ALERTING_REPORT.md`: describes audit/monitoring/rate-limit/alert services | Code: no TOTP generation exists at all; the A3 doc is accurate about its own narrow scope but the two docs describe non-overlapping, never-reconciled halves of "MFA" |
| Deployment method | `docs/deployment.md`: Docker build/run as primary path | *(no doc says otherwise)* | Code: no Dockerfile exists; only `docker-compose.dev.yml` (Postgres+Redis for local dev) |
| Auth provider | `README.md`: "NextAuth.js v5" | `docs/architecture.md`: "JWT + NextAuth.js" | Code: hand-rolled JWT only, `Session`/`VerificationToken` Prisma models exist unused, no NextAuth dependency |
| Caching layer | `docs/architecture.md` diagram: Redis between backend and providers | *(`docker-compose.dev.yml` does provision a Redis container)* | Code: zero Redis client code, zero cache reads/writes anywhere — the compose file provisions infrastructure nothing uses |
| Module 1 completion status | `MODULE_CERTIFICATION_REPORT.md`: "A1 RFC 6238 Test Vector Validation — ✅ COMPLETE, 88/100" | — | Code: no TOTP/RFC-6238 implementation exists in the repository at any commit |

## Missing Documentation

- **No CONTRIBUTING.md** despite `CLAUDE.md` §Contributing prescribing a 7-step process — the process is documented but not extracted to the file a contributor would actually look for.
- **No CHANGELOG.md** despite `docs/changelog.md` being referenced by `CLAUDE.md`'s own documentation index — the referenced file does not exist.
- **No frontend developer guide** — nothing documents the (currently thin) `apps/web` structure, conventions, or the gap between documented (TanStack/Zustand/shadcn) and actual (raw fetch/useState) patterns.
- **No runbook for the secrets/config system's failure modes in production** beyond rotation (covered) — e.g., what an operator does when `validateRequired()` fails staging boot.
- **No data-retention/privacy documentation** (GDPR/CCPA posture) despite `Workspace`/multi-tenant models and an enterprise/government compliance mode existing in config.
- **No test-writing guide** — given the coverage gaps in `TEST_COVERAGE_MASTER_REPORT.md`, there's no doc telling a new contributor where tests belong or what's expected.
- **No glossary/domain-model doc** reconciling `Workspace` vs. `Project` vs. tenant (the architecture review flags this ambiguity as a structural risk; it's also a documentation gap — nothing defines these terms).

## Broken Links

No internal cross-links between markdown files exist at all — zero `[text](./other.md)` style references were found anywhere in `docs/*.md`, `README.md`, or `CLAUDE.md`. This isn't "broken links" in the 404 sense; it's the absence of any navigable link graph. A reader lands on any one doc with no path to related docs except knowing the file tree in advance. (`CLAUDE.md`'s documentation index lists files by name/description but does not hyperlink them — including the nonexistent `docs/changelog.md`, which is a broken reference by omission.)

External links (README badges, license link) were not independently re-verified over the network in this audit; the CI badge and BUSL-1.1 license link reference the correct repository path structure.

## Missing ADRs

**Zero Architecture Decision Records exist.** No `docs/adr/` or `docs/decisions/` directory, no numbered decision files, despite `CLAUDE.md`'s own workflow section implying a mature engineering process. Decisions made in this codebase that warrant a recorded rationale and currently have none:
- Why hand-rolled JWT over NextAuth.js (a reversal from what the docs still claim).
- Why `bcryptjs` (pure-JS) over native `bcrypt`/`argon2` — the performance review shows this was likely never a deliberate choice, which an ADR would have forced.
- Why `MFAAuditLog.userId` is a soft reference (no FK) — the code comment explains it, but a soft reference is a durable architectural commitment that deserves an ADR, not just an inline comment.
- Monolith-vs-microservice posture — the architecture review recommends writing this down explicitly; today it's implicit.
- Why the capability/provider layer was designed on feature branches rather than trunk — no record of the branching strategy's rationale or exit criteria.

## Missing Architecture Diagrams

One ASCII diagram exists (`docs/architecture.md`'s box-drawing system overview) and it is stale (depicts Redis/S3/AI-provider boxes that don't exist in code). No diagram-as-code (Mermaid, PlantUML, drawio) exists anywhere in the repository — zero `.drawio`, `.puml` files, and zero ` ```mermaid ` fenced blocks in any markdown file, confirmed by repository-wide search. Specifically missing:
- A diagram reflecting the *actual* current system (Express monolith, single Postgres, no Redis, no queue, no capability layer wired in) — the one diagram that exists is aspirational, not descriptive.
- Component diagram for the secrets/config subsystem (genuinely complex — source chain, catalog, stage/mode taxonomy — and the best-documented-in-prose subsystem in the repo, but prose-only).
- Data-flow diagram for the MFA audit/monitoring/rate-limit/alerting pipeline (four services, no diagram showing how they're meant to connect to an eventual MFA flow).

## Missing Sequence Diagrams

None exist anywhere. High-value candidates, all currently undocumented as sequences:
- Login request: client → rate limiter → Prisma lookup → bcrypt compare → JWT sign → response (would visually surface the bcrypt-on-event-loop bottleneck from the performance review).
- Secret resolution: `SecretsManager.get()` → source chain iteration → audit log write (the fallback/precedence logic is described in prose across multiple files; a sequence diagram would replace several paragraphs).
- Token verification with rotation grace window: multi-secret-version retry loop in `middleware/auth.ts`.
- MFA setup/verify (once built) — should be diagrammed *before* implementation, not after, given how much audit/monitoring scaffolding already assumes its shape.

## Missing Deployment Diagrams

None exist. `docs/deployment.md` is prose-only and describes infrastructure (Docker image, container registry, blue-green deployment, load balancer) with no accompanying diagram, and — more importantly — no diagram would currently be honest, because the artifacts it describes (Dockerfile, registry push target) don't exist. Missing entirely:
- Current-state deployment diagram (whatever actually runs CI/dev today — Turbo pipeline, GitHub Actions, local docker-compose for Postgres+Redis).
- Target-state deployment diagram matching the DevOps review's recommendations (see `PRODUCTION_READINESS_v2.md`).
- Network/security-zone diagram (where secrets sources — env/Docker/K8s — apply in which environment).

## Missing API Documentation

`docs/api.md` is the strongest doc in the repository relative to code — endpoint list, request/response shapes, and error codes broadly match the five real route files. Gaps:
- No OpenAPI/Swagger spec — everything is hand-written prose, so client generation and contract testing (flagged in the architecture review) have nothing to consume.
- `POST /api/images/generate` is documented as if it performs real image generation; the code returns a hardcoded placeholder URL. The doc should say so, or the feature should exist — currently neither is true and the doc actively misleads.
- No documentation of rate-limit headers/behavior actually returned by `express-rate-limit` (the doc has a "Rate Limiting" section but doesn't confirm it matches the single global limiter that exists, versus the tighter per-route limits recommended in the performance review).
- No versioning note (`/api/v1` doesn't exist yet, matching the architecture review's finding) and no deprecation policy.

## Missing User Documentation

**None exists at all.** No end-user-facing help content, onboarding guide, FAQ, or in-product help copy beyond the dashboard's placeholder marketing copy ("Generate stunning images from text descriptions" — a claim with no feature behind it). For a "premium, enterprise-grade AI platform for creators" (CLAUDE.md's own framing), there is currently no user-facing documentation of any kind — this is expected at the current build stage but should be tracked as a launch-blocking gap, not silently absent.

---

## Recommended Remediation Order

1. **Immediate (half a day):** Add a "Status: STALE — see [current doc]" banner to `README.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/database.md`, `docs/deployment.md`, `docs/security.md`, or delete/rewrite the sections that assert nonexistent tech. A wrong doc is worse than no doc; this is the single highest-leverage half-day of documentation work available.
2. **This week:** Correct `MODULE_CERTIFICATION_REPORT.md`'s A1 claim and the two missing referenced reports — either produce them honestly reflecting "not started," or remove the claim. This directly feeds `MODULE_1_FINAL_CERTIFICATION.md`.
3. **This week:** Write the missing CONTRIBUTING.md and CHANGELOG.md — both are referenced by existing docs as if they exist.
4. **Next sprint:** Retrofit `docs/architecture.md` and a new sequence-diagram set (Mermaid, checked into the repo so it renders in GitHub) to describe the system as it verifiably runs today.
5. **Before public launch:** First ADRs (JWT vs. NextAuth, bcrypt library choice, monolith-vs-microservice posture), OpenAPI spec generated from the zod schemas already recommended in the architecture review, and user-facing documentation for whatever feature set actually ships.

---

## Score Rationale

| Dimension | Score | Why |
|---|---|---|
| Volume/writing quality | 8/10 | Genuinely well-written, detailed prose throughout |
| Currency (docs vs. code) | 2/10 | Five of six core docs are 6 months stale; several actively describe nonexistent systems |
| Internal consistency | 3/10 | Multiple direct contradictions between docs, and within `MODULE_CERTIFICATION_REPORT.md` itself vs. verifiable code |
| Structural completeness (ADRs/diagrams) | 0/10 | Zero ADRs, zero diagrams of any kind, zero diagram-as-code |
| API documentation | 6/10 | Best-aligned doc in the repo, undermined by the placeholder-endpoint misrepresentation |
| Navigability (links) | 1/10 | No internal cross-linking anywhere |
| User-facing documentation | 0/10 | Does not exist |
| **Overall** | **36/100** | High-quality writing undermined by systemic staleness and, in one document, fabricated claims |

*Companion documents: ARCHITECTURE_REVIEW_v2.md, PERFORMANCE_REVIEW_v2.md, TEST_COVERAGE_MASTER_REPORT.md, MODULE_1_FINAL_CERTIFICATION.md.*
