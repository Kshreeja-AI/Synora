# ADR-0003: Feature-first inside plugins, layer-first at the platform kernel

**Status:** Accepted

## Context

The request was for both "Clean Architecture" (traditionally organized layer-first: a
top-level `domain/`, `application/`, etc.) and "feature-first folder structure"
(organized by business capability, each feature owning a vertical slice). These read as
contradictory at the same level of the tree.

## Decision

Apply each at a different altitude:

- **Layer-first at the platform kernel** (`packages/domain`, `packages/application`,
  `packages/infrastructure/*`) — correct here because the kernel has exactly one
  "feature": being domain-independent infrastructure for everything built on top. There's
  nothing to slice by feature.
- **Feature-first at the plugin level** (`plugins/<feature>/src/{domain,application,infrastructure,presentation}`)
  — every plugin is a complete vertical slice through all four Clean Architecture rings,
  and multiple plugins never share an implementation folder. Layer separation still
  applies _inside_ a plugin (a plugin's own `domain/` still can't import its own
  `infrastructure/` — see `03-service-boundaries.md`), so this isn't an either/or; it's
  Clean Architecture's rule applied recursively at a smaller scope, once per feature.

## Alternatives considered

- **Feature-first at the platform kernel too** (e.g. `features/tasks/domain`,
  `features/tasks/application` inside the core repo) — rejected because it would mean
  hardcoding a product feature into the domain-independent foundation, contradicting the
  platform's core requirement.
- **Layer-first everywhere, including plugins** (a global `domain/` folder containing
  every plugin's entities) — rejected because it re-couples otherwise-independent
  features into one shared folder, defeating the purpose of a plugin boundary (see
  ADR-0005) and making it impossible to add/remove a feature by adding/removing one
  directory.

## Consequences

A newcomer needs both mental models: "which of the four rings is this kernel package,"
and, once inside a plugin, "which of the four rings is this file." `plugins/example-task`
exists specifically so this isn't just described in prose — it's a directory you can
open and see the pattern.
