# 0005: `AgentRuntime` + declarative `Orchestrator` for multi-agent work

## Status
Accepted

## Context
Products need both single-agent tool-use loops and multi-agent
compositions (research → write, fan-out to parallel specialists,
conditional routing, handoffs) without baking any particular product's
agent topology into the platform.

## Decision
Split into two layers:
- **`AgentRuntime`** executes one `AgentDefinition`: input guardrails →
  memory recall → model call → tool-call loop (bounded by
  `maxToolRoundtrips`) → output guardrails → completion, or a handoff.
  Handoff is implemented as a synthetic `handoff_to_agent` tool injected
  when `AgentDefinition.handoffTargets` is non-empty — the model itself
  decides when to hand off by calling that tool; `AgentRuntime` just
  executes the decision and returns `status: 'handed_off'`.
- **`Orchestrator`** executes a declarative, serializable
  `WorkflowDefinition` graph (`sequence`, `parallel`, `condition`,
  `agent`, `tool` steps) on top of `AgentRuntime`. Agent steps
  transparently follow handoffs up to a configurable hop limit.
  Condition steps reference a named predicate registered via
  `registerCondition` rather than embedding executable code in the
  workflow data — a stored/serialized workflow can never smuggle in
  arbitrary logic (no `eval`).

## Consequences
- A product that only needs one agent (no multi-agent composition) uses
  `AgentRuntime` directly through the gateway's `/v1/chat`; `Orchestrator`
  is opt-in via `/v1/workflows/:id/run`.
- Workflows are data, so they can be stored, versioned, and diffed like
  any other config — but conditions can only branch on logic the host
  process registered ahead of time, trading some flexibility for the
  guarantee that a workflow definition alone can't execute arbitrary code.
- Every transition (step started/completed, tool invoked, handoff) is
  published on the `EventBus` (ADR 0003), so a caller can observe
  multi-agent execution without polling.
