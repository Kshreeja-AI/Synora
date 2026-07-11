# @synora/infra-workflow-temporal

**Infrastructure layer** adapter for `DEFAULT_WORKFLOW_ENGINE=temporal`.
`TemporalWorkflowEngine` implements the `WorkflowEngine` port from `@synora/application`
against a minimal `TemporalClientLike` interface, so tests inject a fake instead of
needing a running Temporal server.

**Scope note (see ADR-0011):** this package only covers the _client_ side — starting,
signaling, and querying workflows. A Temporal _worker_ (the process that actually executes
workflow/activity code) requires concrete workflow definitions owned by a real feature, and
belongs in a future `apps/worker`. Standing one up here would mean inventing a workflow with
no product behind it.
