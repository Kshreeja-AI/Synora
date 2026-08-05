# Synora — Provider Readiness Matrix

**Audit date**: 2026-08-05
**Audited at commit**: `7c36626` (branch `claude/synora-ai-platform-h5q0k2`)
**Method**: every claim below was made by reading the implementation, not by
reading filenames, interfaces, enums or existing documentation. Where a
previous document disagreed with the code, the code won.

This document answers one question: **if real credentials are connected
tomorrow, exactly what will work?**

---

## 0. The single most important finding

**Synora has three separate AI stacks, and one of them is unreachable.**

| Stack | Location | Wired to the app? |
|---|---|---|
| Descriptor/registry stack | `src/ai/{types,registry,resolver}.ts` + `src/ai/providers/*` | **YES** — this is the live path for all non-streaming generation |
| Streaming stack | `src/ai/streaming/*` | **YES** — used only by `workers/generateResponse.worker.ts` |
| Core orchestration stack | `src/ai/core/*` (9 files) + `src/ai/providers/openai.provider.ts` (250 lines) | **NO — ORPHANED. Nothing imports it.** |

`src/ai/core/` defines a richer world than Synora actually has: `AIRequest`
with `tools`, `toolChoice`, `responseFormat`, `stream`, `timeout`,
`retryPolicy`, `fallbackModels`; a `CapabilityMatrix`; `ProviderHealth`.
`src/ai/providers/openai.provider.ts` is the only adapter that implements it
and is the only file in the repo making raw `fetch` calls to OpenAI.

**Nothing references either.** `PROVIDER_REGISTRY` imports its OpenAI support
from `openaiCompatible.provider.ts` (88 lines) instead. A reader auditing this
repo by directory listing would reasonably conclude Synora has a full OpenAI
adapter with tool-calling, streaming, health checks and retry policy. It does
not — that code cannot be reached by any request.

This is the exact failure mode the directive warned about: **an interface
existing is not an integration existing.**

---

## 1. Capability inventory — what Synora can consume

Searched the entire repository, not only UI-exposed features.

| Capability | Represented where | Synora status |
|---|---|---|
| Text generation | `ai/` descriptor stack | **IMPLEMENTED-UNTESTED-LIVE** |
| Code generation | same contract, `mode` flag | **IMPLEMENTED-UNTESTED-LIVE** |
| Streaming | `ai/streaming/*` (separate stack) | **IMPLEMENTED-UNTESTED-LIVE** |
| Embeddings | `embeddings/` (7 providers) | **IMPLEMENTED-UNTESTED-LIVE** |
| Vector storage | `vectordb/` (5 providers) | **IMPLEMENTED** (pgvector local), rest untested-live |
| Image generation | `ai/imageRegistry.ts` + OpenAI adapter | **IMPLEMENTED-UNTESTED-LIVE** |
| Text-to-speech | `ai/ttsRegistry.ts` + OpenAI adapter | **IMPLEMENTED-UNTESTED-LIVE** |
| Video generation | `ai/videoRegistry.ts` + Replicate adapter | **IMPLEMENTED-UNTESTED-LIVE** |
| Tool / function calling | live contract (`AIToolDefinition`/`AIToolCall`/`AIToolResult`) + Anthropic and OpenAI-compatible adapters | **IMPLEMENTED-UNTESTED-LIVE** for 7 of 10 providers — closed 2026-08-05, see §11 |
| Structured output / JSON mode | **only in the orphaned `ai/core` types** | **NOT-IMPLEMENTED** in the live path |
| Vision / multimodal input | declared in orphaned `ModelCapability` only | **NOT-IMPLEMENTED** |
| Reasoning-effort control | declared in orphaned `ModelCapability` only | **NOT-IMPLEMENTED** |
| Reranking | — | **NOT-IMPLEMENTED** |
| Moderation | — | **NOT-IMPLEMENTED** |
| Speech-to-text | reserved in `AICapability` union, no adapter | **INTERFACE-ONLY** |
| Realtime voice | — | **NOT-IMPLEMENTED** |
| Document/file processing | `files/` pipeline (no AI provider call) | **IMPLEMENTED** (non-AI) |
| Web/search providers | — | **NOT-IMPLEMENTED** |
| Browser / computer use | — | **NOT-IMPLEMENTED** |
| Fine-tuning | — | **NOT-IMPLEMENTED** |

### Critical distinction (directive §7)

Anthropic, OpenAI and Gemini **all support tool calling, vision and structured
output.** At audit time Synora's live `TextGenerationRequest` was:

```ts
{ prompt, messages?, mode?, systemPrompt?, maxTokens?, temperature?, model? }
```

No field could express a tool, an image, a JSON schema, a stop sequence, a
timeout or a cancellation signal. The finding, as recorded that morning:

- **Provider supports tool calling**: YES (Anthropic, OpenAI, Gemini, others)
- **Synora supports tool calling through that provider**: **NO**

**Updated 2026-08-05 (same day, build phase).** The contract now carries
`tools`/`toolChoice` in and `toolCalls` out, and `ConversationMessage` carries
`toolCalls`/`toolResults` so a full round trip can be replayed. The second
line above is now **YES for the 7 providers whose adapters implement the
mapping** (Anthropic, OpenAI, xAI, DeepSeek, Together, OpenRouter, Azure
OpenAI) and remains **NO** for Gemini, Bedrock and Ollama, whose adapters do
not — and which therefore do not declare the `tool-calling` capability. Vision,
structured output, stop sequences and cancellation remain NOT-IMPLEMENTED.

Agent tool use *also* works by a different mechanism — Synora's own planner
produces steps, and `tool-runner-adapter.ts` executes them. That is
orchestration-level tool use, not provider-native function calling. Both are
legitimate and both now exist; conflating them would still be false. **The
agent runtime has not been switched over** and still uses its own planner —
provider-native calling is available to callers, not yet adopted internally.

---

## 2. Provider matrix — text generation (the live `ai/` stack)

All ten are registered in `PROVIDER_REGISTRY` and reachable by the resolver.

| Provider | Adapter | Auth | Impl status | Live test | Credential |
|---|---|---|---|---|---|
| Anthropic | `anthropic.provider.ts`, official SDK | `ANTHROPIC_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| OpenAI | `openaiCompatible.provider.ts`, official SDK | `OPENAI_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| Gemini | `gemini.provider.ts` | `GOOGLE_AI_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| xAI | `xai.provider.ts` (OpenAI-compatible, 25 lines) | `XAI_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| OpenRouter | `openrouter.provider.ts` (OpenAI-compatible) | `OPENROUTER_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| DeepSeek | `deepseek.provider.ts` (OpenAI-compatible) | `DEEPSEEK_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| Together | `together.provider.ts` (OpenAI-compatible) | `TOGETHER_API_KEY` | IMPLEMENTED-UNTESTED-LIVE | none | required |
| Azure OpenAI | `azureOpenai.provider.ts` | `AZURE_OPENAI_*` | IMPLEMENTED-UNTESTED-LIVE | none | required + endpoint |
| AWS Bedrock | `bedrock.provider.ts` | AWS credentials | IMPLEMENTED-UNTESTED-LIVE | none | required + region |
| Ollama | `ollama.provider.ts` | none (local) | IMPLEMENTED-UNTESTED-LIVE | none | **no credential** — needs a running Ollama |

The six OpenAI-compatible providers are thin (25 lines each) because they
delegate to `OpenAICompatibleTextProvider`. That is correct design, not an
incomplete adapter — verified by reading the shared class.

### Cross-cutting concerns in the live text path

At audit time (2026-08-05, morning) the first five rows below were all
NOT-IMPLEMENTED, verified by grep returning nothing. The audit's build phase
closed four of them the same day — statuses below are CURRENT, with the
original finding kept in the notes so the history stays legible:

| Concern | Status in live text path |
|---|---|
| Timeout | **IMPLEMENTED** — `resilience/timeout.ts` via `ai/textResilience.ts` (120s; bounds waiting only, does not cancel the HTTP request) |
| Retry | **IMPLEMENTED** — shared `resilience/retry.ts` (3 attempts, exponential backoff, transient shapes only; 401 never retried) |
| Cancellation (AbortSignal) | **NOT-IMPLEMENTED** |
| Rate-limit handling | **IMPLEMENTED** — outbound per-provider pacing (`AI_RATE_LIMIT_*`), refused before the request is sent, surfaced as the standard 429 envelope. Vendor 429s are separately classified as transient by the retry layer. LIMIT: keys by provider only — per-workspace fairness (the embeddings standard) needs the facade to carry caller identity first |
| Circuit breaking | **IMPLEMENTED** — per-provider breaker via `ai/textResilience.ts`; registry deliberately separate from the embeddings stack's |
| Health check | **NOT-IMPLEMENTED** — `verifyCredential()` is a setup-time check, not a liveness probe |
| Credential *validation* | **IMPLEMENTED** — see §8 (four-outcome `verifyCredential()`, built by this audit) |
| Model discovery | **NOT-IMPLEMENTED** — models come from config strings |
| Capability discovery | **PARTIAL** — negotiated per model AND per provider from a hand-maintained catalog (§12); still not *discovered* from a live provider API |
| Error normalization | **IMPLEMENTED** (`AIProviderError`) |
| Usage accounting | **PARTIAL** — tokens captured when the SDK returns them |
| Cost accounting | **PARTIAL** — see §5 |

---

## 3. Provider matrix — other capabilities

### Streaming (`ai/streaming/`, consumed only by the chat worker)

| Provider | Status | Notes |
|---|---|---|
| Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek | IMPLEMENTED-UNTESTED-LIVE | six real SSE adapters |
| Mock | IMPLEMENTED | deterministic, used for local runs |

**Groq appears here and nowhere else** — it is a streaming-only provider with
no non-streaming counterpart in `PROVIDER_REGISTRY`. **No tool-call or
structured-output events exist in the streaming contract.**

### Embeddings (`embeddings/`) — the most production-hardened stack in the repo

| Provider | Status |
|---|---|
| OpenAI, Cohere, Voyage, Gemini, Claude, OpenAI-compatible, self-hosted, Ollama | IMPLEMENTED-UNTESTED-LIVE |

Unlike the text stack, this one **does** have: `retry.ts`, `circuitBreaker.ts`,
`rateLimiter.ts`, `metrics.ts`, `tracing.ts`, `cache.ts`, `usage.ts`,
`security.ts`. This is the standard the text stack should be raised to.

### Vector databases (`vectordb/`)

| Provider | Status |
|---|---|
| pgvector | **IMPLEMENTED** — works locally against the real PostgreSQL |
| Pinecone, Qdrant, Weaviate, Milvus | IMPLEMENTED-UNTESTED-LIVE + **EXTERNAL-DEPENDENCY** (each needs a running service) |

### Media

| Capability | Provider | Status |
|---|---|---|
| Image generation | OpenAI | IMPLEMENTED-UNTESTED-LIVE |
| Text-to-speech | OpenAI | IMPLEMENTED-UNTESTED-LIVE |
| Video generation | Replicate | IMPLEMENTED-UNTESTED-LIVE (async job + polling) |

---

## 4. Execution path trace

Directive §4 requires the full path. Traced for text generation:

```
USER → POST /api/ai/generate (routes/ai.ts)
     → generateText() (ai/index.ts)
     → resolveProvider('text-generation') (ai/resolver.ts)
     → descriptor.isConfigured() ── ⚠ PRESENCE CHECK ONLY
     → descriptor.create() → provider instance
     → provider.generateText() → official SDK → EXTERNAL API
     → normalize to TextGenerationResult
     → USER
```

**Every link exists.** The path is complete and a real request will travel it
end to end the moment a key is set. That is the good news, and it is real.

**The one broken link is `isConfigured()`.** All thirteen implementations call
`secretsManager.tryGet(...)` and return whether a value is present. None makes
a call to verify the credential is *valid*. Consequence: an expired, revoked,
typo'd or wrong-project key reports "configured", the provider is selected, and
the failure surfaces to an end user mid-request instead of to an operator at
setup time.

**This is the highest-value gap that can be closed with no credentials**, and
it is the one I closed in this session (§8).

---

## 5. Cost accounting — honest status

`ai/pricing.ts` prices **7 models**: 3 Claude, 2 GPT-4o, 2 Gemini. An
unrecognised model returns **0**, deliberately, so a conversation is never
blocked by a missing price.

That default is right for availability and wrong for accounting: with xAI,
DeepSeek, Together, OpenRouter, Bedrock or Azure connected, **estimated cost
will silently read $0.00**. The file's own comment states it is display-only
and not used for billing (billing prices by credits per capability-use), which
contains the damage — but a founder reading a $0 cost figure would be misled.

**Status: PARTIAL.** Marked here rather than "fixed" because correct pricing
for 6+ providers requires published rates I should not guess at.

---

## 6. Provider-agnostic business logic (directive §9)

**PASS, with evidence.** Grep for provider names outside `src/ai/`,
`src/embeddings/`, `src/vectordb/` finds no provider-specific branching in
agents, workflows, permissions, approvals, auditing, projects or workspace
logic. Provider choice enters through exactly one function
(`resolveProvider`), which its own doc-comment claims is the only selection
site — verified true.

Swapping Anthropic for OpenAI requires setting one environment variable. No
business logic changes.

---

## 7. Readiness classification (directive §13)

### A. Already functional locally, no credentials
- Deterministic local planner + local generate (labelled LOCAL, never as a model)
- pgvector vector storage against real PostgreSQL
- Mock streaming provider
- The entire agent/workflow/tool/approval/audit orchestration layer
- All previews (agent plan, workflow dry run, tool execution)
- Text-path resilience: timeout, retry, circuit breaking and outbound
  rate limiting — enforced locally on every `generateText()` call, tested
  against simulated failure shapes (no provider contact)

### B. Ready for real credentials — set a key and it runs
- Anthropic, OpenAI, Gemini, xAI, OpenRouter, DeepSeek, Together text generation
- Provider-native tool calling through Anthropic, OpenAI, xAI, DeepSeek,
  Together, OpenRouter and Azure OpenAI (contract + adapters; §11)
- OpenAI embeddings, Cohere, Voyage, Gemini embeddings
- OpenAI image generation, OpenAI TTS, Replicate video
- Streaming for Anthropic/OpenAI/Gemini/OpenRouter/Groq/DeepSeek

### C. Requires live verification before trust
- **Every item in B.** Not one provider adapter in this repository has ever
  exchanged a packet with its real API. Every "IMPLEMENTED-UNTESTED-LIVE"
  above means exactly that.

### D. Requires additional infrastructure
- Azure OpenAI (endpoint + deployment names), AWS Bedrock (IAM + region)
- Ollama (a running local server)
- Pinecone / Qdrant / Weaviate / Milvus (running services)

### E. Not yet implemented
- Structured output, vision, reasoning control **through a provider**
  (Synora's contract cannot express them). Tool calling moved out of this
  list on 2026-08-05 — see §11; it now sits in class B for 7 providers and
  stays here for Gemini, Bedrock and Ollama
- Provider-native tool calling **inside the agent runtime** — the capability
  exists at the provider layer; the runtime still plans with its own planner
- Reranking, moderation, speech-to-text, realtime voice, web search,
  browser/computer use, fine-tuning
- True cancellation (AbortSignal through the SDKs) and health checks **in the
  text path** — timeout/retry/circuit-breaking/rate-limiting were closed by
  this audit's build phase, see §2 and §10
- Per-workspace rate-limit fairness in the text path (the limiter keys by
  provider only; the facade deliberately hides caller identity)
- Metrics, tracing and caching in the text path (the embeddings stack has all
  three)
- Model-level capability discovery and negotiation

### F. Blocked by a founder decision
- Founder Authority semantics (gates passkey/WebAuthn work)
- Asynchronous long-running work
- Client IP pseudonymization

---

## 8. What this audit changed (built, not just reported)

**Credential verification** — `verifyCredential()` on the provider descriptor
contract, with real implementations for the Anthropic and OpenAI-compatible
families, plus an aggregate readiness report and an admin route.

`isConfigured()` still answers "is a key present". `verifyCredential()` answers
"is that key actually good", by making the cheapest possible authenticated
call. The two are deliberately separate: presence is free and safe to check on
every request; validity costs a network round trip and belongs at setup time.

Four honest outcomes, never collapsed:

| Result | Meaning |
|---|---|
| `verified` | The provider accepted the credential. |
| `rejected` | The provider answered, and said no (401/403). The key is wrong. |
| `unreachable` | Network/timeout. Says nothing about the key's validity. |
| `not-verifiable` | This provider has no cheap check; only a real call proves it. |

`unreachable` is kept distinct from `rejected` because reporting a network
blip as a bad key would send someone hunting a credential problem that does
not exist.

---

## 9. Activation sequence, per provider

When credentials arrive, the minimal sequence:

```bash
# 1. Set the key (Anthropic shown; same shape for every provider)
ANTHROPIC_API_KEY=sk-ant-...

# 2. Verify it is actually accepted — before any user sees a failure
GET /api/ai/provider-readiness      # admin-gated

# 3. Expect: { id: "anthropic", configured: true, verification: "verified" }
#    "rejected"    → the key is wrong; fix it now, not at first user request
#    "unreachable" → network problem; the key may still be fine

# 4. Smoke test through the real path
POST /api/ai/generate  { "prompt": "Reply with the word: ready" }
```

Remaining per-provider work at that point is **configuration and live
verification, not business-logic changes** — which was the directive's stated
objective and is, on the evidence above, met for the providers in list B.

---

## 10. Recommended order for closing the gaps in E

1. ~~**Text-path resilience**~~ — **CLOSED 2026-08-05.** `retry`/`circuitBreaker`/
   `rateLimiter` MOVED (not copied) from `embeddings/` to shared
   `src/resilience/`, plus a new `timeout.ts`, all wired through
   `ai/textResilience.ts` so every `generateText()` caller inherits them.
   The outbound rate limiter is config-driven (`AI_RATE_LIMIT_*`) and its
   refusal surfaces as the standard 429 envelope. Still open from the
   embeddings standard: metrics, tracing, cache, true cancellation, and
   per-workspace fairness keying (needs the facade to carry caller identity).
2. **Resolve the orphaned stack** — either wire `ai/core` in or delete it.
   Leaving 250+ lines of unreachable OpenAI adapter is an active trap for the
   next reader.
3. ~~**Tool calling through providers**~~ — **CLOSED 2026-08-05**, see §11.
4. ~~**Model-level capability negotiation**~~ — **CLOSED 2026-08-05**, see §12.
5. **Pricing coverage** — needs published rates.

---

## 11. Provider-native tool calling (built 2026-08-05)

The contract gained four provider-agnostic shapes — `AIToolDefinition`,
`AIToolCall`, `AIToolResult`, `ToolChoice` — plus `tools`/`toolChoice` on the
request, `toolCalls` on the result, and `toolCalls`/`toolResults` on
`ConversationMessage` so a completed round trip can be replayed to the model.

Two adapters implement the mapping, covering **7 of 10 providers**:

| Adapter | Providers served | Wire shape |
|---|---|---|
| `AnthropicTextProvider` | Anthropic | tool_use / tool_result **blocks inside** a turn |
| `OpenAICompatibleTextProvider` | OpenAI, xAI, DeepSeek, Together, OpenRouter, Azure OpenAI | `tool_calls` on an assistant message; each result its **own `role:'tool'` message** |

The two vendors differ structurally, and the adapters absorb that difference
so no caller ever sees it: Anthropic keeps one turn per turn, OpenAI expands
one Synora turn into several messages. OpenAI also sends tool arguments as a
JSON **string** rather than an object; an unparseable blob raises a named
error rather than a guessed-at call — running a tool on half-understood
arguments is how an automation does the wrong thing confidently.

`tool-calling` is declared as an `AICapability` **only** by the descriptors
whose adapter actually implements it, so `providersForCapability('tool-calling')`
is a truthful answer rather than a restatement of vendor marketing. Gemini,
Bedrock and Ollama do not declare it.

Status: **IMPLEMENTED-UNTESTED-LIVE.** 15 unit tests pin both directions of
both wire formats against mocked SDK clients; no provider has been contacted.

Not done, deliberately: the agent runtime still plans with its own planner
(adopting provider-native calling there is an orchestration change, not a
provider change); Gemini/Bedrock/Ollama adapters; streaming tool-call events;
parallel-call fan-out policy above the provider layer.

---

## 12. Model-level capability negotiation (built 2026-08-05)

Capabilities were declared per PROVIDER while the model catalog declared them
per MODEL, and nothing reconciled the two. Both halves could be individually
accurate and still combine into a false statement to a user:

- Gemini's model cards say `toolUse: true` — **true about the model.** Synora's
  Gemini adapter cannot request a tool call — **also true.** The picker badged
  the first and so promised a capability no request could deliver.
- DeepSeek's chat card claims no tool use while its adapter (OpenAI-compatible)
  does support it — the opposite error, hiding something real.

`negotiateModelSupport(model, providerId, providerCapabilities)` returns
`synoraSupports`, a **conjunction**: the model must claim the capability AND
Synora must implement it for that provider. It is computed server-side in
`listAvailableModels()` so no surface can disagree, and the picker now badges
and filters on it.

| Field | Rule |
|---|---|
| `toolCalling` | model claims `toolUse` **and** descriptor declares `tool-calling` |
| `streaming` | model claims `streaming` **and** a `ai/streaming/providers/` adapter exists |
| `vision` | **always false** — several models accept images; Synora's contract has no field to carry one |

`reasoning` and `thinking` are deliberately NOT negotiated: they happen inside
the model with nothing for Synora to implement, so the vendor's claim is the
correct answer and pretending otherwise would be its own distortion.

**Defect found and fixed in the same pass**: `CATALOG_BY_PROVIDER` keyed Azure
as `azure` while its descriptor id is `azure-openai`, so a fully configured
Azure deployment rendered as a provider with **zero selectable models** — a
silent failure no error surface could report. `modelCatalogGaps()` now
enumerates providers with no models and catalog keys matching no provider, and
a test asserts both stay empty, so the class of bug cannot return unnoticed.

Status: **IMPLEMENTED** (local, no credentials needed). 8 unit tests.
Remaining: capabilities come from a hand-maintained catalog, not live provider
discovery — a model shipped today is invisible until the catalog is updated.
