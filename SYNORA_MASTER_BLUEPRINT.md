# SYNORA — Master Blueprint

**Created**: 2026-08-05
**Status**: LIVING DOCUMENT — maintained continuously, per the founder's
human-capability-expansion directive (§18). This is the document §17 of
that directive measures the end state against: *"continue until every
capability already defined in SYNORA_MASTER_BLUEPRINT.md is implemented
to its defined standard."*
**Row-level truth**: `CURRENT_CAPABILITY_MATRIX.md`. This blueprint defines
*what done means*; the matrix records *what is true right now*. When they
disagree, the matrix wins about the present and this document wins about
the destination. Neither is ever edited to make the other look better.

---

## 1. What Synora is

Synora is a **human-centered AI world**: an environment in which people
think, create, decide, build, operate and accomplish work with AI — not a
chatbot with features attached, and not an automation platform that
removes people from their own work.

Three commitments distinguish it, and every capability is measured
against them:

1. **Never fake intelligence.** Every AI-shaped output is labeled by its
   real provenance (`model` / `local-deterministic` / `authored` /
   SIMULATED), everywhere, always. Unmeasured is reported as unmeasured.
   A gap is named, never glossed.
2. **Maximum capability, maximum human control.** Automation executes;
   authority stays human. Actions that need human authority stop and ask
   — once, clearly, with enough context to decide — and everything else
   proceeds without nagging.
3. **Work lives somewhere and survives time.** Conversations, runs,
   files, decisions and their reasons accumulate into places (projects,
   workspaces) a person can leave for a quarter and re-enter without
   starting from zero.

## 2. The launch vision, stated as human outcomes

Synora is launch-ready when a person can accomplish each of the
following end-to-end, and each has a verified status in the capability
matrix. Implementation primitives (chat, agents, workflows, canvas) are
listed only as the means.

| # | Human outcome | Primary means | Matrix families |
|---|---|---|---|
| O1 | "I want to think something through with AI, and keep the thread." | Conversations: streaming, branching, folders, templates, attachments, export | A, E |
| O2 | "I want a place where a piece of work LIVES — everything about it, resumable months later." | Projects: gathered work, goal, timeline, since-last-visit digest, decision notes, resume | E (project rows) |
| O3 | "I want to delegate a task and stay in charge of it." | Agents: budgets/limits, approval gates, memory opt-in, run records, permalinks | B, I |
| O4 | "I want repetitive work to run itself — exactly, on schedule, reversibly." | Workflows: authored steps, schedules (DST-correct), webhooks, event triggers | C, H |
| O5 | "I want to arrange my thinking spatially." | Canvas: blocks, connections, multi-select, undo | D |
| O6 | "I want to create media and documents from intent." | Image/video/audio generation, documents, save-as-doc | G |
| O7 | "I want to work with other people in one place, safely." | Workspaces, roles, invitations, sharing, audit, activity | L, O |
| O8 | "I want to know what needs me, what's running, and what broke — at a glance." | Home decision surface (WaitingForYou / ActiveWork / NeedsAttention / RecentActivity) | B, N |
| O9 | "I want to trust the platform with my account and money." | Auth + MFA, sessions/devices, billing, credits, usage ledger | M, O |
| O10 | "I want the platform itself to know whether it's healthy and honest." | EOS: launch gates, proposals with founder approval, cost/latency/privacy monitors | N |

**Definition of done for an outcome**: class **A** (or **B** with the
stated hole explicitly accepted by the founder) in every matrix row the
outcome depends on, plus at least one verified end-to-end journey test
covering the whole loop: action → UI → logic → persistence → UI state →
error/recovery.

## 3. What launch does NOT require (deliberate non-goals for v1)

- **Cloning any competitor's product shape.** Synora studies the human
  need, never the rival's implementation.
- **Judging the user's work.** "Last activity 3 weeks ago" is shown;
  "this project is stalled" never is.
- **AI-inferred records presented as human ones.** A decision note is
  written by the person; an AI draft, if ever added, is labeled a draft.
- **Cross-application ambient computing.** One coherent world first.

## 4. The external-dependency seam (what stays honest until launch)

Everything below is **architecture-complete and blocked only on
credentials/infrastructure** — the launch playbook is: connect, validate,
flip. Nothing in this table is ever reported as live before that.

| Seam | Built abstraction | Missing piece | Matrix class |
|---|---|---|---|
| Model intelligence | 10-provider AI abstraction, LOCAL/SIMULATED/REAL labeling | API keys | E |
| Embeddings / semantic recall | Provider adapters + pgvector store | Embedding credentials | E |
| Payments | Stripe-shaped billing services, webhook dedup | Processor account | E |
| Media generation | Provider registry + async job polling | Provider keys | E |
| Virus scanning | ClamAV abstraction, fail-closed three-state | Scanner deployment | E |
| Mail | Mailer abstraction (console transport locally) | SMTP/API credentials | E |
| Production infra | Docker, config staging, secrets manager, K8s dir | Cloud accounts, DNS, deploy | — |
| Model-judged gates | 3 of 10 launch gates | Judge endpoint | reported unmeasured |

## 5. Capabilities defined but not yet built (the forward edge)

Ordered by the directive's priorities. Each enters the matrix the moment
any part of it becomes real.

1. **Founder Authority system** — phishing-resistant founder auth
   (passkeys/WebAuthn, platform-held biometrics, step-up, recovery,
   emergency lock, audit). **BLOCKED on a founder decision**: what
   "Founder" means in a multi-tenant model where the top role today is
   per-workspace OWNER. Deliberately not guessed.
2. **Synora Command Center** — intention → understanding → plan → risk
   class → permission check → preview → approval → execution →
   verification → result → audit, as one pipeline. Foundations exist
   (agent engine's plan/approve/execute, EOS proposals, tool permission
   layer). Slice 1 shipped 2026-08-05: **agent-run plan preview** —
   POST `/agents/:agentId/runs/preview` plans through the SAME planner,
   validation and per-step preflight a real run uses, then stops; no run
   record is created. The per-step checks were factored into
   `agents/step-checks.ts`, SHARED with the workflow dry run — one
   checker, so the two previews can never disagree. The report states
   provenance (plan origin + runtime mode/notice), which steps would
   pause for a person, what would fail, what is unknowable, and — for
   model planners — that starting the run plans again and may differ.
   Budget exhaustion is reported as a blocker, never used to refuse the
   preview. UI: "Preview plan" beside Run on the agents page, rendering
   the report through the same RuntimeNotice provenance component every
   run uses. Slice 2 shipped 2026-08-05: **tool execution preview** —
   POST `/tools/:toolId/preview` reports where the request would go
   (host + method), whether it would stop for approval, which declared
   secrets it would carry (NAMES only — the preview never resolves one,
   so previewing can never become a way to read a secret), rate-limit
   headroom, what would block it, and what is unknowable without
   sending. Facts, never a safety verdict: nothing grades a tool "safe"
   or "risky", because Synora has no system that can judge that. **All
   three execution paths now have a preview** (agent runs, workflows,
   tools). Slice 3 shipped 2026-08-05: **the approval moment inherits
   the preview's facts** — the single-run read attaches the paused
   step's consequences (same shared checker), because whoever approves
   is usually not whoever asked and was previously shown only a step id
   and a one-line reason. Slice 4 shipped 2026-08-05: the **risk stage,
   as consequence facts rather than grades** — every step check and the
   tool preview now carry `reversibleBySynora` plus the server's own
   wording ("Synora cannot undo this once it runs — it acts on a system
   outside Synora" / "Nothing outside Synora changes, so there is
   nothing to undo"). Undo is a capability Synora either has or lacks,
   so this is certain; whether it *matters* is the reader's call, which
   is why no surface says "safe" or "risky". Rendered on all three
   surfaces from the one shared source. Still missing: the single
   unifying surface that shows the pipeline as one thing.
3. **Human Decision Center, full form** — partially advanced 2026-08-05:
   the home page's waiting surface now covers three item kinds — paused
   runs, tool executions stopped on `requiresApproval` (workspace-scoped,
   linking to where the decision's full context lives), and workspace
   invitations addressed to the signed-in person (the first
   account-scoped, cross-workspace item; verified-email-gated so the
   in-app surface is never weaker than the emailed token it stands in
   for). Per-item WHO/WHEN shipped 2026-08-05: every waiting row names
   the person who asked and when (batched name resolution on the read
   surfaces; email fallback; never a raw id). Cross-workspace awareness
   shipped 2026-08-05: per-workspace counts of waiting decisions across
   all the person's workspaces, with one-click switching (counts only —
   the context each decision needs lives inside its workspace). Still
   missing from the defined standard: remaining non-run work kinds
   (documents, generated media) and per-item RECOMMENDATION/consequences
   detail.
4. **Operations visualization (office view)** — role-scoped layers
   (EXECUTIVE / OPERATIONS / ENGINEERING / SECURITY / AI / AUDIT) over the
   EOS event bus. Founder-only data stays founder-only.
5. ~~**Decision-note lifecycle**~~ — SHIPPED IN FULL 2026-08-05:
   append-only corrections (`correctsNoteId`; the original stays
   visible, marked) and the per-project decisions view (`decisions`
   payload with full verbatim content, rendered as a collapsed log).
6. ~~**Workspace-level "since you were last here"**~~ — SHIPPED
   2026-08-05 (`WorkspaceVisit` + `/whats-new` + the dashboard banner;
   see the matrix's "Continuing work after time away" row).
7. **Async long-running work** — **BLOCKED on founder sign-off**
   (standing constraint). Workflows currently run inside the HTTP request.
8. **Client IP pseudonymization** — **CONDITIONAL, awaiting founder
   sign-off** (Engineering Constitution).

## 5b. Provider integration — audited 2026-08-05

Full findings: `docs/operations/PROVIDER_READINESS_MATRIX.md`. The three
facts that change how the rest of this blueprint should be read:

1. **Three AI stacks exist; one is unreachable.** `src/ai/core/*` (9 files)
   plus `src/ai/providers/openai.provider.ts` (250 lines, the only raw-fetch
   OpenAI adapter, with tools/streaming/health/retry) is imported by nothing.
   A reader would credit Synora with capabilities no request can reach.
   **Decide: wire it in or delete it.** Leaving it is a trap for the next
   reader.
2. **Synora's live text contract cannot express tool calling, structured
   output, or vision** — the providers support all three. "Provider supports
   X" and "Synora supports X through that provider" are different claims and
   this blueprint must never conflate them. Agent tool use works by Synora's
   own planner + tool runner, which is orchestration-level tool use, not
   provider-native function calling.
3. **The embeddings stack is the standard the text stack should meet.**
   `embeddings/` has retry, circuit breaker, rate limiter, metrics, tracing,
   cache, usage and security modules. The text path has none of them.
   Transplanting the proven in-repo pattern is the top resilience item.

Closed by that audit: **credential verification** — `verifyCredential()` on
the descriptor contract answers "is this key actually accepted", separate
from `isConfigured()`'s "is a key present", with `unreachable` never
collapsed into `rejected`.

## 6. Standing engineering law (unchanged by any roadmap)

- Security fails closed. 404, not 403, where existence is the secret.
- Every optional foreign key accepted on a write is a claim of access
  and is independently re-verified where it is accepted.
- One engine per concept: workflows run through the agent engine; a
  second execution loop is never built.
- Provenance labels are never collapsed. `authored` ≠ `model` ≠
  `local-deterministic`.
- Records of the past are immutable; recovery creates new records.
- Empty states are absent, not zero-valued placeholders.
- Verification gate before every push: full backend + frontend suites,
  8/8 type-check, 0 lint errors, migration drift check.
- The capability matrix is updated in the same commit as the change it
  describes. A stale claim, once found, is corrected with a note that it
  was stale — not silently rewritten.

## 7. Launch sequence (when the founder pulls the trigger)

1. Connect real AI providers; run the regression + evaluation suites
   against them; measure the 3 unmeasured gates.
2. Connect payments, mail, scanning, embeddings; run each family's
   class-E validation path.
3. Provision production infra (DB, Redis, storage, queues, DNS, TLS);
   run migrations; verify the boot-time hydration and health probes.
4. Full launch-gate pass (all 10 measured), security review, load test.
5. Deploy; validate the verified user journeys against production.
6. Public launch.

Until step 1 begins, every increment continues to be built, tested and
verified locally to production standard — that is this document's whole
premise.
