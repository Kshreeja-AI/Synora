# @synora/logger

Part of the **shared kernel**. A thin, structured-JSON logging standard wrapping `pino`.
Nothing in the codebase should import `pino` directly — always go through this package
so the underlying library can change without touching call sites. See
`docs/architecture/14-logging-standards.md` and ADR-0009.

- `createLogger(options)` — one root logger per process, built from `@synora/config`'s
  `logLevel`.
- `Logger.child(bindings)` — scope a logger to a request/use-case/plugin (e.g.
  `logger.child({ plugin: 'example-task' })`).
- `runWithCorrelationId(id, fn)` / `getCorrelationId()` — `AsyncLocalStorage`-based
  request correlation, automatically attached to every log line emitted within `fn`.
- Secret redaction: known sensitive keys (`password`, `token`, `apiKey`, `secret`,
  `authorization`) are redacted by default.
