# Synora — Learning

Concepts you meet while building Synora, explained plainly, each with a real
example from this repository.

This is not a textbook and not a manual. It exists so that the decisions in
`SYNORA_MASTER_BLUEPRINT.md` and the procedures in `SYNORA_OPERATIONS.md`
stop feeling like magic. Read a section when you hit the thing it describes.

---

## Git: history and your files are two different things

Git tracks **commits** (saved snapshots, permanent) and your **working files**
(what you are editing right now, unsaved). Confusing the two causes most git
panic.

**Synora example.** Two Claude environments worked on this repository. One
committed and pushed six changes; this laptop kept editing files without
committing. It looked like the versions had conflicted. They hadn't — one had
simply moved ahead while the other edited. Nothing was lost.

**A branch is a name for a snapshot.** Before merging, your uncommitted work
was committed to `founder-wip/pre-reconcile-2026-08-10`. That name is a
permanent handle: whatever happens next, that exact state can be returned to.

**Why not "stash".** Git has a `stash` for temporary work, but it's a loose
pile with no names, easy to lose. A branch is a labelled shelf. When work
matters, put it on a shelf.

**Force-push rewrites published history** — it can delete work someone else
already has. Synora never does it.

---

## What an API actually is

An API is a list of things a program will do when asked, and the exact shape
of the asking. That's all.

**Synora example.** The backend offers `/health` and `/ready`. Ask `/health`
and it says "I'm running". Ask `/ready` and it says "I'm running *and* I can
reach my database and Redis". Two questions, deliberately separate, because
"alive" and "able to work" fail differently — and knowing which one broke is
half the diagnosis.

---

## Databases and Redis: permanent memory vs scratch memory

**PostgreSQL** is permanent. Written to disk, survives restarts. Accounts,
conversations, spending records.

**Redis** is fast and temporary. Lives in RAM. A queue of jobs waiting to run.

**Synora example, and it mattered.** Two versions of the spending guard
existed. One tracked your daily AI spend in memory; the other wrote it to
PostgreSQL. Memory-only looks identical until the server restarts — and then
the daily total resets to zero and the cap can be spent again. The database
version was kept.

**Rule of thumb:** if forgetting it costs money or safety, it goes in the
database.

---

## Environment variables: settings that live outside the code

Code says *what* to do. Environment variables say *which* database, *which*
domain, *which* key. Same code, different settings, different environment.

**Why secrets go here and never in code:** code gets committed, published, and
copied. `apps/backend/.env.local` is git-ignored — deliberately invisible to
git, so it cannot be committed by accident.

**Synora example.** `NEXT_PUBLIC_` variables are shipped to the browser and
readable by anyone. Everything else stays on the server. That prefix is a
promise: never put a secret behind it.

---

## Fail closed

When a safety system cannot do its job, it can fail **open** (allow and hope)
or **closed** (refuse). Money and access fail closed.

**Synora example.** If Synora doesn't know a model's price and you've set a
spending cap, it must not treat the cost as zero — zero means the cap never
triggers and the bill is unlimited. So an unknown price is *reported as
unknown*, never as free.

The same instinct appears throughout: the realtime layer now **refuses to
start** if it can't read its allowed-origins setting, rather than quietly
defaulting to something that works on a laptop and fails in production.

---

## Provider abstraction: why Synora isn't locked to one AI company

Synora never calls an AI company directly. It calls its own interface, and an
**adapter** translates for each provider.

**Synora example.** Your router is configured through generic settings —
`SELF_HOSTED_TEXT_BASE_URL`, `_API_KEY`, `_MODEL`. Nothing in the business
logic knows the vendor's name. Switching providers is editing a settings file,
not rewriting the product. This is why the code deliberately avoids naming any
vendor.

---

## Model identifiers, and why they bite

Every AI model has a technical name, and **there is no industry standard for
what it looks like**.

**Synora example — a real bug.** Anthropic's own API says `claude-sonnet-5`.
Your router presents the same model as `Claude Sonnet 5`. Same model, same
price, different punctuation. Synora's price list was keyed one way and your
router spoke the other, so Synora couldn't price its own default model — and
with your spending caps on, an unpriceable model can be refused outright.

The fix normalises spelling. It deliberately does **not** guess: `Claude Opus
4.8` stays "unknown" rather than being priced as `claude-opus-4`, because
silently billing one model at another's rate is the exact failure the cap
exists to prevent.

**The lesson underneath:** I diagnosed this wrong at first, confidently. One
read-only call to the router settled it in seconds. When a system can be
asked, ask it — a plausible theory is not evidence.

---

## Tokens: how AI usage is measured and billed

Models read and write **tokens** — roughly ¾ of a word each. You pay per
token, and output usually costs several times more than input.

**Synora example.** Cost is calculated from input and output tokens
separately, at different rates. Your caps (`AI_GLOBAL_MAX_COST_PER_DAY_CENTS`,
`AI_USER_MAX_COST_PER_DAY_CENTS`) are checked **before** a request runs, so an
over-budget request never reaches the provider — refusing after the fact would
mean paying for the thing you refused.

---

## Reasoning models can produce nothing at all

Some models "think" before answering, and that thinking consumes the same
budget as the answer. Run out mid-thought and the reply is **empty but
technically successful**.

**Synora example.** An empty answer with a success status would have been
stored and shown as a real reply. Synora now treats it as the failure it is.
Note the shape of the bug: *the request succeeded, the response was well-formed
— and the content was worthless.* Status codes describe transport, not meaning.

---

## Docker: shipping the whole kitchen

A container packages an application *with* everything it needs. The same
container runs identically on your laptop and the server, which removes "works
on my machine".

**Synora example, honestly.** Docker isn't installed on your laptop, so the
database-backed tests can't run locally. That is why they're reported `NOT
VERIFIED` rather than counted as passing. This distinction matters more than
it sounds: quietly converting "didn't run" into "passed" is how untested code
reaches production.

---

## Reverse proxy and HTTPS

A **reverse proxy** is the single front door. Everything from the internet
arrives there and it decides what goes where — website to the frontend, `/api`
to the backend. Your database and Redis are never exposed at all.

**HTTPS** encrypts traffic so it can't be read in transit. It needs a
certificate proving you control the domain — which is why HTTPS is set up
*before* DNS is switched: the certificate must be ready before visitors
arrive.

---

## DNS: the internet's phone book

DNS turns `trysynora.com` into an IP address. Changing it is like updating a
public directory listing — it takes time to spread, and everyone sees the
result.

**Synora example.** `trysynora.com` currently points at Hostinger's shared
hosting, which is why you see a placeholder. Switching it to `200.234.32.93`
is the final launch step — done last, deliberately, because until then a
failed deployment breaks nothing that's currently working. Rollback is
restoring the old addresses, which is why they're written down in
`SYNORA_OPERATIONS.md` before anything changes.

---

## Dependencies: the code you didn't write

Synora uses ~1,000 packages written by other people. Each is useful and each
is a liability — a flaw in any of them is a flaw in Synora.

**Synora example.** A vulnerability was found in `nanoid`, a package you never
chose (Next.js pulled it in). The first attempted fix jumped it to a new major
version, which would have broken the package that depends on it. The correct
fix pinned it to the smallest patched version in the same series.

**Two lessons.** *Upgrade narrowly* — the smallest change that fixes it.
And: the first audit reported one vulnerability because only part of the
output was read; reading all of it found six. Truncated output lies.

---

## Why "it runs" is not "it works"

A running application proves the code starts. It doesn't prove login is
secure, spending caps hold, or one customer can't read another's data.

**Synora example.** Verification here means: does the code compile, do the
tests pass, do the *failure* paths behave, are there known vulnerabilities, do
secrets stay out of the browser bundle. And when a check can't run, it's
labelled `NOT VERIFIED` — never quietly upgraded to `PASS`.

The most valuable tests describe what must *never* happen: an unpriced model
must never cost zero; a version number must never collapse onto a cheaper
model's price. Those tests are checked by breaking the code on purpose and
confirming they fail — a test that passes against broken code is worse than no
test, because it manufactures confidence.
