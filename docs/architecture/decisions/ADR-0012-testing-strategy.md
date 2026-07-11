# ADR-0012: Vitest + fakes over mocks, live-infra integration tests scoped out of this pass

**Status:** Accepted

## Context

`.env.example` specifies `DEFAULT_TEST_FRAMEWORK=vitest` and
`DEFAULT_E2E_FRAMEWORK=playwright`. The platform's ports/adapters split (ADR-0011) exists
specifically to make business logic testable without real infrastructure running — the
test strategy needs to actually deliver on that, not just make it theoretically possible.

## Decision

- **Vitest**, colocated `*.test.ts` per source file, run via `turbo run test` across every
  package.
- **Prefer fakes over mocking libraries** for ports simple enough to fake honestly:
  `@synora/test-utils`' `FixedClock`/`SequentialIdGenerator`/`InMemoryRepository`, and
  every infra adapter's own hand-written in-test fake of its `*Like` client interface
  (`FakeRedis`, `FakeNatsClient`, ad hoc fakes for Qdrant/S3/Temporal/better-auth clients).
  `vi.fn()` mocks are used only where a fake would be pure ceremony (e.g. asserting an
  adapter called the underlying client with the right arguments).
- **Playwright** for one API-level e2e smoke test (`apps/api-gateway/e2e`) run against the
  _built_ server via Playwright's `webServer` config, not against mocked HTTP.
- **Live-infrastructure integration tests are explicitly out of scope for this pass.**
  `PostgresTaskRepository`, `S3ObjectStorage` wired to real AWS, `NatsEventBus` against a
  real NATS server, and so on are exercised through their `*Like` fakes and through the
  use-case tests that depend on `InMemoryRepository`/`InMemoryEventBus` instead — not
  against a real Postgres/S3/NATS instance running in CI.

## Alternatives considered

- **Mocking libraries (`vi.mock`) as the default for every port** — rejected as the
  default; a hand-fake that actually stores state (`InMemoryRepository`,
  `FakeRedis`) catches real bugs (e.g. "saved the wrong key") that a mock asserting call
  arguments would miss, at roughly the same authoring cost.
- **Docker Compose + service containers in CI for live Postgres/Redis/Qdrant/NATS
  integration tests now** — considered and deferred, not rejected outright: it's the
  right next step for confidence beyond the `*Like` fake boundary, but stands up
  meaningfully more CI infrastructure than this foundational pass needs before a single
  real product feature exists to justify it. Tracked as a deliberate gap, not a silent
  one — revisit this ADR (superseding it) when the first plugin's persistence logic is
  complex enough that fake-based testing stops giving adequate confidence.
- **No e2e tier at all, only unit tests** — rejected; `.env.example` specifies Playwright
  as the e2e framework and a smoke test against the actually-built, actually-listening
  server catches an entire class of wiring bugs (composition root, plugin loading, route
  registration) unit tests structurally cannot.

## Consequences

Confidence in adapter code (does `PostgresTaskRepository`'s SQL actually work against
real Postgres?) currently comes from the combination of (a) the port contract being
simple and tested via fakes at the use-case level, and (b) manual/future integration
testing — not automated CI coverage against a live database. This is the tradeoff being
made explicitly, not a gap someone should assume is accidental.
