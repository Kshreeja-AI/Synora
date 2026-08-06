# Synora Intelligence Architecture

**Status**: foundation started 2026-08-06. One component implemented.
**Governing rule**: this document may only describe what exists. Future work
is in the clearly-marked sections at the end and is never written in the
present tense.

---

## What this is, and what it is not

Synora's Universal Command Layer is the **action nervous system**: a person
says what they want, and it is understood, authorised, planned, approved,
executed, recorded and reversed. That layer is real and largely complete.

The Intelligence Layer is the part that lets Synora **get better from what
happened**. It is barely begun.

**Synora does not have its own trained model, and nothing in this document
should be read as claiming otherwise.** The distinction the platform holds
itself to:

| | |
|---|---|
| Synora behavioral rules | **exists** — `intelligence/behavior-rules.ts` |
| Synora intelligence architecture | **partial** — this document; kernel not built |
| Memory and experience system | **memory exists**; experience record does not |
| Evaluation and learning system | **evaluation partial**; learning absent |
| Model/provider abstraction | **exists** — `ai/registry.ts`, `ai/resolver.ts` |
| Local/self-hosted model capability | **adapter implemented** (`ai/providers/ollama.provider.ts`, tested, keyless, off by default); no model installed yet |
| A Synora-trained model | **does not exist** |
| Model-training infrastructure | **schema and registry exist; no training** |

A model used by Synora is not "Synora's model". A prompt wrapper is not a
model. A rules engine is not a model. Nothing may be called the Synora Model
until it has: a version, dataset provenance, evaluation results, a safety
evaluation, an artifact identity, an inference interface, rollback, and
ownership metadata.

---

## The kernel's eight verbs, and where each stands

```
EXPERIENCE (text ▸ voice ▸ API)
        │
        ▼
┌─ SYNORA INTELLIGENCE KERNEL ─────────────────────────────────┐
│  UNDERSTAND   command/understand ▸ decompose ▸ resolve        │ EXISTS
│  MEMORIZE     memory.service + 6 siblings ▸ pgvector          │ EXISTS
│  REASON       —                                               │ MISSING
│  PLAN         command/plan ▸ run-plan ▸ CommandPlan(+Step)    │ EXISTS
│  ACT          command/execute ▸ approve ▸ undo                │ EXISTS
│  OBSERVE      eos/* (44 modules) ▸ CommandExecution           │ EXISTS
│  EVALUATE     evaluation.service ▸ eos judges/graders         │ PARTIAL
│  LEARN        —                                               │ MISSING
└───────────────────────────────────────────────────────────────┘
```

There is deliberately **no second command path**. Everything the intelligence
layer eventually does converges on the existing Universal Command Layer.

---

## Implemented: the Behavior Rule Registry

`apps/backend/src/intelligence/behavior-rules.ts`

Twenty slices of work produced a consistent set of principles — never claim
an unverified success, never let a missing credential read as a missing
capability, re-check permission on the path that actually executes. All of
them lived **only as prose in code comments**. Prose cannot be queried,
versioned, or evaluated against, and it cannot tell you when it has quietly
stopped being true.

The registry gives each rule a stable id, a statement, a rationale, a scope,
a severity, a version, the slice it came from, and a **provenance link to the
tests that prove it**.

### It does not enforce anything by existing

Enforcement lives where it always did — in the code paths and the tests that
pin them. What this adds is the ability to *reason about* the behaviour: to
ask which rules exist, which are proven, and later, whether a given
interaction violated one.

### The property that makes it non-fakeable

A rule may be marked `enforced` **only if it names at least one test file
that really exists on disk**, and a test asserts exactly that. Without that
check the file would decay into a wish list in which every entry reads like
a guarantee.

This is not theoretical. The first provenance path written into the registry
was wrong — `secrets/__tests__/credentialHonesty.test.ts` when the file is
in `ai/__tests__/`. The filesystem check caught it before the rule shipped.

Three statuses, kept separate on purpose:

- **enforced** — a named test would fail if the system stopped upholding it.
- **advisory** — held to by convention and visible in review, but nothing
  would fail. An honest "we mean this and have not pinned it".
- **aspirational** — a commitment for behaviour that does not exist yet.
  Recorded so it is not forgotten, and explicitly not a guarantee.

Coverage is reported as **three counts, never a percentage**. A single
"behavioural compliance" score would be read as a grade and immediately
optimised, and it would destroy the only information the split carries.

### Current contents

12 enforced, 2 advisory, 1 aspirational.

`SB-015` (learning never silently changes production behaviour) is
aspirational and was written **before** the thing it constrains exists —
deliberately, so the constraint is not retrofitted onto a pipeline that has
already shipped without it.

---

## Implemented: capability availability says what is actually missing

`apps/backend/src/command/availability.ts`

The catalogue answered "why can't Synora do this here?" with two values, so
every unavailable capability produced one sentence — *"needs a provider
credential configured"*. For text generation that was wrong in the way that
matters: answering a question needs a **model**, and a local model serves it
as well as a bought one. Telling someone an administrator must configure a
credential hides the path that needs no vendor, no account and no money —
the path this platform intends to make ordinary.

`needs-model` is now its own value, and `ai.generate` carries it. Sending an
invitation stays `needs-credentials`, because SMTP has no local substitute.
Same word before, different worlds.

**Only values with a real capability behind them exist.** The directive lists
a longer vocabulary — infrastructure required, training required, and others.
Nothing in the catalogue is blocked by those today, and an enum member
nothing produces is a value no test can exercise and no reader can trust.
They are absent, and a test pins the set of values actually in use, so a
future slice adding one must add a capability that uses it.

**A regression this nearly shipped.** `understandCommand` filtered for the
literal `'needs-credentials'` when listing what cannot run. Reclassifying
`ai.generate` would have silently dropped it from that list, and a person
asking for text generation would have been told nothing was wrong right up
until it failed. All six availability checks now go through one
`isRunnableHere` helper so the next widening cannot repeat it.

---

## Reused, not rebuilt

The audit found substantially more prior art than expected. None of it was
duplicated:

- **Training foundation** — `Dataset`, `DatasetVersion`, `DatasetSample`,
  `DatasetLabel`, `DatasetSplit`, `EvaluationRun`, `EvaluationResult`,
  `BenchmarkRun`, `BenchmarkMetric`, `ModelRegistry`, `ModelVersion` all
  exist in Prisma with services, and are **mounted and reachable**.
- **Consent** — `TrainingConsent` and `privacyConsent.service.ts` exist, and
  `canUseForTraining` correctly defaults to `false`.
- **Observability** — `eos/` is 44 modules covering latency, cost, provider
  degradation, prompt outcomes, judges, graders, benchmarks and gates.
- **Provider abstraction** — `ai/registry.ts` and `ai/resolver.ts` already
  keep the business layer free of any vendor name.
- **Memory** — seven services plus pgvector, workspace-scoped, GDPR erasure.

---

## Known gaps, stated plainly

1. **No kernel object.** The eight verbs are implemented as separate modules
   with no stable interface binding them. `REASON` and `LEARN` have nothing
   behind them at all.
2. **No experience record.** `CommandExecution` is the closest thing and is a
   genuine proto-version, but it carries no ambiguity, clarification, user
   correction, confidence, latency, cost, model identity, evaluation result,
   privacy class or retention class.
3. ~~**No capability-status vocabulary.**~~ **Partly addressed.** See
   "Implemented: capability availability" below. The values with no real
   capability behind them are still deliberately absent.
4. **No learning pipeline.** Nothing converts experience into a candidate,
   evaluates it, versions it, or deploys it. `SB-015` constrains a thing that
   is not there yet.
5. **No local model RUNNING.** The adapter exists — the launch audit
   corrected this document's earlier claim that it did not
   (`ollama.provider.ts`, registered and tested, activated by
   `OLLAMA_BASE_URL`). What is missing is an installed Ollama and a pulled
   model. Until then, natural language beyond the fixed grammar cannot be
   served, and the system says so rather than pretending.

---

## What runs with nothing configured

Synora starts and works with no external provider, no credential, no cloud
and no GPU. Specifically: workspaces, conversations, the whole command layer
(understand ▸ plan ▸ authorise ▸ approve ▸ execute ▸ undo), scheduling,
permissions, memory storage, workflows, audit, capability reporting, the
evaluation harness, the dataset and model registries, and this rule registry.

What genuinely needs a model says **"local model required"** rather than
degrading into a guess.

---

## Planned, in dependency order — not yet built

Written as future work on purpose. None of this exists.

1. **Experience record** — extend the `CommandExecution` lineage into a full
   experience, including privacy and retention classification. The
   availability vocabulary it needed now exists.
2. **Rule evaluation** — answer "did this interaction violate a rule?"
   against the registry. Depends on 1.
3. **Kernel interface** — the stable eight-verb surface over the existing
   modules. Depends on 1 and 2.
4. **Learning pipeline** — experience → normalisation → consent check →
   evaluation → candidate → review → versioned deployment. Depends on all
   of the above, and is governed by `SB-015` before a line of it is written.
5. **Local model activation** — the adapter exists; this slice is installing
   Ollama, pulling an evaluated model, and verifying generation end-to-end.
   No business logic changes.
