# 0002: Provider-agnostic `ModelProvider` interface

## Status
Accepted

## Context
The platform must not be locked to one LLM vendor. Different products —
or the same product over time — will want Anthropic, OpenAI, self-hosted
models behind an OpenAI-compatible endpoint, or whatever ships next year.

## Decision
Define `ModelProvider` in `packages/core` with `generate`, `stream`, and
an optional `embed`, expressed entirely in platform-native types
(`Message`, `ContentPart`, `ToolDefinition`, `GenerateResult`,
`StreamEvent`) — never a vendor SDK type. `packages/providers` contains
one adapter per vendor (`AnthropicProvider`, `OpenAiProvider` today) that
translates platform types to/from that vendor's wire format, including
tool-call and streaming-delta normalization. A `ModelProviderRegistry`
resolves a provider by string id (`"anthropic"`, `"openai"`, ...);
`AgentRuntime`, `Orchestrator`, and every product resolve providers only
through this registry.

## Consequences
- Adding a vendor is exactly one new file in `packages/providers` plus a
  registry entry — `AgentRuntime` and product code are unchanged.
- Streaming and tool-calling shapes differ significantly between
  vendors (Anthropic's content-block deltas vs. OpenAI's
  choices[].delta.tool_calls[]); the adapters absorb that complexity so
  callers only ever see the platform's `StreamEvent` union.
- A capability a vendor doesn't support (e.g. embeddings) is declared in
  `capabilities` and callers must check it — we chose an explicit
  capability flag over throwing-by-default so callers can degrade
  gracefully instead of guessing from an exception.
