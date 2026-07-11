# @synora/test-utils

Test-only fakes for the ports defined in `@synora/application` and repository-style ports
defined by plugins. **DevDependency only** — never depend on this from production code.
Prefer fakes over mocking libraries wherever a port is simple enough (a fake in-memory
repository catches more real bugs than a mocked one). See
`docs/architecture/15-documentation-standards.md` and ADR-0012 (testing strategy).

- `FixedClock` — a `Clock` that always returns the same instant (optionally advance it).
- `SequentialIdGenerator` — an `IdGenerator` producing deterministic, incrementing ids.
- `InMemoryRepository<T>` — a generic base for fake repositories keyed by entity id.
