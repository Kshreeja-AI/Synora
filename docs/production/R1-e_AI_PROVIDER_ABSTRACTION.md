# R1-e: Provider-Agnostic AI Text/Code Generation

**Status:** ✅ Complete
**Master plan item:** P0-7
**Release:** 1

## What was wrong (verified from source)

The product's core value is AI generation, but before this work there was no
integration code at all — no provider abstraction, no adapter for any vendor
SDK, and no route exposing generation to a client. The founder's stated north
star ("add an env var/API key and it deploys with real generation") had
nothing to activate: there was no code path an API key could switch on.

## What changed

### Provider contract (`ai/types.ts`)

A single `TextGenerationProvider` interface — `id`, `capabilities`,
`generateText(request)` — is the only shape the rest of the application ever
depends on. `AICapability` is an open-ended union with `text-generation` and
`code-generation` implemented in Release 1, plus seven capabilities (image,
video, audio, speech-to-text, text-to-speech, embeddings, agent) reserved so
the type never needs to change shape when those ship in later releases — only
grow. `AIProviderError` wraps every vendor SDK failure into one shape; route
code never needs to know which provider failed or how its SDK reports errors.

### Registry (`ai/registry.ts`) + resolver (`ai/resolver.ts`)

`PROVIDER_REGISTRY` lists every known provider as an `AIProviderDescriptor`
(`id`, `displayName`, `capabilities`, `isConfigured()`, `create()`), in
auto-detection priority order — Anthropic first, per the founder's chosen
Release 1 default. `resolveProvider(capability)` is the **only** place
provider selection happens in the application:

1. If `AI_PROVIDER` is set, that provider is used — it must exist, support
   the requested capability, and be configured, or the call fails with a
   specific, actionable error (never a silent fallback to something else).
2. Otherwise, the first provider in registry order whose `isConfigured()`
   returns true (i.e., its API key/secret is present) is used.
3. If nothing is configured, `NoProviderConfiguredError` lists every
   provider that was checked.

Adding a provider means one new file under `ai/providers/` plus one line in
the registry array — the resolver, routes, and every other provider are
unaffected.

### Ten provider adapters (`ai/providers/*`)

- **`anthropic.provider.ts`** — wraps `@anthropic-ai/sdk` directly. Release 1
  default, activated purely by `ANTHROPIC_API_KEY`.
- **`openaiCompatible.provider.ts`** — one generic adapter for any vendor
  exposing an OpenAI-compatible `/chat/completions` endpoint. OpenAI,
  Together AI, DeepSeek, OpenRouter, and xAI Grok all document exactly this
  compatibility, so one class + one test file covers all five; each of
  `openai.provider.ts`/`together.provider.ts`/`deepseek.provider.ts`/
  `openrouter.provider.ts`/`xai.provider.ts` supplies only its id, base URL,
  and default model.
- **`azureOpenai.provider.ts`** — `AzureOpenAI` client; requires endpoint +
  deployment + API version together (not just an API key).
- **`gemini.provider.ts`** — wraps `@google/generative-ai`'s
  `GenerativeModel`.
- **`bedrock.provider.ts`** — wraps `@aws-sdk/client-bedrock-runtime`'s
  `ConverseCommand`; requires an AWS access key pair + region.
- **`ollama.provider.ts`** — reuses `OpenAICompatibleTextProvider` (Ollama's
  API is OpenAI-compatible); requires an explicit `OLLAMA_BASE_URL` with no
  default, since there is no public Ollama endpoint to default to.

### Shared helpers (`ai/shared.ts`)

`resolveSystemPrompt()` gives `mode: 'code'` requests a code-oriented default
system prompt when the caller doesn't supply one; `DEFAULT_MAX_TOKENS = 4096`
is the shared fallback every adapter uses when a request omits `maxTokens`.

### Public facade (`ai/index.ts`)

One function, `generateText(request)`, resolves the active provider and
calls it. This is the only thing the rest of the application (routes,
future services) ever imports from `./ai` — no caller names a provider or
imports a vendor SDK.

### HTTP route (`routes/ai.ts`)

`POST /api/ai/generate` validates the body with a zod schema (`prompt`
required non-empty; `mode` restricted to `'text' | 'code'`; `maxTokens`
integer 1–100000; `temperature` 0–2) before calling `generateText()`,
following the same zod-then-`createApiResponse()` pattern as the rest of the
route layer (R1-b).

### Config + secrets wiring

Every provider's model name and endpoint config runs through the existing
three-layer config system (`defaults.ts` → `schema.ts` zod validation →
`configLoader.ts` env reads) — e.g. `ANTHROPIC_MODEL`, `OPENAI_MODEL`,
`AZURE_OPENAI_ENDPOINT`. Every provider's API key/secret is declared in
`secrets/registry.ts`'s `SECRET_CATALOG` (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`,
`DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`, `AZURE_OPENAI_API_KEY`,
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) with `environments: ['staging',
'production']` and `requiredIn: []` — none of them are required for the app
to boot, because the resolver's job is precisely to work with whichever
subset is actually configured. `.env.example` documents every variable for
every provider.

## Tests (mocked at the vendor-SDK boundary, no live network calls)

- `ai/registry.test.ts` (18 tests): every descriptor is present with correct
  id/capabilities; `getProviderDescriptor`/`providersForCapability` behave
  correctly including for an unknown id/capability.
- `ai/resolver.test.ts` (4 tests): explicit `AI_PROVIDER` selection, rejection
  of an unknown or capability-mismatched explicit provider, fallback to
  registry order when unset, and `NoProviderConfiguredError` when nothing is
  configured.
- `ai/shared.test.ts` (8 tests): system prompt resolution precedence
  (explicit > code-mode default > none) and `DEFAULT_MAX_TOKENS`.
- `ai/providers/anthropic.provider.test.ts` (17 tests): id/capabilities,
  successful generation with usage/finish-reason mapping, custom vs. default
  model, system prompt passthrough, custom vs. default max tokens,
  temperature passthrough, and `AIProviderError` wrapping on SDK failure —
  all against a mocked `@anthropic-ai/sdk` client.
- `ai/providers/openaiCompatible.provider.test.ts` (12 tests): the same
  coverage against a mocked `openai` client, proving the one generic adapter
  correctly serves any of its five configured providers.
- `ai/index.test.ts` (5 tests): the public `generateText()` facade resolves
  through the (mocked) resolver and returns its result unchanged.
- `routes/__tests__/ai.test.ts` (10 tests, real Express router + supertest):
  successful generation, all optional parameters accepted, missing/empty
  prompt → 400, invalid `mode` → 400, non-integer/out-of-range `maxTokens` →
  400, invalid `temperature` → 400, provider/API errors surfaced as 500 (not
  leaked as an unhandled rejection).

## Production verification (the real artifact)

Built the backend and booted it in production mode against real Postgres
with no AI provider API key set:

```
POST /api/ai/generate {"prompt":"hello"}
→ 500 to the client (production hides internal error detail, per
  middleware/errorHandler.ts — correct, not a bug)
→ server log: NoProviderConfiguredError: No AI provider is configured for
  capability "text-generation". Checked: anthropic, openai, gemini, xai,
  openrouter, deepseek, together, azure-openai, bedrock, ollama. Set one of
  their API key secrets, or set AI_PROVIDER explicitly.
```

This is the clean-failure half of the "add a key and it works" contract:
with zero keys configured, the app boots and serves every other route
normally, and the AI route fails with a specific, actionable message logged
server-side (never leaked to the client in production) rather than a crash.
Setting `ANTHROPIC_API_KEY` (or any other provider's key) and restarting
activates real generation through that provider with no code change — this
is the resolver's entire selection contract (see `ai/resolver.ts`),
exercised end-to-end by `ai/providers/anthropic.provider.test.ts` and
`routes/__tests__/ai.test.ts` against a mocked SDK boundary. A live call
against the real Anthropic API requires a real, billable API key and is
intentionally not exercised in CI; activating it is documented above as an
env-var-only change.

### Bug found and fixed during this verification: ambient AWS credentials silently activating Bedrock

The first production-boot run above did **not** produce the clean error —
it produced a live, failing call to AWS Bedrock (`AIProviderError: Bedrock
text generation failed: The security token included in the request is
invalid`), even though no AI provider key had been set. The runtime
environment happened to have `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set
for reasons unrelated to AI generation, and `bedrockDescriptor.isConfigured()`
treated their mere presence as "Bedrock is configured," so the resolver
auto-selected and called it.

This is a real correctness gap, not specific to this one sandbox:
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are the single most common
ambient credential convention in AWS-hosted deployments (ECS task roles, EC2
instance profiles, CI/CD pipelines) for reasons that have nothing to do with
AI generation — a real production deployment could hit this exact
false-positive activation.

**Fix:** `bedrock.provider.ts`'s `isConfigured()` now also requires
`BEDROCK_REGION` to be explicitly set (`config/schema.ts` and
`config/defaults.ts` changed to give `ai.bedrockRegion` no default, mirroring
how `ai.ollamaBaseUrl` already has none for the identical reason — see
`ollama.provider.ts`). `create()` still falls back to `us-east-1` for the
actual client once `isConfigured()` has confirmed explicit intent. Re-running
the exact same production-boot scenario afterward produced the correct clean
`NoProviderConfiguredError` shown above, with Bedrock correctly excluded from
auto-detection while ambient AWS credentials remain present.

## Security / architecture / performance review

- **Security:** no vendor API key is ever logged, echoed in a response, or
  stored anywhere but the secrets layer (R1's existing `SecretsManager`).
  `AIProviderError` messages include the failing provider's id but never its
  key. The zod schema on `/api/ai/generate` bounds `maxTokens` (≤100000) and
  `temperature` (0–2), so a malformed or hostile request cannot be used to
  drive an unbounded-cost call to a paid upstream API. Bedrock's activation
  condition requires an explicit `BEDROCK_REGION` in addition to AWS
  credentials (see above) specifically so ambient/unrelated AWS credentials
  present in an AWS-hosted deployment can never silently activate a real,
  billable provider the operator did not choose.
- **Architecture:** the registry/resolver/descriptor split means the
  resolver's selection logic, and every route that calls `generateText()`,
  are unaffected by adding, removing, or reordering providers — verified by
  `resolver.test.ts` exercising selection purely against descriptor mocks,
  never a concrete provider. The one generic
  `OpenAICompatibleTextProvider` avoids five near-identical adapter classes.
- **Performance:** provider resolution is a cheap in-process loop over
  `isConfigured()` checks (secret lookups, no network I/O) — no added
  latency beyond the one upstream generation call itself, which the client
  request already pays for synchronously (Release 1 ships text/code
  generation only, which is fast enough to serve without a queue; media
  generation's async queue is Release 2, R2-d).

## Verification summary

Backend type-check ✅ · lint 0 errors ✅ · 74 targeted AI tests ✅ (18
registry + 4 resolver + 8 shared + 17 Anthropic adapter + 12 OpenAI-compatible
adapter + 5 facade + 10 HTTP route) · full monorepo build 5/5 ✅ · production
boot with a live "no provider configured → clean 500 with actionable message"
call over real HTTP against live Postgres 16, confirming the app boots and
serves normally with zero AI provider keys set.
