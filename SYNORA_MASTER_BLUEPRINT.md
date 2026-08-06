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
collapsed into `rejected`. Sharpened by the command layer's slice 13:
`isConfigured()` now means "is a REAL key present" — a generated
development placeholder reads as absent (`SecretsManager.hasReal`), so in a
credential-less deployment resolution honestly finds nothing instead of
selecting a real vendor and failing with a 401 dressed up as availability.

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

**Ten states, never blurred** — `completed`, `not-authorized`,
`unavailable`, `not-implemented`, `not-bound`, `waiting-approval`,
`needs-input`, `rejected`, `expired`, `failed`. `not-bound` exists as its own state
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

**Slice 6: two more bound, and two lies in the catalogue found by binding
them.** Binding is not busywork — it is the only thing that actually checks
whether a catalogue entry is true. Both defects had survived every test:

1. `approvals.waiting` claimed `GET /api/workspaces/:workspaceId/agents/runs/waiting`,
   **a route that has never existed in this repository**. `capabilities.ts`
   opens by saying a command layer's characteristic failure is confidently
   routing to a capability that was only ever a plan, and claims a test
   keeps it honest — but that test only checked the surface STRING SHAPE
   (`^(GET|POST|…) /api/`). The file's own stated discipline was not
   enforced. There is now a test that walks the REAL Express router; it was
   confirmed to fail on the original bug, naming the phantom surface,
   before the fix went in.
2. `activity.recent` declared `requiredPermission: 'audit:view'` when the
   activity feed is deliberately membership-only — `audit:view` gates the
   GOVERNANCE log, which that feed excludes by allowlist. It would have
   told ordinary members they lacked access to something they could use.

**One intent can cover two questions, and it used to answer the wrong one.**
"Monitor" means both "how are the AI providers behaving" and "what happened
in my workspace". Catalogue order alone decided, so one always won and the
other was unreachable — a confident answer to a question nobody asked,
which is the worst thing this layer can do. Routes may now carry a `hint`
claiming phrasings within their intent. Hints only PROMOTE: a sentence no
hint claims still resolves in catalogue order, so adding one can never make
a capability unreachable. Both properties are test-pinned.

**Slice 7: the declaration is now checked against reality, not against
itself.** Slice 6 fixed one wrong `requiredPermission` BY HAND and left the
same class of defect possible everywhere else — so this closes it.

**The circularity that hid it for four slices**: the command layer derives
its permission answer FROM the declaration. Asking the layer whether the
declaration is correct is asking it to agree with itself, and it always
will, however wrong the declaration is. Every test that touched
`activity.recent` did exactly that.

So the check probes the REAL services directly as a VIEWER — the least
privileged role — and compares what actually happens against what the
catalogue claims: declared `null` means a VIEWER must succeed; declared `P`
means a VIEWER must be refused. The probe table is a deliberate SECOND,
INDEPENDENT derivation of which service backs which capability. That looks
like duplication and is the opposite: a check that shares its source with
the thing it checks cannot detect that source being wrong. Two derivations
that must agree is the whole mechanism — the reason double-entry
bookkeeping has two columns.

Confirmed to fail on the real historical bug before the fix was restored.
Two vacuity guards, because this codebase's own lesson is that a green test
can prove the opposite of its claim: every bound capability must HAVE a
probe, and the probes must succeed for an OWNER (a probe that refused
everyone would otherwise satisfy the main assertion by accident).

**Scope stated, not implied**: only the 5 bound capabilities are probed,
because only those have an execution path a test can drive. The 7 unbound
ones remain unverified.

**Slice 9: why the remaining seven cannot be bound, and what to do about
it.** This began as "bind the rest" and changed once the code was read:

- `workflow.author` needs a full `steps` array — id, kind, description and
  input per step. A sentence does not contain that.
- `workflow.schedule` needs a workflowId; `agent.preview` needs an agentId.
- `tool.execute` needs input matching each tool's own JSON schema. Entity
  resolution would not fix this; the input is the blocker.
- `ai.generate` and `image.generate` need credentials this deployment lacks.

So all seven are unbindable for PRINCIPLED reasons. Forcing one would mean
inventing structure the sentence never contained — which is the fabrication
this codebase has spent weeks auditing out. The previous increment called
the workflow pair "the most mechanical remaining"; that was wrong, and
reading the schema is what corrected it.

**What shipped instead is the consequence, addressed.** `not-bound` was an
honest dead end: "Synora can do this, but not by being asked in plain
language" is true and leaves a person who asked for help with nowhere to
go. Every capability now names the page where they can do it themselves,
and the refusal carries a link.

**The destination is verified to exist.** A test walks the real Next app
router on disk, strips route groups exactly as Next does, and asserts every
claimed `appPath` is a page a person can open — confirmed to fail on a
deliberately broken path. It reads the frontend from the backend's suite,
which is deliberate: the claim is cross-boundary, and a check confined to
the side that makes the claim could never detect it being wrong. `appPath`
is null where no single page serves the capability, because a wrong
destination costs a click, a wait, and the belief that Synora knows its own
product.

**Slice 10: the resolution primitive, and the first capability bound
through it.** The world-building directive's rule — "if a dependency is
missing, build the dependency first" — applied to the blocker slice 9
named: services want ids, sentences name things loosely. `command/resolve.ts`
is a PURE, deterministic matcher (exact match → whole-word containment →
most-specific-wins tie-break) over candidates the caller fetched with a
workspace-scoped query, so it can never be where isolation leaks and never
needs a provider. THE RULE THAT MATTERS: not exactly one match → it NEVER
guesses. A wrong guess is a confident action on a record nobody named —
worse than any question.

A tenth state, `needs-input`, because every neighbour would lie: `failed`
blames a bug that does not exist, `not-implemented` slanders working code,
`completed` would make `executed: true` mean "I asked you something". The
question carries the CHOICES as data (capped in prose, listed in the
payload) so a person picks instead of retyping.

`agent.preview` is bound through it: "Preview what the Research agent
would do about competitor pricing" reaches the SAME planner, validation
and per-step checks the Agents page uses, and runs nothing. Ambiguity
("Digest" vs "Digest v2") resolves by specificity; naming nobody returns
the honest question with every agent listed.

**Slice 11: the authorization hole the next binding would have widened.**
Preparing to bind `workflow.schedule`, the slice-7 question — what does the
real surface enforce? — answered *membership only*: a VIEWER could author
workflows, schedules and triggers despite holding only `billing:view`. The
catalogue's `tool:manage` declaration was RIGHT and the routes were wrong —
the mirror image of the `activity.recent` defect, and the second time two
independent derivations disagreeing has been the alarm. Fixed with a
`requireWorkspacePermission` middleware on all 12 mutating routes,
membership answering first so outsiders keep the 404. Reads, runs and
dry-runs untouched. MEMBERs lose authoring they only ever had through the
hole; granting it back deliberately is a one-line permission change.

**Slice 12: recurring behaviour from a sentence, with nothing guessed.**
"Schedule the Daily Digest workflow every day at 9am Asia/Kolkata" creates
a real DST-correct schedule. The phrase parser is stricter than the
resolver because its output RECURS — a misread schedule fires wrong every
day — so every ambiguity is a question: no hour → asks; bare "at 9" → asks
am/pm; **no zone → asks, because the platform stores no timezone and a bare
"9am" is a guess about the person's clock**; weekly/monthly say plainly
they are not built. A workflow named "Hourly Report" does not imply hourly:
the name is stripped before cadence parsing. The authoritative check lives
in `createScheduleAuthorized` (membership + tool:manage + persist-before-
return), because the command path never touches slice 11's HTTP middleware
— and the permission probe drives exactly that surface.

**Slice 13: a placeholder is not a credential.** The secrets chain in
development/testing deliberately ends in a source that manufactures a
deterministic fake value for ANY key, so the app boots with zero real
secrets — but every provider's `isConfigured()` was implemented as "tryGet
returned something", which in those stages is ALWAYS true. So the
capabilities report showed providers as active with no credentials
anywhere, resolution selected a real vendor and called it with
`placeholder_…` (the 401-dressed-as-availability caveat carried since
slice 10), and three vector-DB connect paths handed the placeholder to
self-hosted instances as a fake auth token. Fixed at the root: the secrets
manager now answers two different questions — `tryGet()` for INTERNAL
secrets (JWT signing, DATABASE_URL), where a deterministic placeholder is
exactly what lets dev boot; `hasReal()`/`tryGetReal()` for EXTERNAL
credentials, where "a value resolves" and "we can authenticate" are
different claims. All 16 AI/embeddings descriptors, Pinecone, the SMTP
transport, the config provider flags, and Stripe converted — Stripe's
conversion DELETED the one place that had already answered this question
by re-generating the placeholder format and string-comparing, billing's
private duplicate of secrets internals (and it only checked one of the two
secrets). The declined read still audits as `access-placeholder`, so "why
does this provider say unconfigured?" is answerable from the trail. The
guard test runs descriptors against the REAL secrets manager in the
testing stage — exactly where the lie lived — and was proven to fail on
the old code before it was trusted. Removing the lie then exposed a ghost
coupling it had been hiding: `ConversationService.create` gated the
CONTAINER on the provider's `isConfigured()`, so with honesty in place,
"start a conversation" required a vendor key — 56 test failures, one root
line. Creation now validates only the data invariants (provider exists,
does text generation); the honest refusal lives at generation time, where
it always did. A conversation is a container, and a container needs no
vendor — that property is now test-pinned with an asserted precondition
so it cannot go vacuous.

**Slice 14: one sentence, several actions.** People do not speak in single
commands. `decompose.ts` splits a request into the actions it describes and
`plan.ts` resolves each one INDEPENDENTLY through the same `decideCommand` a
single command uses — same grammar, same catalogue, same permission model,
same ten states. A plan is not a privileged path; it is several ordinary
commands with an order between them, and the central security property is
that **a step inherits nothing from its neighbours**: being allowed to find
a document says nothing about being allowed to send it, and a planner that
decided entitlement once would let a harmless first step carry a dangerous
last one past the gate. The splitter's governing bias is to UNDER-split:
merging two actions is visible and harmless, while inventing an action means
Synora acts on its own fabrication — so "sales, marketing, and support"
stays one subject and only segments that independently read as actions
become steps. Dependencies come from back-references ("summarize IT"), so a
step that refers to nothing waits for nothing; a step whose input will never
exist is marked blocked rather than ready. The action-word lexicon
deliberately includes verbs Synora CANNOT perform (`send`, `delete`, `pay`)
— recognizing that an action was requested is a different question from
being able to do it, and absorbing an unroutable segment into its
neighbour's subject would make a step silently disappear. Nothing executes:
`executed: false` is a literal type on the response. Orchestration —
running steps in order, pausing at each approval, durable state — is the
next slice, because a plan nobody can read is not something to start
running.

**Slice 15: running a plan, durably.** `CommandPlan` + `CommandPlanStep`
tables and `run-plan.ts` execute a plan's steps in order — each through the
SAME `executeCommand` a single command uses, so every step re-derives its
capability, re-checks permission at the moment it runs, honours the approval
gate, and writes its own audit row correlated by `planId`/`planStepIndex`. A
plan orchestrates; it never becomes a second way to make something happen.
**Durable because plans pause**: a plan stops at an approval someone answers
tomorrow, and in-memory state would let a deploy silently discard work a
person is waiting on. **Stop honestly, do not push on**: execution halts at
the first step that does not complete and does not skip ahead to later
"independent" steps, because an unpredictable subset forces a person to
reconstruct what happened while a stop leaves one describable sentence.
Steps never reached are `skipped`, not `failed` — nothing was attempted, so
nothing broke. **Never retries**: no capability carries an idempotency key
yet, so a retry could create a second schedule; `safeToRetry` says plainly
whether asking again repeats anything, and is false the moment any step
completes. `partially-completed` is first-class, never collapsed into
`completed` or `failed`. Verified non-vacuously: injecting "push on past a
stop" fails exactly the three tests that assert it.

**Slice 16: a decided step resumes its plan.** Deciding a paused step now
continues the plan from the approval path itself, once the decision is
durably recorded — never before, because a resume that crashed must not be
able to lose the approval that authorised it. **An approval buys its own
step and nothing else**: every remaining step goes through `executeCommand`,
so a later step needing approval pauses the plan AGAIN (test-pinned), which
is the "approve once, act broadly" failure this layer exists to prevent. The
decided step is never re-run — it already ran inside the approval
transaction, and a person authorised it exactly once. The requester's
CURRENT role is re-fetched, never remembered: roles change while plans sit
in queues, and if the requester has left the workspace the remainder does
not run under anyone else's authority. A rejected step gives the plan status
`rejected`, distinct from `failed` — a person said no, nothing broke. A
failed resume never fails the approval, because reporting an authorised,
completed action as an error invites a repeat. **Two real defects found by
building it**: I first hardcoded the resumed role as OWNER — a privilege
escalation in my own code, caught and fixed before any test ran — and the
`not-bound` early return skipped the resume hook entirely, leaving a plan
step recorded as `waiting-approval` after its approval had been decided.
**Honest limit**: an approved step that then COMPLETES is not yet reachable
over HTTP, because every approval-requiring capability is unbound, so
approving one yields `not-bound` and the plan correctly stops. The resume
path is exercised directly against real stored plans until a sensitive
capability is bound.

**Slice 17: `tool.execute` bound — the approval chain closes.** The first
bound capability that acts OUTSIDE Synora, and the first reachable ONLY
through the approval gate. That combination completes the chain end-to-end:
a plan pauses on a tool step, a person approves through the real endpoint,
a real tool execution is created, and the plan resumes to completion. Slice
16's resume moves from "exercised directly" to "reachable by a real
request", which is what raises it from B to A. **A real grammar defect
found by binding, again**: `control` allowed only ONE word between "the"
and "tool", so "run the Alpha Deploy tool" — an ordinary sentence naming a
real multi-word tool — was answered `not-implemented`. Widened to a bounded
four, still anchored on the literal noun, with a test proving "run a report
on last quarter" is still not claimed. The slice-7 vacuity guard fired
correctly: binding demanded a permission probe, and the probe confirms the
real service refuses a VIEWER by its own `tool:execute` check rather than
by an HTTP route the command path never touches. Built directly from the
three contract findings below, which were recorded BEFORE any code was
written rather than discovered halfway through:

1. **Tools carry their OWN `requiresApproval` flag.** A command-layer
   approval can therefore produce a tool execution that is still `PENDING`
   on a SECOND, tool-level approval. Two independent gates is correct — the
   command layer asks "may this person ask for this", the tool asks "may
   this particular tool run" — but the outcome must never let "you approved
   it" read as "it ran". A person who approved something and later finds it
   never happened has been misled by a system that was technically correct.
2. **Execution is asynchronous** (`runAsync`). The command layer would learn
   that a tool STARTED, never that it succeeded. So the honest summary is
   "started", and `completed` here must mean "the execution was really
   created", worded so nobody reads it as "the tool did its job".
3. **Tools have an `inputSchema` with required fields**, and a sentence
   carries no structured input. Most real tools would therefore honestly
   answer `needs-input` rather than run — which is the correct answer, not a
   shortfall, and it means binding this capability delivers less immediate
   reach than it appears to.

This is the one capability that acts OUTSIDE Synora, so it got the design
pass rather than the quick pass — and all three facts survived contact with
the implementation: the tool's own approval gate means the message leads
with "has NOT run yet" and `result.finished` is literally `false`; the
async runner means the summary says *started*, never succeeded; and a tool
with required fields is asked about by name rather than handed an invented
payload. Test hermeticity is stated rather than assumed: every tool in the
binding tests sets `requiresApproval`, so no test fires a real webhook — a
test that reached a third party to prove an authorization rule would be
doing outside Synora exactly what it is checking inside. The immediate-run
branch is therefore exercised in production, not in the suite.

**Slice 19: undo — the risk class stops being an adjective.** From slice 3
onward `reversible` was a class the layer REASONED with: it is why creating
a conversation runs without an approval gate, and the whole approval policy
leans on it. Nothing in the system could actually reverse anything, so the
word described what a person could go and do by hand somewhere else, wearing
the costume of a property of the action. That is precisely the shape of
thing this project keeps refusing to ship, and it had been sitting inside
the layer's own vocabulary.

Four rules the implementation is built around, each guarding a way undo
could be worse than no undo:

1. **The target is declared, never guessed.** The executor that performed
   the work names what would reverse it, at the moment it performs it, and
   that is what gets stored (`undoKind`, `undoTargetId`). Undo never infers
   a target from a capability id or parses one back out of the summary
   prose. A wrong guess here deletes the wrong thing.
2. **Permission is re-checked at undo time**, through the same service-level
   checks the original action went through — `conversationService.delete`
   enforces `conversation:manage`, and a new `deleteScheduleAuthorized`
   enforces `tool:manage` for a command path that never travels through the
   HTTP middleware. Having once been allowed to create something is not
   standing permission to remove it later.
3. **Once, and only once.** The reversal is claimed with a conditional
   update, and a second attempt is refused rather than quietly repeated.
4. **Not available for everything.** Most actions cannot be reversed, and
   the answer says so plainly. The UI offers the button ONLY when the server
   declared that particular execution undoable — never from the risk class,
   which would put a button on things Synora cannot reverse.

**Reverse first, record second** — deliberately the opposite of the approval
path's order, and chosen by asking which lie a crash in the middle leaves
behind. Record-then-reverse would leave a record claiming "undone" for
something still there and would refuse every later attempt to fix it;
reverse-then-record leaves a record saying "not undone" for something
already gone, and a retry costs at most a second reversal that is a no-op.
A stale "not yet" is recoverable; a false "already done" is not.

**A real pre-existing bug found by building this**: `deleteSchedule` removed
only the in-memory entry, while creation had written the schedule to the
durable store — so `hydrateSchedules` brought every deleted schedule back on
the next restart. Silently, because nobody watches for the return of
something they already deleted. The HTTP delete route had the same bug. Both
are fixed at the source, with a regression test that persists, deletes,
restarts and asserts nothing comes back.

**Slice 20: every answer reaches a person who cannot see it.** The first
work under the standing rule that all input and output paths resolve
through ONE architecture rather than a parallel one per method — and the
first place that rule was being broken was not an input at all. The command
page promises "Synora tells you exactly what it did, or exactly why it did
not", and every answer was inserted silently into the page. Someone using a
screen reader pressed "Do it", focus stayed in the box, and nothing was
announced. The layer keeps ten outcomes rigorously distinct and then
delivered them in a form one class of user could not perceive, which throws
the whole discipline away at the last step exactly as a green tick and a red
cross would.

`CommandAnnouncer` is a polite live region, mounted from first render — a
region that appears at the same moment as its content is not announced at
all, which is the standard way to build one that never speaks. It composes
no new prose: the state label comes from the same map the visible card uses
and the reason is the server's sentence verbatim, so there is no second
wording to drift in front of the one person who cannot check it against the
screen.

**A founder decision is attached to the REST of this axis.** Voice input is
the obvious next door, and it cannot be opened purely as engineering. The
browser's own speech recognition is the only credential-free option, and in
most browsers it works by **sending the captured audio to the browser
vendor's servers**. For a platform that stores customers' work, that is a
data-egress decision, not an implementation detail, and shipping it quietly
would be precisely the kind of unstated behaviour this project refuses. The
options and the recommendation are in the brief; nothing voice-related will
be built until that is answered.

**Not yet built**: no voice input path, no learned personalization, undo
covers only the two capabilities that create something reversible
(conversations and schedules), and there is no way to approve a paused plan
step from the plan view itself (the approvals panel below it is where that
happens).
Bound: search,
conversation-create, provider-metrics, approvals-waiting, activity-recent,
agent-preview and workflow-schedule; the rest honestly report `not-bound`
and say where to go. The
approvals answer states what it counted (`agent runs and commands; not tool
executions`) rather than implying it covers everything. Self-approval is
permitted — the gate is a deliberate pause and a record, NOT four-eyes
separation of duties, and requiring a second person would break
single-owner workspaces.

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
