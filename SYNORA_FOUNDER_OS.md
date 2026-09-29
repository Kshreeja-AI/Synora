# Synora — Founder Operating System

How decisions get made, how work gets verified, and what Synora refuses to
fool itself about.

This is not motivation and not strategy. It is an operating discipline: a set
of defaults that make the *cheap* path and the *correct* path the same path.

Three documents describe Synora. This one describes how Synora is built:

| Document | Answers |
|---|---|
| `SYNORA_MASTER_BLUEPRINT.md` | What Synora is, how it is architected |
| `SYNORA_OPERATIONS.md` | How to run, deploy and recover it |
| `SYNORA_LEARNING.md` | The engineering concepts, explained plainly |
| **this file** | **How decisions and verification work** |

`CLAUDE.md` carries the machine-readable form of Part VI for AI sessions.

---

# Part I — Operating principles

1. **Evidence before assumption.**
2. **Reality before narrative.**
3. **Architecture before features.**
4. **Verification before confidence.**
5. **Reversibility before irreversible action.**
6. **Security before convenience.**
7. **User value before technical vanity.**
8. **Long-term leverage before short-term hacks.**
9. **Simplicity before unnecessary complexity.**
10. **Provider independence before provider lock-in.**
11. **Measurement before opinion.**
12. **Explicit uncertainty before false certainty.**
13. **Failure found early is progress**, not a setback.
14. **A limitation is information, not humiliation.** "I could not verify this"
    is a useful engineering output.
15. **Never hide an incomplete verification state.**
16. **Never call something production-ready without production evidence.**
17. **Never rebuild working infrastructure out of impatience.**
18. **Never add complexity because a competitor has it.**
19. **Never confuse ambition with evidence.**
20. **Never let fear of being behind decide architecture.**

### The attention rule

> **The founder does not need to know everything.
> The founder must know what must be verified.**

Founder attention is the scarcest resource in the project. It belongs on
decisions nobody else can make:

- product direction and what problem Synora solves
- user outcomes and who is served first
- capital allocation and risk tolerance
- partnerships and market positioning
- ethical boundaries
- final irreversible decisions — DNS, production data, spending, ownership

Everything else is automated, documented, or delegated. If the founder is
copying values between files or interpreting a stack trace, the system has
failed, not the founder.

### What this is not

This document does not claim the founder is already an expert, and building an
identity on borrowed confidence is worse than having none — it makes you
unfalsifiable to yourself. The aim is narrower and more useful: **calm under
uncertainty, aggressive about evidence, patient about architecture, fast about
experiments, uncompromising about security, willing to be wrong.**

Build evidence until confidence becomes unnecessary.

---

# Part II — Decision map

Replacement patterns. The left column is not stupidity — it is the natural
default. The right column is the discipline.

| Instead of | Ask |
|---|---|
| "I think this should work." | "What evidence would prove it works?" |
| "Claude said it's finished." | "What test, artifact, or runtime behaviour proves completion?" |
| "The provider probably calls the model X." | "Ask the provider what it calls the model." |
| "Deployment configuration exists." | "Has a deployment actually been executed?" |
| "The backup service exists." | "Has a backup been created, restored, and stored off the machine?" |
| "We can fix it later." | "Is this debt intentional, documented, bounded and safe?" |
| "We need this competitor feature." | "What user problem is this, and why should Synora solve it differently?" |
| "AI will figure it out." | "What capability, permission, data and verification loop does it actually have?" |
| "Future Synora will train its own model." | "What architecture today lets a future model replace the provider without touching business logic?" |
| "This is impossible." | "Which specific constraint makes it impossible, and can that constraint change?" |
| "I need to build everything." | "What is the smallest durable capability that creates the next option?" |
| "The tests passed." | "Did the tests run? Would they fail if the code were wrong?" |
| "The scan is green." | "What does this scan not look at?" |

---

# Part III — Behaviour map

### Major decisions

```
STOP → DEFINE → VERIFY → COMPARE → DECIDE → DOCUMENT → EXECUTE → VERIFY AGAIN
```

The second verification is not redundant. The first proves the decision was
sound; the second proves the execution matched the decision.

### Engineering tasks

```
UNDERSTAND → INSPECT EXISTING → IDENTIFY REUSE → DEFINE BOUNDARY
          → IMPLEMENT → TEST → SECURITY REVIEW → OBSERVE → DOCUMENT
          → only then DECLARE COMPLETE
```

`INSPECT EXISTING` before `IMPLEMENT` is the step most often skipped and the
most expensive to skip: it is how two implementations of the same feature come
to exist.

### Failures

```
DETECT → CONTAIN → MEASURE → ROOT CAUSE → FIX → REGRESSION TEST
       → DOCUMENT LESSON → CONTINUE
```

**Never respond to a failure with "just try again"** before classifying it.
A failure is one of: code, configuration, infrastructure, credentials,
environment, provider, network, data, test harness, assumption, or human
decision. Retrying without classifying only tells you whether it is
intermittent — which is the least useful fact about it.

### The correction loop

```
OBSERVATION → HYPOTHESIS → EXPERIMENT → EVIDENCE → DECISION
            → IMPLEMENTATION → VERIFICATION → MEMORY
```

The goal is not to avoid mistakes. It is to make the *same* mistake
unrepeatable. A correction that leaves no lesson behind will be paid for
again.

---

# Part IV — Status ladder

Every claim about Synora sits on exactly one rung. Never skip a rung, and
never let a word from a higher rung describe a lower one.

| State | Means |
|---|---|
| `UNKNOWN` | Not investigated |
| `PLANNED` | Decided, not built |
| `IMPLEMENTED` | Code exists |
| `TESTED` | Automated tests cover it and pass |
| `VERIFIED` | Proven correct in a realistic environment |
| `DEPLOYED` | Running in production |
| `OBSERVED` | Running, with telemetry confirming behaviour |
| `PROVEN` | Observed long enough, including under failure |

The gaps that cause outages:

- **"Configured" is not "Verified."** A compose file is a description of an
  intention.
- **"Verified locally" is not "Production proven."** Your laptop is not the
  server.
- **"Deployed" is not "Healthy."** Started is not serving.
- **"Healthy" is not "Successful."** Serving is not valuable.

When a check cannot run, its status is `NOT VERIFIED` — a distinct outcome
from `PASS` and from `FAIL`. Converting "did not run" into "passed" is the
single most dangerous move available in this project, because it manufactures
confidence at exactly the point where evidence is missing.

---

# Part V — Engineering lessons (living memory)

Append here whenever a correction produces a transferable lesson. Each entry
records what was believed, what was true, and what to do differently.

### 1. Never assume a provider's model identifiers — ask the provider
**Believed:** the router's model was `Claude Sonnet 5`, a display name needing
conversion to `claude-sonnet-5`.
**True:** the router's real identifiers *are* display-style. The founder's
configuration was already correct; Synora's price table was the thing that was
wrong.
**Do:** query `/models` before theorising. One read-only call outranked a
confident diagnosis.

### 2. A configuration is not a behaviour
A `docker-compose.yml` describes intent. Until it runs, nothing is known.

### 3. A backup service is not a backup
Synora defines a daily `pg_dump`. It has never executed, and it writes to the
same disk as the database it protects. **A backup nobody has restored is a
hope.**

### 4. Deployment configuration looking correct proves nothing
Only an executed deployment proves a deployment works.

### 5. A local test limitation is not a code failure
Database tests could not run because Docker was absent. That is an environment
gap, and reporting it as a code failure would have sent work in the wrong
direction.

### 6. …and it is not a passing test either
It is `NOT VERIFIED`. Both errors are available; both are wrong.

### 7. Never silently change founder configuration on an assumption
The instinct to "fix" `SELF_HOSTED_TEXT_MODEL` would have broken a correct
setting. Verify the assumption first, then fix the thing that is actually
wrong.

### 8. Never expose secrets while debugging
Verify by metadata: presence, length, format, authentication result. Never the
value. A secret printed once for convenience is a secret that has leaked.

### 9. An exposed credential is spent
Rotate it. Deleting it at the issuer is what revokes it; replacing your local
copy alone leaves the old one working for whoever has it.

### 10. Preserve information before deleting its container
99 documents were removed only after their content had an authoritative home.

### 11. Reconcile rival documents on evidence, not convenience
Two files named `SYNORA_MASTER_BLUEPRINT.md` shared *zero* sections — one was
direction, one was as-built. Picking either would have destroyed half the
truth. The same applied to two rival spend-guard implementations: the union was
correct, not the choice.

### 12. Prefer a capability abstraction to a provider-specific implementation
Business logic must not learn a vendor's name.

### 13. A display name is not a technical identifier
And there is no cross-vendor convention for either.

### 14. A green scan is not security
Static checks do not observe runtime behaviour. SSRF is currently `NOT
VERIFIED` despite every scan passing.

### 15. A clean dashboard is not operational evidence
### 16. Truncated output lies
An audit "found 1 vulnerability" because only the first 3,000 characters were
read. Reading all of it found 6. Never conclude from a truncated read.

### 17. Upgrade narrowly
A vulnerability fix that jumped `nanoid` from 3.x to 6.x would have broken the
package depending on it. The correct fix was the smallest patched version in
the same major line.

### 18. In-memory state is not a limit
A spend cap held in memory resets on restart, and the cap can be spent again.
If forgetting it costs money or safety, it belongs in the database.

### 19. A fallback default is a landmine
`process.env.X || 'localhost'` works forever in development and fails only in
production. Realtime CORS read a variable nothing set, so the fallback always
won. Prefer failing loudly at boot over guessing quietly.

### 20. Success status does not mean success
A reasoning model can return HTTP 200 with empty content. The request
succeeded; the answer did not exist. Status codes describe transport, not
meaning.

---

# Part VI — Founder decision boundary

Work proceeds autonomously when it is **technical and reversible**. It stops
only for these:

| Stop for | Because |
|---|---|
| DNS changes | Publicly visible, affects live traffic |
| Production data deletion or reset | Irreversible |
| Spending money | Founder's capital |
| Rotating an externally-issued credential | Only the issuer can |
| Entering a credential | Only the founder holds it |
| Weakening a security control | Needs an explicit accepted risk |
| Permanent provider lock-in | Forecloses future options |
| Destroying infrastructure | Irreversible |
| Unclear legal or ethical boundary | Not an engineering question |
| Safety-critical physical action | Requires human authorisation |

Work does **not** stop merely because a credential is missing, a provider is
unchosen, hardware does not exist, or CI is unavailable — those are designed
behind interfaces and verified later. Waiting is not caution when there is
independent work available.
