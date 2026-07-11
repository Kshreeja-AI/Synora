# @synora/types

Part of the **shared kernel**. Deliberately kept small — this is _not_ a junk drawer for
"types I didn't know where else to put." Only types that are genuinely cross-cutting
(used by presentation adapters across every plugin/app, with no owning layer) belong here:
pagination envelopes, the generic API response shape, and similarly universal primitives.

Feature-specific types belong to the layer/package that owns that concept (a `Task`'s
props belong in the `example-task` plugin's domain layer, not here). If you're about to
add a type here, ask: "does _every_ plugin need this, with no natural owner?" If not, it
belongs elsewhere. See `docs/architecture/12-coding-standards.md`.
