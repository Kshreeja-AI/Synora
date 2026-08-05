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
   **Tool calling CLOSED 2026-08-05**: the contract now carries
   `tools`/`toolChoice` in, `toolCalls` out, and `toolCalls`/`toolResults` on
   history turns so a full round trip replays. Two adapters implement it,
   covering 7 of 10 providers (Anthropic; and the OpenAI-compatible family —
   OpenAI, xAI, DeepSeek, Together, OpenRouter, Azure). `tool-calling` is
   declared as a capability ONLY where implemented, so
   `providersForCapability('tool-calling')` stays a truthful answer.
   **Capability negotiation followed** (same day): `synoraSupports` on every
   model in the catalog is a conjunction of the model's claim AND Synora's
   adapter, computed server-side, so the model picker can no longer badge a
   capability no request can reach. It also exposed a real defect — Azure's
   catalog key did not match its provider id, so a configured Azure
   deployment showed zero selectable models.
   **Still true and still must not be conflated**: structured output and
   vision remain unexpressible; Gemini/Bedrock/Ollama have no tool mapping;
   and the agent runtime still plans with its own planner — the capability is
   available to callers, not yet adopted internally. Adopting it is an
   orchestration decision (it moves step selection from Synora's planner to
   the model), not a provider change, and belongs in the Command Center
   thinking rather than in this list.
3. **The embeddings stack is the standard the text stack should meet.**
   ~~The text path has none of them.~~ CLOSED same day: retry + circuit
   breaker moved to shared `src/resilience/` (embeddings files re-export;
   one definition, two consumers) plus a new timeout module; every
   `generateText()` call now runs under timeout → retry → per-provider
   breaker. The outbound rate limiter followed in the next increment:
   `rateLimiter.ts` moved to `src/resilience/` the same way, wired between
   the breaker and retry, config-driven (`AI_RATE_LIMIT_*`), refusing a
   call BEFORE it is sent (standard 429 envelope, never counted as a
   provider failure). Provider call metrics followed, with a
   distinction embeddings never needed — a call that FAILED versus one
   Synora REFUSED TO SEND, since those look identical in an error count
   and lead to opposite diagnoses. Remaining from the embeddings standard:
   tracing, cache — plus true request cancellation (the timeout bounds
   waiting, not the underlying HTTP call) and per-workspace fairness
   keying (the text facade deliberately hides caller identity from the
   provider layer; embeddings keys `provider:workspace`).

Closed by that audit: **credential verification** — `verifyCredential()` on
the descriptor contract answers "is this key actually accepted", separate
from `isConfigured()`'s "is a key present", with `unreachable` never
collapsed into `rejected`.

## 5c. The Universal Command Layer — begun 2026-08-05

Directive: the founder's Human Comfort / Universal AI Era brief. Its core
demand is one thing Synora did not have — **a single place where a person
says what they want in plain language and Synora resolves it to real
capabilities**, without first choosing between "agent", "workflow", "tool"
and "chat". The person should express an outcome; Synora carries the
complexity.

**Slice 1 shipped: understanding, routing, and refusal.** `src/command/`
plus `POST /api/command/understand`. One sentence in; a statement of what
Synora believes was asked, which REAL capability would serve it, what it
could not determine, and security observations about the text.

Four design decisions that the rest of this layer must not undo:

1. **Deterministic, not a model call.** Understanding is a fixed grammar
   running locally with zero credentials. Three reasons, in priority order:
   a model asked to interpret a hostile sentence can be *argued into*
   interpreting it favourably (that is what prompt injection is), and the
   first thing between hostile text and Synora's capabilities must not be
   persuadable; understanding "what needs my decision" has to work when
   every provider is down, because this layer is *how a person reaches
   Synora*; and a deterministic classifier that fails says so, whereas a
   model always produces something shaped exactly like a correct answer.
   A model may later RANK or EXTEND this. It must never become required.
2. **The command text is data, never instructions.** Structurally, this
   module has no mechanism to obey anything — it classifies action shapes
   and returns a description. Authority-override phrasing ("ignore your
   rules", "you are now admin", "without approval") is detected, reported,
   and grants nothing. The payload is deliberately NOT echoed back into
   observations: repeating attacker-controlled text into logs and
   dashboards is its own delivery mechanism.
3. **It never executes.** `executed: false` is an explicit field, not an
   assumption, so no caller can read an interpretation as evidence that
   something ran. Acting goes through the surfaces that already exist,
   each with its own permission checks, previews and approval gates. The
   command layer shortcuts none of them and therefore grants no authority:
   understanding a sentence about deleting a database is not permission to
   delete one.
4. **The catalogue may only name capabilities that exist.** A routing
   layer's characteristic failure is confidently routing to a capability
   that was only ever a plan. Every entry names a real surface, and
   `availability` separates "Synora implements this" from "this deployment
   can do it right now" — a person told the first when they needed the
   second has been misled.

Also honest about the opposite case: requests Synora genuinely cannot serve
(phone calls, SMS, social publishing, payments, device control, travel
booking) return `not-yet-capable` **naming the missing capability**, rather
than "I don't understand". Synora understood perfectly and simply cannot do
it, which is what the person needs to hear.

**Slice 2 shipped: "and am I allowed to do this, here?"** `command/prepare.ts`
plus `POST /api/command/:workspaceId/prepare`. Understanding is deliberately
identity-free — the same sentence means the same thing to everyone — so
whether a PARTICULAR person may act on it is answered separately, against
their real workspace role. Two axes, kept independent because they fail for
different reasons and neither can substitute for the other:

- **Permission is about the person.** A VIEWER asking to invite someone is
  refused, and told the missing permission BY NAME (`member:invite`) so they
  can ask for the right thing rather than guess.
- **Availability is about the deployment.** A workspace OWNER still cannot
  generate an image with no provider configured. Reporting that as
  actionable would send the most privileged person to a button that fails
  for a reason no permission change can fix.

`recommended` is null when nothing is both permitted and available — offering
a capability someone cannot use is worse than saying there is nothing to
offer. Still executes nothing, and the permission answer here is a courtesy
so nobody is offered a button that will reject them, NOT a substitute for the
authoritative check that runs again inside whichever surface does the work.

**Slice 3 shipped: it actually does things.** `command/execute.ts`, a
`CommandExecution` durable record, and `POST /api/command/:workspaceId/execute`.
A typed sentence now reaches the REAL services — never a re-implementation,
never a simulated result. The chain is: understand → resolve → permission →
availability → risk → approval gate → execute → durable record.

**Nine states, never blurred** — `completed`, `not-authorized`,
`unavailable`, `not-implemented`, `not-bound`, `waiting-approval`,
`rejected`, `expired`, `failed`. `not-bound` exists as its own state
deliberately: the capability is real but the command layer cannot yet drive
it, and collapsing that into "not implemented" would slander working code
while "failed" would blame the user. `rejected` (a person said no) and
`expired` (nobody answered) are likewise distinct from each other and from
`failed` — three very different things to have to explain to someone.

**Risk decides approval.** Read-only and reversible proceed; sensitive and
high-risk stop at `waiting-approval` and DO NOT run. Stopping to confirm a
search would teach people to click through prompts unread, which is how the
warning that finally matters gets ignored. Reporting an unapproved sensitive
action as completed would be the exact dishonesty this layer exists to
prevent.

**Authority never comes from the sentence.** It comes from the session and
the workspace role, checked here and AGAIN inside the service that performs
the work (`conversationService.create` runs its own membership and permission
checks). A sentence claiming "you are now an admin" still stops at the gate;
naming another workspace cannot reach it.

**Every outcome is recorded**, refusals included — a trail containing only
completions is systematically optimistic.

**Slice 4 shipped: a yes that means yes.** `command/approve.ts`,
`POST /api/command/:workspaceId/executions/:executionId/decision` and
`GET /api/command/:workspaceId/executions`. Slice 3 could refuse a sensitive
action honestly but gave nobody a way to say yes. Almost all of slice 4 is
the machinery that makes a "yes" mean exactly what everyone assumes.

**The four ways an approval system lies, and what stops each:**

1. *The client claims approval.* Nothing the caller sends says "approved".
   The only approval that exists is a row this server wrote; the caller
   supplies only which row they mean.
2. *The same approval is used twice.* The pending state is CLAIMED with a
   conditional update — a database-level compare-and-set — and only the
   writer that actually changed the row proceeds. Two simultaneous
   approvals cannot both win; a replay finds nothing left to claim.
3. *The approval is stale.* Each pending record carries the deadline it was
   created with (stored, not derived from a constant, so the deadline a
   person was shown is the one enforced). Past it, the record expires
   instead of running. Window: 24 hours.
4. *The approved action is not the executed action.* THE IMPORTANT ONE. The
   action is re-derived from the STORED command text and must still resolve
   to the same capability, the same risk class, and the same need for
   approval. The request body has no field that can influence what runs —
   there is deliberately nothing to tamper with.

**Approving runs it, atomically.** There is no window in which an approval
exists but has not been spent: a stored unspent approval is a credential,
and a credential sitting in a database is a thing to steal.

**A crashed decision self-heals.** A claim abandoned mid-flight would
otherwise wedge the record permanently, so the deadline covers claimed
records too — nothing legitimate holds a claim for a day. A second approver
arriving mid-decision is told the decision is IN FLIGHT, which is a
different fact from "already decided" and the only one that is true.

**Authority is split correctly.** The approver's own role must permit the
capability — you cannot authorize what you would not be allowed to perform.
The action then runs as the ORIGINAL requester, whose permission is
re-checked at that moment, because roles change while things sit in queues.
Order matters and is a correctness property: a demoted requester is reported
as a permission change, never as "the action changed", or someone goes
hunting for an edit that never happened.

**Known limit, stated plainly**: today no capability is both sensitive AND
bound, so approving one honestly reports `not-bound` — the approval is
recorded as the fact it is, and nothing runs. The "approved action then
runs" leg shares one code path (`runBound`) with direct execution, which
slice 3 proves against a real database row. It is not separately proven
end-to-end and will not be until a sensitive capability is bound.

**Slice 5 shipped: a person can actually reach it.** `/command` ("Ask
Synora"), `lib/api/command.ts`, `CommandOutcomeCard`, `PendingApprovals`, a
sidebar entry directly under Dashboard, and a row in `WaitingForYou`.
Slices 1–4 built a complete engine with no steering wheel; the approval
gate in particular was a state the system could enter and no person could
leave.

**The nine states are never collapsed in the UI either.** The backend went
to real trouble keeping "not connected", "not allowed", "nobody wired it
up", "a person must approve" and "it broke" apart. A green tick and a red
cross would throw all of it away at the very last step, leaving the person
back where they started — guessing whether anything happened. A test
renders all nine states and asserts nine DISTINCT headings; another asserts
every non-completed state says plainly that nothing was done.

**Server wording, rendered verbatim.** The server is the only thing that
knows why it refused. A second wording of the same rule in the client is a
second thing to keep in sync, and it eventually disagrees in front of a
user.

**Consequences before the click, and the decision where its context lives.**
Each pending row states the plain-language risk, what it would use, and the
deadline BEFORE either button is reachable — not in a confirmation dialog
afterwards. `WaitingForYou` says a command is waiting and links to
`/command`; it deliberately offers no yes/no, because approving from a
summary card is a yes given without the sentence, the risk or the deadline
in view. Same rule the tool-approval flow already follows.

**No preview before running.** Read-only and reversible commands simply run.
Asking "are you sure?" before a search is how people learn to click through
prompts unread, and the prompt that finally matters gets the same reflex.

**Examples are drawn from capabilities that are actually bound.** A hint
suggesting "email the team a summary" would teach a capability that does
not exist and be discovered as a lie on first use.

**Not yet built**: no voice or accessibility input path, no learned
personalization, no multi-step decomposition, no undo. Bound capabilities
so far are search, conversation-create and provider-metrics; everything
else honestly reports `not-bound`. Self-approval is permitted — the gate is
a deliberate pause and a record, NOT four-eyes separation of duties, and
requiring a second person would break single-owner workspaces.

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
