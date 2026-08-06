# Synora — Founder Intake (one consolidated list)

Everything Synora genuinely needs from you, in one place, so you can prepare
it once. Nothing here is assumed to exist. Nothing is requested twice.

**Rule of this document**: if an item is not listed, do not buy it and do
not create an account for it. If a future slice needs something new, this
file is updated first.

**Security**: never paste any secret into chat, a document, or a source
file. Each value goes into the local `.env.local` (git-ignored) exactly as
named below. `.env.example` carries placeholders only.

---

## 1. Required for local development

**Nothing.** Local Postgres, Redis, generated `JWT_SECRET`, console mailer
and filesystem storage already cover it. Cost: $0.

## 2. Required for the Anthropic MVP — exactly one item

| | |
|---|---|
| Credential | Anthropic API key |
| Environment variable | `ANTHROPIC_API_KEY` |
| Purpose | real text generation through the existing, tested adapter |
| Required for | `ai.generate` and chat answering with a hosted model |
| Required at launch? | for AI answers, yes (or use item 4 instead — they are alternatives) |
| Local alternative? | **yes — item 4 (Ollama), free** |
| Paid? | yes, usage-based; **buy prepaid credits** (minimum ~$5) rather than attaching an uncapped card |
| Where it comes from | console.anthropic.com → API keys |
| Sensitivity | high — anyone holding it can spend your money |
| Rotatable? | yes, from the same console |
| Omittable initially? | yes — Synora runs fully without it and says "needs a language model" honestly |

> **Sequencing note**: I will build spend caps (readiness doc, N.1) **before**
> asking you to set this key. Do not set it early; an uncapped key in a
> public-facing app is the one genuinely dangerous item on this page.
> Optional companion: `ANTHROPIC_MODEL` (non-secret, defaults sensibly).

## 3. Required for a public MVP (Profile B)

| Item | Env var / form | Why | Cost | Omittable? |
|---|---|---|---|---|
| Small VPS | SSH access you create | host the existing Docker image publicly | ~$4–6/mo | yes, until you want public users |
| Domain | registrar account (no env var) | HTTPS + a real address | ~$10–12/yr | yes, same |
| SMTP credentials | `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | invitation + verification email | free tier exists (~100/day) | yes — invites can wait; console mailer covers dev |
| Production secrets | `JWT_SECRET`, `NEXTAUTH_SECRET` (fresh, generated) | never reuse dev secrets in production | $0 | no, but I generate them — you store them |

Explicitly **not** required for MVP: managed database, managed Redis, object
storage, CDN, payment processor, monitoring SaaS, Kubernetes, GitHub paid
plans, Supabase paid plans.

## 4. Required for the open-source local model — no credential at all

| | |
|---|---|
| FOUNDER ACTION | install **Ollama** (free, ollama.com) on the dev machine and run `ollama pull <model>` — I will name the exact model in the model-selection slice, chosen by licence/RAM/quality per directive §11, sized to run on a normal laptop (3–8B, quantised) |
| Environment variable | `OLLAMA_BASE_URL=http://localhost:11434/v1` (+ optional `OLLAMA_MODEL`) |
| Paid? | **no** |
| Why | the adapter is already built and tested; this is the entire missing piece for local AI answers |
| Omittable? | yes — but it is the cheapest path to Synora answering questions at all |

## 5. Required for training — nothing yet

No credential and no purchase until the data pipeline exists (readiness doc
M.2–M.4). When a first fine-tune is actually ready to run, the intake will
add exactly one item: a rented-GPU account (RunPod/Lambda class, pay-per-hour,
~$5–50 per PEFT run on a small model). **Do not create one now.**

## 6. Required for future fully-local deployment — nothing yet

When you buy GPU hardware: no credentials, only the machine. Everything
Synora runs on is Docker + Postgres + Redis + filesystem, all portable by
design (readiness doc, L).

---

## Summary card

| Now, to keep building | **nothing** |
| First AI answers, free | Ollama install (item 4) |
| First AI answers, hosted | `ANTHROPIC_API_KEY` with prepaid credits — **after spend caps ship** |
| Public site | VPS + domain (+ optional SMTP) |
| Training | nothing yet |
