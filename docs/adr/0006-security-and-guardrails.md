# 0006: API-key auth, scope-based authorization, and pluggable guardrails

## Status
Accepted

## Context
Every product on the platform needs authentication, authorization, rate
limiting, and content safety, and none of it should be reimplemented
per product.

## Decision
- **AuthN**: `ApiKeyAuthenticator` resolves a `<keyId>.<secret>` bearer
  credential to a `Principal` using `crypto.timingSafeEqual` (constant
  time, to avoid leaking secret material through response-time side
  channels). Swappable for a database/KMS-backed lookup without changing
  the `Principal`/`AuthContext` shape callers depend on.
- **AuthZ**: a small fixed scope set (`admin`, `agent:invoke`,
  `memory:read`, `memory:write`, `workflow:run`) enforced per route in
  the gateway via `requireScope`; `admin` satisfies every scope check.
- **Rate limiting**: `RateLimiter` port, `InMemoryRateLimiter` (fixed
  window per key) as the default; swap for Redis-backed for
  multi-instance deployments behind the same interface.
- **Guardrails**: `Guardrail` port (`check(text, context) -> verdict`),
  run on agent input and output as declared per-agent
  (`inputGuardrails`/`outputGuardrails`). Platform ships three
  heuristic guardrails (prompt-injection patterns, PII detection,
  secret-leak detection) in a `GuardrailRegistry`; products register
  additional domain-specific guardrails under their own names into the
  same registry.

## Consequences
- A product adds a domain guardrail (e.g. "no medical advice without a
  disclaimer") by registering a `Guardrail` implementation and
  referencing its name in an `AgentDefinition` — no platform change.
- The built-in guardrails are heuristic (regex/pattern-based), not
  model-based classifiers. They're a real first line of defense and
  free of additional LLM calls, but products with high-stakes content
  safety requirements should layer a model-based guardrail on top,
  which the `Guardrail` interface supports (nothing about it requires
  the check to be synchronous or heuristic).
- Scopes are intentionally coarse (five values) rather than a full RBAC
  system. Sufficient for the platform's current surface area
  (chat/memory/workflow endpoints); revisit if per-agent or per-resource
  authorization is needed later.
